import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { SHARED_FILES } from '../scripts/sync-client.mjs';

const clientPath = fileURLToPath(
  new URL('../skills/create-launch-video/scripts/angles.mjs', import.meta.url)
);
const testKey = 'angles_sk_test_secret_that_must_not_leak';

// Each Skill is installed on its own from its own directory URL, so each one
// ships the client rather than reaching for a shared copy. The suite exercises
// one of them, which is only sound while the copies are identical.
const SKILL_FILES = ['scripts/angles.mjs', 'references/api.md'];
const SKILLS_SHARING_THE_CLIENT = ['create-launch-video', 'create-video-from-recording'];

test('every Skill ships the same client and API reference', async () => {
  for (const file of SKILL_FILES) {
    const [first, ...rest] = await Promise.all(
      SKILLS_SHARING_THE_CLIENT.map(skill =>
        readFile(fileURLToPath(new URL(`../skills/${skill}/${file}`, import.meta.url)), 'utf8')
      )
    );
    rest.forEach((copy, index) => {
      assert.equal(
        copy,
        first,
        `${SKILLS_SHARING_THE_CLIENT[index + 1]}/${file} has drifted from ${SKILLS_SHARING_THE_CLIENT[0]}/${file}`
      );
    });
  }
});

// The CLI imports `src/client.mjs` while the Skills carry copies of it, so
// `src/` is where a change is made. A copy edited by hand fails here rather
// than shipping a client the CLI and the Skills disagree about.
test('every Skill copy matches its source in src/', async () => {
  for (const [sharedPath, skillPath] of SHARED_FILES) {
    const source = await readFile(fileURLToPath(new URL(`../${sharedPath}`, import.meta.url)), 'utf8');
    for (const skill of SKILLS_SHARING_THE_CLIENT) {
      const copy = await readFile(
        fileURLToPath(new URL(`../skills/${skill}/${skillPath}`, import.meta.url)),
        'utf8'
      );
      assert.equal(
        copy,
        source,
        `skills/${skill}/${skillPath} is out of date with ${sharedPath} — run: npm run sync-client`
      );
    }
  }
});

async function runClient(args, { baseUrl, input } = {}) {
  const child = spawn(process.execPath, [clientPath, ...args], {
    env: {
      ...process.env,
      ANGLES_API_KEY: testKey,
      ...(baseUrl ? { ANGLES_API_BASE_URL: baseUrl } : {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', chunk => {
    stderr += chunk;
  });
  if (input) child.stdin.write(input);
  child.stdin.end();
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

async function withServer(handler, run) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('sends structured concept input with bearer authentication', async () => {
  await withServer(async (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/concepts');
    assert.equal(request.headers.authorization, `Bearer ${testKey}`);
    let body = '';
    for await (const chunk of request) body += chunk;
    assert.equal(JSON.parse(body).productName, 'Angles');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ projectId: 'project-1', concepts: [] }));
  }, async baseUrl => {
    const result = await runClient(['concepts', '--input', '-'], {
      baseUrl,
      input: JSON.stringify({ productName: 'Angles' }),
    });
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).projectId, 'project-1');
    assert.equal(result.stderr.includes(testKey), false);
  });
});

test('reports the rejected fields behind a 400 instead of the exception name', async () => {
  await withServer((request, response) => {
    response.statusCode = 400;
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        statusCode: 400,
        message: 'Bad Request Exception',
        details: {
          statusCode: 400,
          message: [
            'productSummary should not be empty',
            'property aspectRatio should not exist',
          ],
          error: 'Bad Request',
        },
      })
    );
  }, async baseUrl => {
    const result = await runClient(['concepts', '--input', '-'], {
      baseUrl,
      input: JSON.stringify({ productName: 'Angles' }),
    });

    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stderr);
    assert.equal(
      payload.error,
      'productSummary should not be empty; property aspectRatio should not exist'
    );
    assert.equal(payload.status, 400);
    assert.deepEqual(payload.details.message, [
      'productSummary should not be empty',
      'property aspectRatio should not exist',
    ]);
    assert.equal(result.stderr.includes(testKey), false);
  });
});

