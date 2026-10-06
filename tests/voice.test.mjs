import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The starter's voice script decides the timeline every scene is cut to, so it
// is exercised here from `src/`, the copy the Skills are synced from.
const voicePath = fileURLToPath(new URL('../src/starter/scripts/voice.mjs', import.meta.url));
const testKey = 'voice_key_that_must_not_leak';

// Measuring a sound file needs ffprobe. A workspace gets one from Remotion; this
// repository installs nothing, so the tests that measure need a system one.
const hasFfprobe = spawnSync('ffprobe', ['-version']).status === 0;
const measuring = { skip: hasFfprobe ? false : 'needs a system ffprobe' };

/** A silent mono WAV of the given length — a real file ffprobe can measure. */
function wav(seconds, rate = 8000) {
  const bytes = Math.round(seconds * rate) * 2;
  const buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + bytes, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(bytes, 40);
  return buffer;
}

async function workspace(script) {
  const directory = await mkdtemp(join(tmpdir(), 'angles-voice-'));
  await mkdir(join(directory, 'src'));
  await writeFile(join(directory, 'src', 'ep01.script.json'), JSON.stringify(script));
  return directory;
}

async function setScript(directory, script) {
  await writeFile(join(directory, 'src', 'ep01.script.json'), JSON.stringify(script));
}

