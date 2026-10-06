import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The starter's frame script, exercised from `src/`, the copy the Skills are
// synced from.
const frames = fileURLToPath(new URL('../src/starter/scripts/frames.mjs', import.meta.url));

// Reading a video needs ffmpeg. A workspace gets one from Remotion; this
// repository installs nothing, so these tests need a system one.
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const decoding = { skip: hasFfmpeg ? false : 'needs a system ffmpeg' };

async function videoOf(directory, { size, seconds }) {
  const file = join(directory, 'clip.mp4');
  const made = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=10:duration=${seconds}`, '-pix_fmt', 'yuv420p', file],
    { encoding: 'utf8' }
  );
  assert.equal(made.status, 0, made.stderr);
  return file;
}

async function run(directory, args) {
  const child = spawn(process.execPath, [frames, ...args], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

const sizeOf = file =>
  spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
  })
    .stdout.trim()
    .split(',')
    .map(Number);

test('frames.mjs --sheet tiles the frames twelve to a page, in order', decoding, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'angles-frames-'));
  try {
    const video = await videoOf(directory, { size: '640x360', seconds: 15 });
    // One frame a second: fifteen frames, so one full page and one of three.
    const result = await run(directory, [video, '--every', '1', '--sheet', '--out', 'shots']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /15 frames:/);
    assert.match(result.stdout, /2 sheets:\nshots\/sheet-01\.jpg\nshots\/sheet-02\.jpg\n$/);

    const files = readdirSync(join(directory, 'shots'));
    assert.equal(files.filter(file => /^t\d/.test(file)).length, 15);
    // Four across and three down, 640 wide each, with a gap between.
    const [width, height] = sizeOf(join(directory, 'shots', 'sheet-01.jpg'));
    assert.equal(width, 4 * 640 + 3 * 6);
    assert.equal(height, 3 * 360 + 2 * 6);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('frames.mjs writes no sheet unless asked, and clears the ones from an earlier run', decoding, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'angles-frames-'));
  try {
    const video = await videoOf(directory, { size: '640x360', seconds: 3 });
    await run(directory, [video, '--every', '1', '--sheet', '--out', 'shots']);
    assert.equal(existsSync(join(directory, 'shots', 'sheet-01.jpg')), true);

    const again = await run(directory, [video, '--every', '1', '--out', 'shots']);
    assert.equal(again.code, 0, again.stderr);
    assert.doesNotMatch(again.stdout, /sheets:/);
    // A page left behind would be read as if it showed this render.
    assert.equal(existsSync(join(directory, 'shots', 'sheet-01.jpg')), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('frames.mjs --sheet gives a portrait video more, narrower columns', decoding, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'angles-frames-'));
  try {
    const video = await videoOf(directory, { size: '360x640', seconds: 12 });
    const result = await run(directory, [video, '--every', '1', '--sheet', '--out', 'shots']);
    assert.equal(result.code, 0, result.stderr);
    const [width, height] = sizeOf(join(directory, 'shots', 'sheet-01.jpg'));
    // Six across and two down, 420 wide each.
    assert.equal(width, 6 * 420 + 5 * 6);
    assert.ok(height > 2 * 740 && height < 2 * 760, `unexpected height ${height}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