test('keeps a gateway error page readable instead of dumping it', async () => {
  await withServer((request, response) => {
    response.statusCode = 524;
    response.setHeader('content-type', 'text/html');
    response.end(`<html><body>${'origin timed out '.repeat(200)}</body></html>`);
  }, async baseUrl => {
    const result = await runClient(['status', '--video', 'video-1'], { baseUrl });

    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.status, 524);
    assert.ok(payload.error.length <= 201, `error text was ${payload.error.length} characters`);
    assert.match(payload.error, /origin timed out/);
  });
});

test('uploads a local file as multipart with its own content type', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/clip.mp4', import.meta.url));
  await mkdir(dirname(fixture), { recursive: true });
  await writeFile(fixture, Buffer.from('not really a video, but the bytes travel the same'));

  try {
    await withServer(async (request, response) => {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/assets');
      assert.match(request.headers['content-type'], /^multipart\/form-data; boundary=/);
      let body = '';
      for await (const chunk of request) body += chunk;
      assert.match(body, /name="file"; filename="clip\.mp4"/);
      assert.match(body, /Content-Type: video\/mp4/);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ url: 'https://cdn.test/clip.mp4', type: 'video', fps: 30 }));
    }, async baseUrl => {
      const result = await runClient(['upload', '--file', fixture], { baseUrl });
      assert.equal(result.code, 0);
      assert.equal(JSON.parse(result.stdout).url, 'https://cdn.test/clip.mp4');
    });
  } finally {
    await rm(dirname(fixture), { recursive: true, force: true });
  }
});

test('refuses a file type Angles cannot read, before uploading it', async () => {
  const result = await runClient(['upload', '--file', 'notes.txt']);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /does not accept \.txt/);
});

test('explains an oversized upload instead of sending it', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/big.mov', import.meta.url));
  await mkdir(dirname(fixture), { recursive: true });
  await writeFile(fixture, Buffer.alloc(51 * 1024 * 1024));

  try {
    const result = await runClient(['upload', '--file', fixture]);

    assert.equal(result.code, 1);
    const { error } = JSON.parse(result.stderr);
    assert.match(error, /51\.0MB and the limit is 50MB/);
    assert.match(error, /ffmpeg -i /);
  } finally {
    await rm(dirname(fixture), { recursive: true, force: true });
  }
});

test('says what a gateway timeout means for quota and retries', async () => {
  await withServer((request, response) => {
    response.statusCode = 524;
    response.setHeader('content-type', 'text/html');
    response.end('<html><body>origin timed out</body></html>');
  }, async baseUrl => {
    const result = await runClient(['concepts', '--input', '-'], {
      baseUrl,
      input: JSON.stringify({ productName: 'Angles' }),
    });

    assert.equal(result.code, 1);
    const { hint } = JSON.parse(result.stderr);
    assert.match(hint, /may still be completing/);
    assert.match(hint, /Only render spends a video allowance/);
    assert.match(hint, /duplicate project/);
  });
});

test('previews a render without confirming it', async () => {
  await withServer(async (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/videos/video-1/render/preview');
    let body = '';
    for await (const chunk of request) body += chunk;
    assert.deepEqual(JSON.parse(body), {
      templateId: 'screen_demo',
      productVideos: [{ url: 'https://cdn.test/one.mp4' }, { url: 'https://cdn.test/two.mp4' }],
    });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ canRender: true, blockers: [], unusedMedia: [] }));
  }, async baseUrl => {
    const result = await runClient([
      'preview',
      '--video',
      'video-1',
      '--template',
      'screen_demo',
      '--video-asset',
      'https://cdn.test/one.mp4',
      '--video-asset',
      'https://cdn.test/two.mp4',
    ], { baseUrl });

    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).canRender, true);
  });
});

test('gives media its own idempotency key so a corrected clip is not a replay', async () => {
  const observedKeys = [];
  await withServer((request, response) => {
    observedKeys.push(request.headers['idempotency-key']);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: 'video-1', status: 'rendering' }));
  }, async baseUrl => {
    const args = asset => [
      'render',
      '--video',
      'video-1',
      '--template',
      'screen_demo',
      '--video-asset',
      asset,
      '--confirm',
    ];
    await runClient(args('https://cdn.test/first.mp4'), { baseUrl });
    await runClient(args('https://cdn.test/second.mp4'), { baseUrl });
    await runClient(args('https://cdn.test/first.mp4'), { baseUrl });
  });

  assert.notEqual(observedKeys[0], observedKeys[1]);
  assert.equal(observedKeys[0], observedKeys[2]);
});