async function runVoice(directory, args = ['src/ep01.script.json'], env = {}) {
  const child = spawn(process.execPath, [voicePath, ...args], {
    cwd: directory,
    env: { ...process.env, ANGLES_API_KEY: '', ELEVENLABS_API_KEY: '', OPENAI_API_KEY: '', MINIMAX_API_KEY: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

const readTrack = async directory => JSON.parse(await readFile(join(directory, 'src', 'ep01.audio.json'), 'utf8'));

async function withServer(handler, run) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const seen = { method: request.method, url: request.url, headers: request.headers, body: body ? JSON.parse(body) : null };
    requests.push(seen);
    handler(seen, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await run(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

const twoLines = voice => ({
  voice,
  lines: [
    { id: 'l01', text: 'Your product ships every week.' },
    { id: 'l02', text: 'The video about it does not.' },
  ],
});

test('a script with no voice is timed to how long its captions take to read', async () => {
  const directory = await workspace({
    voice: { provider: 'none' },
    gap: 0.4,
    tail: 3,
    lines: [
      { id: 'l01', text: 'Your product ships every week.', pause: 1 },
      { id: 'l02', text: 'The video about it does not.' },
    ],
  });
  try {
    const result = await runVoice(directory);
    assert.equal(result.code, 0, result.stderr);
    const track = await readTrack(directory);
    const [first, second] = track.clips;
    assert.equal(first.src, null);
    assert.equal(first.kind, 'silent');
    assert.equal(first.at, 1);
    assert.ok(first.seconds >= 1.5);
    assert.ok(Math.abs(second.at - (first.at + first.seconds + 0.4)) < 0.002);
    assert.ok(Math.abs(track.totalSeconds - (second.at + second.seconds + 3)) < 0.002);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses to guess where the voice comes from', async () => {
  const directory = await workspace({ lines: [{ id: 'l01', text: 'Hello.' }] });
  try {
    const result = await runVoice(directory, undefined, { OPENAI_API_KEY: testKey });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /does not say where the voice comes from/);
    assert.match(result.stderr, /angles, elevenlabs, openai, minimax, recorded, none/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reports which keys are set without printing them', async () => {
  const directory = await workspace({ lines: [] });
  try {
    const result = await runVoice(directory, ['--providers'], { OPENAI_API_KEY: testKey });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /openai\s+OPENAI_API_KEY is set/);
    assert.match(result.stdout, /elevenlabs\s+ELEVENLABS_API_KEY is not set/);
    assert.ok(!result.stdout.includes(testKey));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('lists the narrators an Angles account speaks in, a language at a time', async () => {
  const directory = await workspace({ lines: [] });
  try {
    await withServer(
      (request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            voices: [
              { language: 'en', label: 'English', voice: 'en-US-AndrewMultilingualNeural', description: 'Man', default: true },
              { language: 'zh-CN', label: '简体中文', voice: 'zh-CN-XiaoxiaoNeural', description: 'Woman', default: true },
              { language: 'zh-CN', label: '简体中文', voice: 'zh-CN-YunyangNeural', description: 'Man', default: false },
            ],
          })
        );
      },
      async (baseUrl, requests) => {
        const env = { ANGLES_API_KEY: testKey, ANGLES_API_BASE_URL: baseUrl };
        const chinese = await runVoice(directory, ['--voices', 'zh-CN'], env);
        assert.equal(chinese.code, 0, chinese.stderr);
        assert.equal(requests[0].method, 'GET');
        assert.equal(requests[0].url, '/audio/voices');
        assert.equal(requests[0].headers.authorization, `Bearer ${testKey}`);
        assert.match(chinese.stdout, /^zh-CN  zh-CN-XiaoxiaoNeural  Woman  \(the language's own\)\nzh-CN  zh-CN-YunyangNeural   Man\n/);
        assert.doesNotMatch(chinese.stdout, /en-US/);
        assert.match(chinese.stdout, /"id": "<name>"/);
        assert.ok(!chinese.stdout.includes(testKey));

        const all = await runVoice(directory, ['--voices'], env);
        assert.match(all.stdout, /^en     en-US-AndrewMultilingualNeural  Man  \(the language's own\)$/m);

        const none = await runVoice(directory, ['--voices', 'ko'], env);
        assert.equal(none.code, 1);
        assert.match(none.stderr, /Angles has no voice for "ko"/);
      }
    );

    const unset = await runVoice(directory, ['--voices']);
    assert.equal(unset.code, 1);
    assert.match(unset.stderr, /ANGLES_API_KEY is not set/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('voices each line through OpenAI and measures what comes back', measuring, async () => {
  const directory = await workspace(twoLines({ provider: 'openai', id: 'ash' }));
  try {
    await withServer(
      (request, response) => response.end(wav(request.body.input.startsWith('Your') ? 1.5 : 0.75)),
      async (baseUrl, requests) => {
        const result = await runVoice(directory, undefined, { OPENAI_API_KEY: testKey, OPENAI_BASE_URL: baseUrl });
        assert.equal(result.code, 0, result.stderr);
        assert.equal(requests.length, 2);
        assert.equal(requests[0].method, 'POST');
        assert.equal(requests[0].url, '/audio/speech');
        assert.equal(requests[0].headers.authorization, `Bearer ${testKey}`);
        assert.deepEqual(requests[0].body, {
          model: 'gpt-4o-mini-tts',
          voice: 'ash',
          input: 'Your product ships every week.',
          response_format: 'mp3',
        });
        assert.ok(!result.stdout.includes(testKey));
      }
    );
    const track = await readTrack(directory);
    assert.equal(track.clips[0].src, 'voice/ep01/l01.mp3');
    assert.equal(track.clips[0].kind, 'audio');
    assert.ok(Math.abs(track.clips[0].seconds - 1.5) < 0.01);
    assert.ok(Math.abs(track.clips[1].at - (0.35 + 1.5 + 0.35)) < 0.02);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('voices through ElevenLabs with the voice in the path and the key in its own header', measuring, async () => {
  const directory = await workspace(twoLines({ provider: 'elevenlabs', id: 'voice-123' }));
  try {
    await withServer(
      (request, response) => response.end(wav(1)),
      async (baseUrl, requests) => {
        const result = await runVoice(directory, undefined, { ELEVENLABS_API_KEY: testKey, ELEVENLABS_BASE_URL: baseUrl });
        assert.equal(result.code, 0, result.stderr);
        assert.equal(requests[0].url, '/v1/text-to-speech/voice-123?output_format=mp3_44100_128');
        assert.equal(requests[0].headers['xi-api-key'], testKey);
        assert.deepEqual(requests[0].body, { text: 'Your product ships every week.', model_id: 'eleven_multilingual_v2' });
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('decodes MiniMax audio, and reports the reason when it refuses', measuring, async () => {
  const directory = await workspace(twoLines({ provider: 'minimax' }));
  try {
    await withServer(
      (request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: wav(1).toString('hex') } }));
      },
      async (baseUrl, requests) => {
        const result = await runVoice(directory, undefined, { MINIMAX_API_KEY: testKey, MINIMAX_BASE_URL: baseUrl });
        assert.equal(result.code, 0, result.stderr);
        assert.equal(requests[0].url, '/v1/t2a_v2');
        assert.equal(requests[0].body.voice_setting.voice_id, 'English_magnetic_voiced_man');
        assert.equal(requests[0].body.text, 'Your product ships every week.');
      }
    );
    await withServer(
      (request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ base_resp: { status_code: 2013, status_msg: 'invalid params, voice id wrong' } }));
      },
      async baseUrl => {
        const result = await runVoice(directory, ['src/ep01.script.json', '--force'], {
          MINIMAX_API_KEY: testKey,
          MINIMAX_BASE_URL: baseUrl,
        });
        assert.equal(result.code, 1);
        assert.match(result.stderr, /minimax could not voice l01: invalid params, voice id wrong/);
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('voices again only the lines that changed', measuring, async () => {
  const script = twoLines({ provider: 'openai' });
  const directory = await workspace(script);
  try {
    await withServer(
      (request, response) => response.end(wav(1)),
      async (baseUrl, requests) => {
        const env = { OPENAI_API_KEY: testKey, OPENAI_BASE_URL: baseUrl };
        await runVoice(directory, undefined, env);
        assert.equal(requests.length, 2);

        // A change of pacing is not a change of words.
        script.lines[1].pause = 1.2;
        await setScript(directory, script);
        await runVoice(directory, undefined, env);
        assert.equal(requests.length, 2);
        assert.ok(Math.abs((await readTrack(directory)).clips[1].at - (0.35 + 1 + 1.2)) < 0.02);

        script.lines[1].text = 'The video about it never does.';
        await setScript(directory, script);
        await runVoice(directory, undefined, env);
        assert.equal(requests.length, 3);
        assert.equal(requests[2].body.input, 'The video about it never does.');

        await runVoice(directory, ['src/ep01.script.json', '--redo', 'l01'], env);
        assert.equal(requests.length, 4);
        assert.equal(requests[3].body.input, 'Your product ships every week.');

        // A different voice makes every earlier clip the wrong voice.
        script.voice.id = 'sage';
        await setScript(directory, script);
        await runVoice(directory, undefined, env);
        assert.equal(requests.length, 6);
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('gives the voice `say` and keeps `text` for the caption', measuring, async () => {
  const script = twoLines({ provider: 'openai' });
  script.lines[0] = { id: 'l01', text: 'Zhai Zuojun lit two candles.', say: 'Jai Dzwo-jwun lit two candles.' };
  const directory = await workspace(script);
  try {
    await withServer(
      (request, response) => response.end(wav(1)),
      async (baseUrl, requests) => {
        const env = { OPENAI_API_KEY: testKey, OPENAI_BASE_URL: baseUrl };
        await runVoice(directory, undefined, env);
        assert.equal(requests[0].body.input, 'Jai Dzwo-jwun lit two candles.');
        const [first, second] = (await readTrack(directory)).clips;
        assert.equal(first.text, 'Zhai Zuojun lit two candles.');
        assert.equal(first.say, 'Jai Dzwo-jwun lit two candles.');
        assert.equal('say' in second, false);

        // A caption corrected on screen is not a line said differently.
        script.lines[0].text = 'Zhai Zuojun lit the two candles.';
        await setScript(directory, script);
        await runVoice(directory, undefined, env);
        assert.equal(requests.length, 2);
        assert.equal((await readTrack(directory)).clips[0].text, 'Zhai Zuojun lit the two candles.');

        // A new respelling is: that line, and only that line, is voiced again.
        script.lines[0].say = 'Jie Dzwo-jwun lit the two candles.';
        await setScript(directory, script);
        await runVoice(directory, undefined, env);
        assert.equal(requests.length, 3);
        assert.equal(requests[2].body.input, 'Jie Dzwo-jwun lit the two candles.');

        // Taking the respelling away goes back to saying the caption.
        delete script.lines[0].say;
        await setScript(directory, script);
        await runVoice(directory, undefined, env);
        assert.equal(requests.length, 4);
        assert.equal(requests[3].body.input, 'Zhai Zuojun lit the two candles.');
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses an empty `say`', async () => {
  const script = twoLines({ provider: 'none' });
  script.lines[0].say = ' ';
  const directory = await workspace(script);
  try {
    const result = await runVoice(directory);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /"say" on l01 is what the voice is given in place of "text"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('measures the lines a person recorded and says which are still missing', measuring, async () => {
  const script = twoLines({ provider: 'recorded' });
  const directory = await workspace(script);
  try {
    await mkdir(join(directory, 'public', 'takes', 'ep01'), { recursive: true });
    await writeFile(join(directory, 'public', 'takes', 'ep01', 'l01.wav'), wav(2));

    const result = await runVoice(directory);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /l02 is not recorded yet/);
    const track = await readTrack(directory);
    assert.equal(track.clips[0].src, 'takes/ep01/l01.wav');
    assert.equal(track.clips[0].kind, 'audio');
    assert.ok(Math.abs(track.clips[0].seconds - 2) < 0.01);
    assert.equal(track.clips[1].src, null);
    assert.equal(track.clips[1].kind, 'silent');

    script.lines[0].text = 'Your product ships every single week.';
    await setScript(directory, script);
    const reworded = await runVoice(directory);
    assert.match(reworded.stdout, /l01 was reworded after it was recorded/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('voices through the Angles account, and notices a line spoken by its fallback voice', measuring, async () => {
  const script = twoLines({ provider: 'angles', language: 'en' });
  const directory = await workspace(script);
  try {
    let fallback = 'l02';
    await withServer(
      (request, response) => {
        const second = request.body.text.startsWith('The video');
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            audio: wav(second ? 0.75 : 1.5).toString('base64'),
            format: 'mp3',
            provider: second && fallback === 'l02' ? 'edge-tts' : 'minimax',
          })
        );
      },
      async (baseUrl, requests) => {
        const env = { ANGLES_API_KEY: testKey, ANGLES_API_BASE_URL: baseUrl };
        const result = await runVoice(directory, undefined, env);
        assert.equal(result.code, 0, result.stderr);
        assert.equal(requests[0].url, '/audio/voice');
        assert.equal(requests[0].headers.authorization, `Bearer ${testKey}`);
        assert.deepEqual(requests[0].body, { text: 'Your product ships every week.', language: 'en' });
        assert.match(result.stdout, /note: l02 was spoken by a different voice provider than the rest \(minimax\)\. Voice it again: --redo l02/);
        assert.ok(!result.stdout.includes(testKey));

        const track = await readTrack(directory);
        assert.equal(track.clips[0].src, 'voice/ep01/l01.mp3');
        assert.ok(Math.abs(track.clips[0].seconds - 1.5) < 0.01);
        assert.equal(track.clips[1].speaker, 'edge-tts');

        // Voicing the odd line again clears the note, and costs one request.
        fallback = null;
        const redone = await runVoice(directory, ['src/ep01.script.json', '--redo', 'l02'], env);
        assert.equal(requests.length, 3);
        assert.doesNotMatch(redone.stdout, /different voice provider/);
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('says what Angles said when it will not voice a line', async () => {
  const directory = await workspace(twoLines({ provider: 'angles' }));
  try {
    await withServer(
      (request, response) => {
        response.statusCode = 401;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ message: 'Invalid API key.' }));
      },
      async baseUrl => {
        const result = await runVoice(directory, undefined, { ANGLES_API_KEY: testKey, ANGLES_API_BASE_URL: baseUrl });
        assert.equal(result.code, 1);
        assert.match(result.stderr, /angles could not voice l01: HTTP 401 Invalid API key\./);
        assert.ok(!result.stderr.includes(testKey));
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
