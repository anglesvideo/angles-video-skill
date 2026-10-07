import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    recommendedTemplates: [{ id: 'bento_grid', name: 'Bento Grid', media: { acceptsImages: false } }],
  },
  {
    videoId: 'video-2',
    title: 'Send your first invoice',
    sellingAngle: 'From signup to paid in a minute',
    creativeLens: 'use_case',
    hook: 'Send your first invoice in 60 seconds',
    recommendedTemplates: [{ id: 'screen_demo', name: 'Screen Demo', media: { acceptsImages: true } }],
  },
  {
    videoId: 'video-3',
    title: 'Invoicing, minus the spreadsheet',
    sellingAngle: 'Clarity',
    creativeLens: 'clarity',
    hook: 'Invoicing, minus the spreadsheet',
    recommendedTemplates: [{ id: 'dynamic', name: 'Dynamic', media: { acceptsImages: false } }],
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

async function runCli(args, { baseUrl, env = {}, cwd } = {}) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    ...(cwd ? { cwd } : {}),
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
function anglesServer({ rendersBeforeDone = 1, renderGatewayError = false, finalStatus = 'rendered', sceneWarnings = null } = {}) {
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
      if (renderGatewayError) {
        // What a gateway actually returns mid-deploy: an HTML page, not JSON.
        response.statusCode = 502;
        response.setHeader('content-type', 'text/html');
        response.end('<html><head><title>502 Bad Gateway</title></head><body>502</body></html>');
        return;
      }
      response.end(JSON.stringify({ id: renderMatch[1], status: 'rendering' }));
      return;
    }
    const videoMatch = request.url.match(/^\/videos\/([^/]+)$/);
    if (videoMatch) {
      calls.polls += 1;
      const done = remaining <= 0;
      remaining -= 1;
      const status = done ? finalStatus : 'rendering';
      response.end(
        JSON.stringify({
          id: videoMatch[1],
          status,
          videoUrl: status === 'rendered' ? `https://cdn.test/${videoMatch[1]}.mp4` : null,
          editUrl: `https://angles.video/projects/project-1/videos/${videoMatch[1]}`,
          ...(done && sceneWarnings ? { sceneWarnings } : {}),
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
    // Angle 2 renders with Screen Demo, which routes uploads at render time.
    await runCli(['https://myapp.com', '--concept', '2'], { baseUrl });
    assert.deepEqual(calls.render[0].body.productImages, ['https://cdn.test/shot-1.png']);
  });
});

// Found in a real run: the page had 8 screenshots and the recommended template
// had no image slots, so the render was rejected outright with
// "Terminal Workflow does not have image slots." Sending images a template
// cannot route does not degrade — it fails the whole render.
test('never sends screenshots to a template that refuses them', async () => {
  const { handler, calls } = anglesServer();
  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--concept', '1'], { baseUrl });

    assert.equal(result.code, 0);
    assert.equal('productImages' in calls.render[0].body, false);
  });
});

test('says so when no offered template would use the screenshots', async () => {
  const { handler } = anglesServer();
  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--concept', '1'], { baseUrl });
    // Angle 2 does use them, so the caveat must not appear.
    assert.equal(result.stdout.includes('none of these templates use uploads'), false);
    assert.match(result.stdout, /Screen Demo · uses 1/);
    assert.match(result.stdout, /1 screenshot found on the page/);
  });
});

test('leaves the screenshots out when asked to', async () => {
  const { handler, calls } = anglesServer();
  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--concept', '2', '--no-images'], { baseUrl });
    assert.equal('productImages' in calls.render[0].body, false);
    assert.equal(result.stdout.includes('screenshot'), false);
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

// Found in a real run: a deploy restarted the server mid-render and the gateway
// returned 502. The answer was lost, not the render — and the video id is in
// hand, so the state is one poll away. Giving up would abandon a video the
// account may already be paying for.
test('polls instead of giving up when the gateway drops the render reply', async () => {
  const { handler, calls } = anglesServer({ renderGatewayError: true });
  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--concept', '2'], { baseUrl });

    assert.equal(result.code, 0);
    assert.equal(calls.render.length, 1);
    assert.match(result.stdout, /checking whether the render started/);
    assert.match(result.stdout, /https:\/\/cdn\.test\/video-2\.mp4/);
  });
});

test('says nothing was spent when the dropped render never started', async () => {
  const { handler } = anglesServer({ renderGatewayError: true, finalStatus: 'planned' });
  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--concept', '2'], { baseUrl });

    assert.equal(result.code, 1);
    assert.match(result.stdout, /never started/);
    assert.match(result.stdout, /Nothing was spent/);
    assert.match(result.stdout, /video-2/);
  });
});

