import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cliPath = fileURLToPath(new URL('../cli/bin/angles.mjs', import.meta.url));
const testKey = 'angles_sk_test_secret_that_must_not_leak';

const CONCEPTS = [
  {
    videoId: 'video-1',
    title: 'Stop chasing invoices',
    sellingAngle: 'Invoices that chase themselves',
    creativeLens: 'before_after',
    hook: 'Stop chasing invoices',
    recommendedTemplates: [{ id: 'bento_grid', name: 'Bento Grid' }],
  },
  {
    videoId: 'video-2',
    title: 'Send your first invoice',
    sellingAngle: 'From signup to paid in a minute',
    creativeLens: 'use_case',
    hook: 'Send your first invoice in 60 seconds',
    recommendedTemplates: [{ id: 'screen_demo', name: 'Screen Demo' }],
  },
  {
    videoId: 'video-3',
    title: 'Invoicing, minus the spreadsheet',
    sellingAngle: 'Clarity',
    creativeLens: 'clarity',
    hook: 'Invoicing, minus the spreadsheet',
    recommendedTemplates: [{ id: 'dynamic', name: 'Dynamic' }],
  },
];

const FROM_URL_RESPONSE = {
  projectId: 'project-1',
  editUrl: 'https://angles.video/projects/project-1/videos',
  concepts: CONCEPTS,
  source: {
    url: 'https://myapp.com/',
    productName: 'MyApp',
    targetAudience: 'Freelancers who invoice clients',
    productImages: ['https://cdn.test/shot-1.png'],
  },
};

async function runCli(args, { baseUrl, env = {} } = {}) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    env: {
      ...process.env,
      ANGLES_API_KEY: testKey,
      ANGLES_POLL_INTERVAL_MS: '10',
      ...(baseUrl ? { ANGLES_API_BASE_URL: baseUrl } : {}),
      ...env,
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
  child.stdin.end();
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

/**
 * A stand-in Angles that records what it was asked for. `rendersBeforeDone` is
 * how many polls report "rendering" before the video is finished, so the poll
 * loop is exercised rather than skipped.
 */
function anglesServer({ rendersBeforeDone = 1 } = {}) {
  const calls = { fromUrl: [], render: [], polls: 0 };
  let remaining = rendersBeforeDone;

  const handler = async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    response.setHeader('content-type', 'application/json');

    if (request.url === '/concepts/from-url') {
      calls.fromUrl.push(JSON.parse(body || '{}'));
      response.end(JSON.stringify(FROM_URL_RESPONSE));
      return;
    }
    const renderMatch = request.url.match(/^\/videos\/([^/]+)\/render$/);
    if (renderMatch) {
      calls.render.push({
        videoId: renderMatch[1],
        idempotencyKey: request.headers['idempotency-key'],
        body: JSON.parse(body || '{}'),
      });
      response.end(JSON.stringify({ id: renderMatch[1], status: 'rendering' }));
      return;
    }
    const videoMatch = request.url.match(/^\/videos\/([^/]+)$/);
    if (videoMatch) {
      calls.polls += 1;
      const done = remaining <= 0;
      remaining -= 1;
      response.end(
        JSON.stringify({
          id: videoMatch[1],
          status: done ? 'rendered' : 'rendering',
          videoUrl: done ? `https://cdn.test/${videoMatch[1]}.mp4` : null,
          editUrl: `https://angles.video/projects/project-1/videos/${videoMatch[1]}`,
        })
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: `Unexpected ${request.method} ${request.url}` }));
  };

  return { handler, calls };
}

async function withServer(handler, run) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('shows every angle before anything is rendered', async () => {
  const { handler, calls } = anglesServer();
  await withServer(handler, async baseUrl => {
    const result = await runCli(['myapp.com'], { baseUrl });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /MyApp/);
    assert.match(result.stdout, /3 angles:/);
    assert.match(result.stdout, /1\) Before\/After/);
    assert.match(result.stdout, /2\) Use Case/);
    assert.match(result.stdout, /3\) Clarity/);
    assert.match(result.stdout, /Bento Grid/);
    // A bare hostname is a URL the user meant; it reaches Angles as one.
    assert.equal(calls.fromUrl[0].url, 'https://myapp.com/');
  });
});

