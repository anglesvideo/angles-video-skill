import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const clientPath = fileURLToPath(
  new URL('../skills/create-launch-video/scripts/angles.mjs', import.meta.url)
);
const testKey = 'angles_sk_test_secret_that_must_not_leak';

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
