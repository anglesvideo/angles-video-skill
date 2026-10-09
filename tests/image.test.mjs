import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
    // A picture sent to draw from arrives as a form, not as JSON: keep what it is, not its bytes.
    const isJson = String(request.headers['content-type']).startsWith('application/json');
    const seen = { method: request.method, url: request.url, headers: request.headers, body: body && isJson ? JSON.parse(body) : null, form: !isJson && body ? body : null };
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
  credits: { charged: 5, balance: 195 },
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
      assert.match(result.stdout, /harbour: images\/harbour\.jpg, 2560×1440, made by doubao-seedream-4\.0\. 5 credits; 195 left\./);
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
      status: 402,
      message: 'This needs 5 credits and the account has 2. Add credits at https://angles.video/credits.',
      details: {
        code: 'CREDITS_INSUFFICIENT',
        message: 'This needs 5 credits and the account has 2. Add credits at https://angles.video/credits.',
        credits: { required: 5, balance: 2 },
      },
    }),
    async ({ directory, env }) => {
      const result = await run(directory, ['harbour', 'A harbour at night'], env);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /angles could not make harbour: HTTP 402 This needs 5 credits and the account has 2\. Add credits at https:\/\/angles\.video\/credits\./);
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

// ——— One hand for every picture ———

const STYLE = 'Flat gouache, deep teal and warm amber, no text';
const IN_ITS_STYLE = /Drawn in the same style as the reference picture: the same medium, palette and brushwork\. A different scene/;
const THE_SAME_AGAIN = /Drawn from the reference picture: the same place and things in the same style, changed only as these words say\./;
const stampOf = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/** Angles with storage: an upload gets a link, and each picture made is a little different from the last. */
function studio() {
  let uploads = 0;
  let pictures = 0;
  return request => {
    if (request.url === '/assets') return { success: true, url: `https://cdn.test/screenshots/${++uploads}.jpg`, type: 'image' };
    return made(jpegOf(2848, 1600 + pictures++), 'jpg', { credits: { charged: 5, balance: 200 - 5 * pictures } });
  };
}

const read = async (directory, file) => JSON.parse(await readFile(join(directory, 'src', file), 'utf8'));