test('renders nothing it could not ask about', async () => {
  const { handler, calls } = anglesServer();
  await withServer(handler, async baseUrl => {
    // stdin is a pipe here, exactly as it is in CI, so no prompt is possible.
    const result = await runCli(['https://myapp.com'], { baseUrl });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Not a terminal, so nothing was rendered/);
    assert.match(result.stdout, /--concept/);
    assert.equal(calls.render.length, 0);
  });
});

test('renders the angle named on the command line', async () => {
  const { handler, calls } = anglesServer({ rendersBeforeDone: 2 });
  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--concept', '2'], { baseUrl });

    assert.equal(result.code, 0);
    assert.equal(calls.render.length, 1);
    assert.equal(calls.render[0].videoId, 'video-2');
    assert.equal(calls.render[0].body.templateId, 'screen_demo');
    assert.equal(calls.render[0].body.confirmed, true);
    // Polled until the render stopped saying "rendering".
    assert.ok(calls.polls >= 2, `expected repeated polling, saw ${calls.polls}`);
    assert.match(result.stdout, /https:\/\/cdn\.test\/video-2\.mp4/);
  });
});

test('carries the screenshots it found on the page into the render', async () => {
  const { handler, calls } = anglesServer();
  await withServer(handler, async baseUrl => {
    await runCli(['https://myapp.com', '--concept', '1'], { baseUrl });
    assert.deepEqual(calls.render[0].body.productImages, ['https://cdn.test/shot-1.png']);
  });
});

test('leaves the screenshots out when asked to', async () => {
  const { handler, calls } = anglesServer();
  await withServer(handler, async baseUrl => {
    await runCli(['https://myapp.com', '--concept', '1', '--no-images'], { baseUrl });
    assert.equal('productImages' in calls.render[0].body, false);
  });
});

test('reuses one idempotency key for the same video and template', async () => {
  const first = anglesServer();
  const second = anglesServer();
  const keys = [];
  for (const server of [first, second]) {
    await withServer(server.handler, async baseUrl => {
      await runCli(['https://myapp.com', '--concept', '3'], { baseUrl });
      keys.push(server.calls.render[0].idempotencyKey);
    });
  }
  // A rerun after an interrupted render is a retry, not a second charge.
  assert.equal(keys[0], keys[1]);
  assert.match(keys[0], /^cli-video-3-dynamic$/);
});

test('renders every angle only when every angle was asked for', async () => {
  const { handler, calls } = anglesServer();
  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--all'], { baseUrl });

    assert.equal(result.code, 0);
    assert.deepEqual(
      calls.render.map(call => call.videoId),
      ['video-1', 'video-2', 'video-3']
    );
  });
});

test('says how to get a key instead of failing on the request', async () => {
  const result = await runCli(['https://myapp.com'], { env: { ANGLES_API_KEY: '' } });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /ANGLES_API_KEY is not set/);
  assert.match(result.stdout, /angles\.video/);
});

test('rejects an angle number that was never offered', async () => {
  const { handler, calls } = anglesServer();
  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--concept', '9'], { baseUrl });

    assert.equal(result.code, 1);
    assert.match(result.stdout, /--concept must be a number from 1 to 3/);
    assert.equal(calls.render.length, 0);
  });
});

test('reports a failed render against the page that explains it', async () => {
  const calls = { render: 0 };
  const handler = async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    response.setHeader('content-type', 'application/json');
    if (request.url === '/concepts/from-url') {
      response.end(JSON.stringify(FROM_URL_RESPONSE));
      return;
    }
    if (request.url.endsWith('/render')) {
      calls.render += 1;
      response.end(JSON.stringify({ status: 'rendering' }));
      return;
    }
    response.end(
      JSON.stringify({
        id: 'video-1',
        status: 'failed',
        videoUrl: null,
        editUrl: 'https://angles.video/projects/project-1/videos/video-1',
      })
    );
  };

  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--concept', '1'], { baseUrl });

    assert.equal(result.code, 1);
    assert.match(result.stdout, /The render failed/);
    assert.match(result.stdout, /projects\/project-1\/videos\/video-1/);
  });
});

test('never prints the API key', async () => {
  const { handler } = anglesServer();
  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--concept', '1'], { baseUrl });
    assert.equal(result.stdout.includes(testKey), false);
    assert.equal(result.stderr.includes(testKey), false);
  });
});