test('carries what the upload measured when given the saved upload result', async () => {
  const uploadPath = fileURLToPath(new URL('./.tmp-upload-result.json', import.meta.url));
  const analysis = { version: 1, method: 'visual-activity', durationSeconds: 30, cuts: [9], pauses: [] };
  await writeFile(uploadPath, JSON.stringify({
    success: true,
    url: 'https://cdn.test/recording.mp4',
    key: 'uploads/recording.mp4',
    type: 'video',
    durationSeconds: 30,
    width: 1920,
    height: 1080,
    fps: 30,
    recordingAnalysis: analysis,
  }));
  try {
    await withServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      assert.deepEqual(JSON.parse(body), {
        templateId: 'screen_studio',
        recordingPacing: 'concise',
        productVideos: [{
          url: 'https://cdn.test/recording.mp4',
          durationSeconds: 30,
          width: 1920,
          height: 1080,
          recordingAnalysis: analysis,
        }],
      });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ canRender: true }));
    }, async baseUrl => {
      const result = await runClient([
        'preview', '--video', 'video-1', '--template', 'screen_studio',
        '--pacing', 'concise', '--video-asset', uploadPath,
      ], { baseUrl });
      assert.equal(result.code, 0, result.stderr);
    });
  } finally {
    await rm(uploadPath, { force: true });
  }
});

test('rejects an unknown pacing before sending anything', async () => {
  const result = await runClient([
    'preview', '--video', 'video-1', '--template', 'screen_studio', '--pacing', 'fast',
  ], { baseUrl: 'http://127.0.0.1:9' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--pacing must be one of complete, concise/);
});

test('rejects a non-HTTPS asset URL before sending it', async () => {
  const result = await runClient([
    'preview',
    '--video',
    'video-1',
    '--template',
    'screen_demo',
    '--video-asset',
    'http://cdn.test/insecure.mp4',
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /must use HTTPS/);
});

test('requires explicit confirmation before render', async () => {
  const result = await runClient([
    'render',
    '--video',
    'video-1',
    '--template',
    'developer-demo',
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Re-run with --confirm/);
  assert.equal(result.stderr.includes(testKey), false);
});

test('reuses a stable idempotency key for render retries', async () => {
  const observedKeys = [];
  await withServer((request, response) => {
    observedKeys.push(request.headers['idempotency-key']);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: 'video-1', status: 'rendering' }));
  }, async baseUrl => {
    const args = [
      'render',
      '--video',
      'video-1',
      '--template',
      'developer-demo',
      '--confirm',
    ];
    const first = await runClient(args, { baseUrl });
    const second = await runClient(args, { baseUrl });
    assert.equal(first.code, 0);
    assert.equal(second.code, 0);
  });

  assert.equal(observedKeys.length, 2);
  assert.match(observedKeys[0], /^skill-[a-f0-9]{40}$/);
  assert.equal(observedKeys[0], observedKeys[1]);
});

test('sends a named background-music track and volume with the render request', async () => {
  await withServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    assert.deepEqual(JSON.parse(body), {
      templateId: 'aspiration',
      confirmed: true,
      backgroundMusicUrl: 'https://assets.mixkit.co/music/150/150.mp3',
      backgroundMusicVolume: 0.25,
    });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: 'video-3', status: 'rendering' }));
  }, async baseUrl => {
    const result = await runClient([
      'render',
      '--video',
      'video-3',
      '--template',
      'aspiration',
      '--music',
      'A Blue Day',
      '--music-volume',
      '0.25',
      '--confirm',
    ], { baseUrl });
    assert.equal(result.code, 0);
  });
});

test('rejects a background-music volume outside the supported range', async () => {
  const result = await runClient([
    'render',
    '--video',
    'video-1',
    '--template',
    'developer-demo',
    '--music-volume',
    '25',
    '--confirm',
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /number from 0 to 1/);
});

test('rejects an unknown background-music name before rendering', async () => {
  const result = await runClient([
    'render',
    '--video',
    'video-1',
    '--template',
    'developer-demo',
    '--music',
    'Unknown Track',
    '--confirm',
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /bundled track name/);
});
