import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The tool that lets a person hear a voice before it is offered as a narrator.
const audition = fileURLToPath(new URL('../tools/narrators/audition.mjs', import.meta.url));
const testKey = 'narrator_key_that_must_not_leak';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const decoding = { skip: hasFfmpeg ? false : 'needs a system ffmpeg' };

const RATE = 16000;

/** A second of a buzzing tone at `hz`: enough of a voice for its pitch to be found. */
function tone(hz) {
  const count = RATE;
  const buffer = Buffer.alloc(44 + count * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + count * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / RATE;
    const sample = 0.5 * Math.sin(2 * Math.PI * hz * t) + 0.2 * Math.sin(2 * Math.PI * 2 * hz * t);
    buffer.writeInt16LE(Math.round(sample * 20000), 44 + i * 2);
  }
  return buffer;
}

async function withAngles(runWith) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const seen = { method: request.method, url: request.url, headers: request.headers, body: body ? JSON.parse(body) : null };
    requests.push(seen);
    response.setHeader('content-type', 'application/json');
    if (seen.url === '/audio/voices') {
      return response.end(
        JSON.stringify({
          voices: [
            { language: 'zh-CN', label: '简体中文', voice: 'zh-CN-XiaoxiaoNeural', description: 'Woman', default: true },
            { language: 'zh-CN', label: '简体中文', voice: 'zh-CN-YunyangNeural', description: 'Man', default: false },
            { language: 'ko', label: '한국어', voice: 'ko-KR-SunHiNeural', description: 'Woman', default: true },
          ],
        })
      );
    }
    const voice = seen.body.voice;
    if (voice === 'Chinese (Mandarin)_Radio_Host') {
      response.statusCode = 503;
      return response.end(JSON.stringify({ message: 'The voice could not be generated. Try the line again shortly.' }));
    }
    // The language's own voice and the woman sit high; every other candidate sits low.
    const low = voice && voice !== 'zh-CN-XiaoxiaoNeural';
    response.end(JSON.stringify({ audio: tone(low ? 120 : 220).toString('base64'), format: 'mp3', provider: voice === 'Chinese (Mandarin)_Gentleman' ? 'edge-tts' : 'minimax' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await runWith(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    server.close();
  }
}

async function run(directory, args, env = {}) {
  const child = spawn(process.execPath, [audition, ...args], { cwd: directory, env: { ...process.env, ANGLES_API_KEY: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

test('auditions the candidates of a language beside its own voice, and says who spoke each', decoding, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'angles-narrators-'));
  try {
    await withAngles(async (baseUrl, requests) => {
      const result = await run(directory, ['--only', 'zh-CN', '--out', 'heard'], { ANGLES_API_KEY: testKey, ANGLES_API_BASE_URL: baseUrl });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /^5 voice lines, a credit each from the account's balance\.\n/);
      assert.ok(!result.stdout.includes(testKey));

      // The language's own voice is asked for by leaving `voice` out; a candidate by its provider id.
      assert.equal(requests[0].body.voice, undefined);
      assert.equal(requests[0].body.language, 'zh-CN');
      assert.equal(requests[1].body.voice, 'Chinese (Mandarin)_Reliable_Executive');
      assert.equal(requests[1].headers.authorization, `Bearer ${testKey}`);

      const rows = JSON.parse(await readFile(join(directory, 'heard', 'results.json'), 'utf8'));
      const [own, executive, announcer, host, gentleman] = rows;
      assert.equal(own.asked, "the language's own");
      assert.ok(Math.abs(own.hz - 220) < 8, `own voice measured at ${own.hz} Hz`);
      assert.equal(executive.provider, 'minimax');
      assert.ok(Math.abs(executive.hz - 120) < 6, `candidate measured at ${executive.hz} Hz`);
      assert.equal(announcer.file, 'zh-CN--Chinese-Mandarin-_Male_Announcer.mp3');
      // A candidate the provider would not speak is reported, and the rest still run.
      assert.match(host.failed, /HTTP 503/);
      assert.equal(gentleman.provider, 'edge-tts');
      assert.equal(rows.some(row => 'text' in row), false);

      const html = await readFile(join(directory, 'heard', 'index.html'), 'utf8');
      assert.match(html, /<audio controls preload="none" src="zh-CN--own\.mp3">/);
      assert.match(html, /spoken by minimax · \d+ Hz · low — a man, most likely/);
      assert.match(html, /failed: HTTP 503/);
      assert.equal(existsSync(join(directory, 'heard', 'zh-CN--own.mp3')), true);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('auditions the narrators already on offer by name', decoding, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'angles-narrators-'));
  try {
    await withAngles(async (baseUrl, requests) => {
      const result = await run(directory, ['--offered', '--out', 'heard'], { ANGLES_API_KEY: testKey, ANGLES_API_BASE_URL: baseUrl });
      assert.equal(result.code, 0, result.stderr);
      assert.equal(requests[0].url, '/audio/voices');
      // A language with no sentence to say is left out rather than guessed at.
      assert.deepEqual(requests.slice(1).map(request => request.body.voice), ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunyangNeural']);
      const rows = JSON.parse(await readFile(join(directory, 'heard', 'results.json'), 'utf8'));
      assert.equal(rows[1].note, 'Man');
      assert.equal(rows[0].note, "Woman · the language's own");
      assert.ok(rows[0].hz > 175 && rows[1].hz < 155);
    });

    const unset = await run(directory, []);
    assert.equal(unset.code, 1);
    assert.match(unset.stderr, /ANGLES_API_KEY is not set/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