test('with a style set, the first picture is drawn from the words and every later one is drawn like it', async () => {
  await withAngles(studio(), async ({ directory, env, requests }) => {
    const set = await run(directory, ['--style', STYLE], env);
    assert.equal(set.code, 0, set.stderr);
    assert.match(set.stdout, /Style: Flat gouache, deep teal and warm amber, no text\nThe next picture made becomes the one the others are drawn like\./);
    assert.equal(requests.length, 0);

    const first = await run(directory, ['harbour', 'A harbour at night, three boats low in the frame'], env);
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(requests[0].body, { prompt: `A harbour at night, three boats low in the frame. ${STYLE}.`, aspect: '16:9' });
    assert.match(first.stdout, /harbour is now the picture every later one is drawn like\. Open it first/);
    assert.deepEqual(await read(directory, 'images.style.json'), { words: STYLE, like: 'harbour' });

    const second = await run(directory, ['desk', "A keeper's desk seen from above.", '--aspect', '9:16'], env);
    assert.equal(second.code, 0, second.stderr);
    // The harbour is sent once, as a file, and the picture is asked for with the link to it.
    assert.equal(requests[1].url, '/assets');
    assert.equal(requests[1].headers.authorization, `Bearer ${testKey}`);
    assert.match(requests[1].headers['content-type'], /^multipart\/form-data/);
    assert.match(requests[1].form, /filename="harbour\.jpg"\r\nContent-Type: image\/jpeg/);
    assert.equal(requests[2].url, '/images');
    assert.deepEqual(requests[2].body.references, ['https://cdn.test/screenshots/1.jpg']);
    assert.equal(requests[2].body.aspect, '9:16');
    assert.ok(requests[2].body.prompt.startsWith(`A keeper's desk seen from above. ${STYLE}. Drawn in the same style`));
    assert.match(requests[2].body.prompt, IN_ITS_STYLE);
    assert.match(second.stdout, /desk: images\/desk\.jpg, 2848×1601, made by doubao-seedream-4\.0, drawn like harbour\. 5 credits; 190 left\./);

    const pictures = await read(directory, 'images.json');
    const harbourStamp = stampOf(await readFile(join(directory, 'public', 'images', 'harbour.jpg')));
    assert.deepEqual(pictures.desk.asked, { text: "A keeper's desk seen from above.", aspect: '9:16', style: STYLE });
    assert.deepEqual(pictures.desk.from, { harbour: harbourStamp });
    assert.deepEqual(pictures.harbour.uploaded, { of: harbourStamp, url: 'https://cdn.test/screenshots/1.jpg' });
    assert.equal(pictures.harbour.from, undefined);

    // A third picture is drawn like the same harbour without sending it again; none is made twice.
    await run(directory, ['tram', 'An empty tram stop in the rain'], env);
    assert.deepEqual(requests.slice(3).map(request => request.url), ['/images']);
    for (const args of [['harbour', 'A harbour at night, three boats low in the frame'], ['desk', "A keeper's desk seen from above.", '--aspect', '9:16']]) {
      assert.match((await run(directory, args, env)).stdout, /is already made/);
    }
    assert.equal(requests.length, 4);

    const listed = await run(directory, ['--list'], env);
    assert.match(listed.stdout, /^Style: Flat gouache.*\nEvery picture is drawn like harbour\.\nharbour .*\[the others are drawn like this\] A harbour at night/);
    assert.doesNotMatch(listed.stdout, /desk .*\[/);
    assert.doesNotMatch(set.stdout + first.stdout + second.stdout + listed.stdout, new RegExp(testKey));
  });
});

test('--like draws the same place again, changed as the words say', async () => {
  await withAngles(studio(), async ({ directory, env, requests }) => {
    await run(directory, ['harbour', 'A harbour at night'], env);
    const dawn = await run(directory, ['dawn', 'The harbour at dawn, the window dark', '--like', 'harbour'], env);
    assert.equal(dawn.code, 0, dawn.stderr);
    assert.deepEqual(requests.map(request => request.url), ['/images', '/assets', '/images']);
    assert.deepEqual(requests[2].body.references, ['https://cdn.test/screenshots/1.jpg']);
    assert.equal(requests[2].body.prompt, 'The harbour at dawn, the window dark. Drawn from the reference picture: the same place and things in the same style, changed only as these words say.');
    assert.match(requests[2].body.prompt, THE_SAME_AGAIN);
    assert.match(dawn.stdout, /dawn: images\/dawn\.jpg, .* drawn from harbour\./);
    const pictures = await read(directory, 'images.json');
    assert.deepEqual(pictures.dawn.asked, { text: 'The harbour at dawn, the window dark', aspect: '16:9', like: 'harbour' });

    // With no style set, nothing is drawn like anything unless it is asked to be.
    await run(directory, ['desk', 'A desk'], env);
    assert.deepEqual(requests[3].body, { prompt: 'A desk', aspect: '16:9' });

    const unknown = await run(directory, ['noon', 'The harbour at noon', '--like', 'pier'], env);
    assert.match(unknown.stderr, /There is no picture "pier" to draw from\. There are: harbour, dawn, desk\./);
    const itself = await run(directory, ['dawn', 'The harbour at dawn', '--like', 'dawn'], env);
    assert.match(itself.stderr, /dawn cannot be drawn like itself/);
    const nameless = await run(directory, ['noon', 'The harbour at noon', '--like'], env);
    assert.match(nameless.stderr, /--like takes the name of a picture/);
    assert.equal(requests.length, 4);
  });
});

test('a picture made again leaves the ones drawn from it out of step, and their commands put them right', async () => {
  await withAngles(studio(), async ({ directory, env, requests }) => {
    await run(directory, ['--style', STYLE], env);
    await run(directory, ['harbour', 'A harbour at night'], env);
    await run(directory, ['desk', 'A desk'], env);

    const again = await run(directory, ['harbour', 'A harbour at night', '--force'], env);
    assert.match(again.stdout, /Drawn from the harbour this replaces: desk\. Run each one's command again\./);
    const listed = await run(directory, ['--list'], env);
    assert.match(listed.stdout, /desk .*\[drawn from an earlier harbour\] A desk/);

    const before = requests.length;
    const desk = await run(directory, ['desk', 'A desk'], env);
    assert.doesNotMatch(desk.stdout, /already made/);
    // The new harbour is a different file, so it is sent before the desk is drawn like it.
    assert.deepEqual(requests.slice(before).map(request => request.url), ['/assets', '/images']);
    assert.deepEqual(requests.at(-1).body.references, ['https://cdn.test/screenshots/2.jpg']);
    assert.doesNotMatch((await run(directory, ['--list'], env)).stdout, /desk .*\[/);
  });
});

test('new style words start again: the old pictures are named, and the next one made sets the hand', async () => {
  await withAngles(studio(), async ({ directory, env, requests }) => {
    await run(directory, ['--style', STYLE], env);
    await run(directory, ['harbour', 'A harbour at night'], env);
    await run(directory, ['desk', 'A desk'], env);

    const same = await run(directory, ['--style', STYLE], env);
    assert.match(same.stdout, /Every picture is drawn like harbour\./);

    const changed = await run(directory, ['--style', 'Linocut, two inks'], env);
    assert.match(changed.stdout, /Style: Linocut, two inks\nThe next picture made becomes the one the others are drawn like\.\nMade before this style: harbour, desk\. Run each one's command again/);
    assert.deepEqual(await read(directory, 'images.style.json'), { words: 'Linocut, two inks', like: null });
    assert.match((await run(directory, ['--list'], env)).stdout, /harbour .*\[made before this style\].*\ndesk .*\[made before this style\]/);

    const before = requests.length;
    const desk = await run(directory, ['desk', 'A desk'], env);
    assert.deepEqual(requests.slice(before).map(request => request.url), ['/images']);
    assert.deepEqual(requests.at(-1).body, { prompt: 'A desk. Linocut, two inks.', aspect: '16:9' });
    assert.match(desk.stdout, /desk is now the picture every later one is drawn like/);

    assert.match((await run(directory, ['--style'], env)).stdout, /Style: Linocut, two inks\nEvery picture is drawn like desk\./);
  });
});

test('--style-from names the picture the others are drawn like, with or without style words', async () => {
  await withAngles(studio(), async ({ directory, env, requests }) => {
    assert.match((await run(directory, ['--style'], env)).stdout, /No style is set/);
    await run(directory, ['harbour', 'A harbour at night'], env);
    await run(directory, ['desk', 'A desk'], env);

    const missing = await run(directory, ['--style-from', 'pier'], env);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /There is no picture "pier"\. There are: harbour, desk\./);

    const fixed = await run(directory, ['--style-from', 'harbour'], env);
    assert.match(fixed.stdout, /^Every picture is drawn like harbour\.\nNot drawn like it yet: desk\. Run each one's command again\.\n$/);
    assert.deepEqual(await read(directory, 'images.style.json'), { words: '', like: 'harbour' });

    const before = requests.length;
    await run(directory, ['desk', 'A desk'], env);
    assert.deepEqual(requests.slice(before).map(request => request.url), ['/assets', '/images']);
    assert.match(requests.at(-1).body.prompt, /^A desk\. Drawn in the same style as the reference picture/);

    const together = await run(directory, ['tram', 'A tram stop', '--style', 'Linocut'], env);
    assert.equal(together.code, 1);
    assert.match(together.stderr, /Set the style in a call of its own/);
    const long = await run(directory, ['--style', 'a'.repeat(301)], env);
    assert.match(long.stderr, /The style is 301 characters; keep it to 300/);
    // The style and the instruction count towards the length a picture can be asked for in.
    const crowded = await run(directory, ['tram', 'a'.repeat(1400)], env);
    assert.match(crowded.stderr, /The description, with the style and what it is drawn from added, is \d+ characters; .* Shorten it by \d+\./);
  });
});

test('says so when the picture to draw from cannot be sent, and sends nothing else', async () => {
  await withAngles(
    (request, count) =>
      request.url === '/assets'
        ? { status: 400, message: 'Bad Request Exception', details: { message: 'The uploaded file content does not match its declared type.' } }
        : made(jpegOf(2848, 1600 + count), 'jpg'),
    async ({ directory, env, requests }) => {
      await run(directory, ['harbour', 'A harbour at night'], env);
      const dawn = await run(directory, ['dawn', 'The harbour at dawn', '--like', 'harbour'], env);
      assert.equal(dawn.code, 1);
      assert.match(dawn.stderr, /angles could not take harbour to draw from: HTTP 400 The uploaded file content does not match its declared type\./);
      assert.deepEqual(requests.map(request => request.url), ['/images', '/assets']);
    }
  );
});