// Found by watching a finished video: it contained "[DRAFT]" placeholder rows
// and a code window reading "Add your real example". The API had reported both
// as sceneWarnings and the CLI dropped them, so a render with visible defects
// was announced as a plain success.
test('reports scenes the renderer had to downgrade', async () => {
  const { handler } = anglesServer({
    sceneWarnings: [
      {
        code: 'scene-content-contract-fallback',
        message: 'Terminal steps was downgraded to text_statement: missing steps.',
        sceneIndex: 1,
      },
      {
        code: 'scene-content-contract-missing',
        message: 'Scene template "code_window" expects layoutPayload.codeLines.',
        sceneIndex: 3,
      },
    ],
  });
  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--concept', '2'], { baseUrl });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /2 scenes did not get what the template needed/);
    assert.match(result.stdout, /may show placeholder text/);
    // Reported as humans count scenes, not as the array is indexed.
    assert.match(result.stdout, /scene 2: Terminal steps was downgraded/);
    assert.match(result.stdout, /scene 4: Scene template "code_window"/);
  });
});

test('summarises the tail rather than printing every downgraded scene', async () => {
  const { handler } = anglesServer({
    sceneWarnings: Array.from({ length: 8 }, (_, index) => ({
      code: 'scene-content-contract-missing',
      message: `Scene ${index} is missing something.`,
      sceneIndex: index,
    })),
  });
  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--concept', '2'], { baseUrl });

    assert.match(result.stdout, /8 scenes did not get what the template needed/);
    assert.match(result.stdout, /…and 3 more/);
    assert.equal(result.stdout.includes('Scene 5 is missing'), false);
  });
});

test('stays quiet when the renderer changed nothing', async () => {
  const { handler } = anglesServer();
  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--concept', '2'], { baseUrl });

    assert.equal(result.stdout.includes('placeholder text'), false);
    assert.equal(result.stdout.includes('⚠'), false);
  });
});

// Developer templates draw a terminal and Angles will not invent what goes in
// it, so a real command is the difference between a finished scene and a
// visible "// Add your real example" placeholder in the delivered video.
test('sends the command given on the command line', async () => {
  const { handler, calls } = anglesServer();
  await withServer(handler, async baseUrl => {
    await runCli(['https://myapp.com', '--concept', '1', '--code', '  npx myapp init  '], {
      baseUrl,
    });
    assert.equal(calls.fromUrl[0].codeSample, 'npx myapp init');
    // Said to be a shell command, or the terminal it is drawn in is labelled JavaScript.
    assert.equal(calls.fromUrl[0].codeLanguage, 'bash');
  });
});

test('reads the command out of the README beside it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'angles-readme-'));
  await writeFile(
    join(dir, 'README.md'),
    [
      '# MyApp',
      '',
      'Some prose that mentions running myapp but is not a command.',
      '',
      '```json',
      '{ "not": "a command" }',
      '```',
      '',
      '```bash',
      '# install it first',
      '$ npx myapp start --port 3000',
      'npx myapp other',
      '```',
    ].join('\n')
  );

  const { handler, calls } = anglesServer();
  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--concept', '1'], { baseUrl, cwd: dir });

    // The json block is skipped, the comment line is skipped, and the shell
    // prompt "$ " is decoration rather than part of the command.
    assert.equal(calls.fromUrl[0].codeSample, 'npx myapp start --port 3000');
    assert.equal(calls.fromUrl[0].codeLanguage, 'bash');
    // It goes on screen in the video, so it is shown before anything is made.
    assert.match(result.stdout, /Using this command from README\.md/);
    assert.match(result.stdout, /npx myapp start/);
  });
});

test('prefers the typed command over the README', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'angles-readme-'));
  await writeFile(join(dir, 'README.md'), '```bash\nnpx from-readme\n```');

  const { handler, calls } = anglesServer();
  await withServer(handler, async baseUrl => {
    await runCli(['https://myapp.com', '--concept', '1', '--code', 'npx typed'], {
      baseUrl,
      cwd: dir,
    });
    assert.equal(calls.fromUrl[0].codeSample, 'npx typed');
  });
});

test('reads no README when told not to', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'angles-readme-'));
  await writeFile(join(dir, 'README.md'), '```bash\nnpx from-readme\n```');

  const { handler, calls } = anglesServer();
  await withServer(handler, async baseUrl => {
    const result = await runCli(['https://myapp.com', '--concept', '1', '--no-code'], {
      baseUrl,
      cwd: dir,
    });
    assert.equal('codeSample' in calls.fromUrl[0], false);
    assert.equal('codeLanguage' in calls.fromUrl[0], false);
    assert.equal(result.stdout.includes('Using this command'), false);
  });
});

test('sends nothing when there is no README to read', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'angles-empty-'));
  const { handler, calls } = anglesServer();
  await withServer(handler, async baseUrl => {
    await runCli(['https://myapp.com', '--concept', '1'], { baseUrl, cwd: dir });
    assert.equal('codeSample' in calls.fromUrl[0], false);
  });
});

test('passes the run steps in the order they were given', async () => {
  const { handler, calls } = anglesServer();
  await withServer(handler, async baseUrl => {
    await runCli(
      ['https://myapp.com', '--concept', '1', '--no-code', '--steps', 'Point it at a page, ,Pick an angle,Export'],
      { baseUrl }
    );
    assert.deepEqual(calls.fromUrl[0].runSteps, ['Point it at a page', 'Pick an angle', 'Export']);
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
