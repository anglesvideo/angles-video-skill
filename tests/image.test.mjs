import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The starter's picture script, exercised from `src/`, the copy the Skills
// are synced from.
const script = fileURLToPath(new URL('../src/starter/scripts/image.mjs', import.meta.url));
const testKey = 'image_key_that_must_not_leak';

/** The start of a JPEG of a given size: a header segment, then the frame header. */
function jpegOf(width, height) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const frame = Buffer.alloc(19);
  frame.writeUInt16BE(0xffc0, 0);
  frame.writeUInt16BE(17, 2);
  frame[4] = 8;
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, frame, Buffer.alloc(32)]);
}

/** The start of a PNG of a given size. */
function pngOf(width, height) {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

async function run(directory, args, env = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: directory,
    env: { ...process.env, ANGLES_API_KEY: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

/** Angles, as far as pictures go: `reply(request)` decides what one call gets back. */
async function withAngles(reply, runWith) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const seen = { method: request.method, url: request.url, headers: request.headers, body: body ? JSON.parse(body) : null };
    requests.push(seen);
    const { status = 201, ...json } = reply(seen, requests.length);
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(json));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const directory = await mkdtemp(join(tmpdir(), 'angles-image-'));
  try {
    const env = { ANGLES_API_KEY: testKey, ANGLES_API_BASE_URL: `http://127.0.0.1:${server.address().port}` };
    return await runWith({ directory, env, requests });
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const made = (bytes, format, extra = {}) => ({
  image: bytes.toString('base64'),
  format,
  aspect: '16:9',
  provider: 'evolink',
  model: 'doubao-seedream-4.0',
  remaining: 29,
  ...extra,
});

test('makes a picture, keeps the file, and records what it is and that it was made', async () => {
  await withAngles(
    () => made(jpegOf(2560, 1440), 'jpg'),
    async ({ directory, env, requests }) => {
      const words = 'A harbour at night, flat gouache, teal and amber, no text';
      const result = await run(directory, ['harbour', words], env);

      assert.equal(result.code, 0, result.stderr);
      assert.equal(requests[0].method, 'POST');
      assert.equal(requests[0].url, '/images');
      assert.equal(requests[0].headers.authorization, `Bearer ${testKey}`);
      assert.deepEqual(requests[0].body, { prompt: words, aspect: '16:9' });

      assert.deepEqual(await readFile(join(directory, 'public', 'images', 'harbour.jpg')), jpegOf(2560, 1440));
      const pictures = JSON.parse(await readFile(join(directory, 'src', 'images.json'), 'utf8'));
      assert.deepEqual(pictures.harbour, {
        src: 'images/harbour.jpg',
        width: 2560,
        height: 1440,
        generated: true,
        model: 'doubao-seedream-4.0',
        asked: { text: words, aspect: '16:9' },
      });
      assert.match(result.stdout, /harbour: images\/harbour\.jpg, 2560×1440, made by doubao-seedream-4\.0\. 29 left today\./);
      assert.match(result.stdout, /Open it before it goes into a scene/);
      assert.doesNotMatch(result.stdout + result.stderr, new RegExp(testKey));

      const listed = await run(directory, ['--list'], env);
      assert.match(listed.stdout, /harbour\s+2560×1440\s+images\/harbour\.jpg\s+A harbour at night/);
    }
  );
});

test('does not spend a picture on the same words twice, and does on new ones', async () => {
  await withAngles(
    (request, count) => (count < 3 ? made(jpegOf(1440, 2560), 'jpg', { aspect: '9:16' }) : made(pngOf(1440, 2560), 'png', { aspect: '9:16' })),
    async ({ directory, env, requests }) => {
      const args = ['cover', 'A lighthouse, linocut', '--aspect', '9:16'];
      await run(directory, args, env);
      const again = await run(directory, args, env);
      assert.equal(requests.length, 1);
      assert.match(again.stdout, /cover is already made: images\/cover\.jpg, 1440×2560/);
      assert.equal(requests[0].body.aspect, '9:16');

      await run(directory, [...args, '--force'], env);
      assert.equal(requests.length, 2);

      // New words make a new picture under the same name; a file in the old format does not stay behind.
      const reworded = await run(directory, ['cover', 'A lighthouse at dawn, linocut', '--aspect', '9:16'], env);
      assert.equal(reworded.code, 0, reworded.stderr);
      assert.equal(requests.length, 3);
      assert.equal(existsSync(join(directory, 'public', 'images', 'cover.png')), true);
      assert.equal(existsSync(join(directory, 'public', 'images', 'cover.jpg')), false);
      const pictures = JSON.parse(await readFile(join(directory, 'src', 'images.json'), 'utf8'));
      assert.equal(pictures.cover.src, 'images/cover.png');
      assert.equal(pictures.cover.asked.text, 'A lighthouse at dawn, linocut');
    }
  );
});

test('passes on what Angles says when it will not make a picture', async () => {
  await withAngles(
    () => ({
      status: 429,
      message: 'This account has made 30 pictures in the last 24 hours; the limit is 30. Try again later.',
      details: { code: 'IMAGE_DAILY_LIMIT_REACHED', message: 'This account has made 30 pictures in the last 24 hours; the limit is 30. Try again later.' },
    }),
    async ({ directory, env }) => {
      const result = await run(directory, ['harbour', 'A harbour at night'], env);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /angles could not make harbour: HTTP 429 This account has made 30 pictures/);
      assert.equal(existsSync(join(directory, 'src', 'images.json')), false);
    }
  );
});

test('refuses a reply that is not a picture rather than saving it', async () => {
  await withAngles(
    () => made(Buffer.from('<html>not a picture</html>'), 'jpg'),
    async ({ directory, env }) => {
      const result = await run(directory, ['harbour', 'A harbour at night'], env);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /not a picture/);
      assert.equal(existsSync(join(directory, 'public', 'images', 'harbour.jpg')), false);
    }
  );
});

test('asks for nothing when the request could not be right', async () => {
  await withAngles(
    () => made(jpegOf(2560, 1440), 'jpg'),
    async ({ directory, env, requests }) => {
      const shape = await run(directory, ['harbour', 'A harbour', '--aspect', '21:9'], env);
      assert.match(shape.stderr, /--aspect takes one of 16:9, 9:16, 1:1, 4:3, 3:4/);
      const name = await run(directory, ['my harbour', 'A harbour'], env);
      assert.match(name.stderr, /usage: node scripts\/image\.mjs/);
      const wordless = await run(directory, ['harbour'], env);
      assert.match(wordless.stderr, /usage: node scripts\/image\.mjs/);
      const long = await run(directory, ['harbour', 'a'.repeat(1501)], env);
      assert.match(long.stderr, /1501 characters/);
      const keyless = await run(directory, ['harbour', 'A harbour'], { ...env, ANGLES_API_KEY: '' });
      assert.match(keyless.stderr, /ANGLES_API_KEY is not set/);
      for (const result of [shape, name, wordless, long, keyless]) assert.equal(result.code, 1);
      assert.equal(requests.length, 0);
    }
  );
});
