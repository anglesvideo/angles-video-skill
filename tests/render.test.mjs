import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// What the starter's stills and render scripts decide to render. Rendering
// itself needs Remotion, which this repository does not install, so these run
// with --dry-run: the plan is the part that can be wrong without a crash.
const script = name => fileURLToPath(new URL(`../src/starter/scripts/${name}.mjs`, import.meta.url));

async function run(name, directory, args) {
  const child = spawn(process.execPath, [script(name), ...args], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

/** Ten lines of nine seconds each, a second apart: a hundred seconds of video. */
async function workspace({ fps = 30, seconds = 9 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'angles-render-'));
  await mkdir(join(directory, 'src'));
  const clips = Array.from({ length: 10 }, (_, i) => ({ id: `l${String(i + 1).padStart(2, '0')}`, text: 'A line.', seconds, at: 1 + i * 10, kind: 'silent', src: null }));
  await writeFile(join(directory, 'src', 'ep01.audio.json'), JSON.stringify({ totalSeconds: 102, cutLead: 0.2, clips }));
  await writeFile(join(directory, 'src', 'look.tsx'), `export const W = 1920;\nexport const H = 1080;\nexport const FPS = ${fps};\n`);
  return directory;
}

test('stills.mjs takes each still at a moment of the voice, in the frame rate of the look', async () => {
  const directory = await workspace({ fps: 25 });
  try {
    const result = await run('stills', directory, ['ep01', '--open', '--lines', 'l01,l02:start,l03:mid', '--frames', '40', '--close', '--dry-run']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^25 fps, 2550 frames — would render 6 stills:\n/);
    assert.deepEqual(result.stdout.trim().split('\n').slice(1), [
      'out/stills/ep01/f00000-open.png',
      // l01 is said from 1s to 10s; l02 starts at 11s; l03 runs from 21s to 30s.
      'out/stills/ep01/f00250-l01-end.png',
      'out/stills/ep01/f00275-l02-start.png',
      'out/stills/ep01/f00638-l03-mid.png',
      'out/stills/ep01/f00040-frame.png',
      'out/stills/ep01/f02549-close.png',
    ]);

    const all = await run('stills', directory, ['ep01', '--all', '--dry-run']);
    assert.match(all.stdout, /would render 10 stills/);
    // The middle of a line is where a picture that arrives late shows.
    const mids = await run('stills', directory, ['ep01', '--all', '--at', 'mid', '--dry-run']);
    assert.match(mids.stdout, /would render 10 stills:\nout\/stills\/ep01\/f00138-l01-mid\.png\n/);
    const both = await run('stills', directory, ['ep01', '--all', '--at', 'both', '--dry-run']);
    assert.match(both.stdout, /would render 20 stills/);

    const unknown = await run('stills', directory, ['ep01', '--lines', 'l44', '--dry-run']);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /"l44" is not a line of src\/ep01\.audio\.json/);

    const nothing = await run('stills', directory, ['ep01', '--dry-run']);
    assert.equal(nothing.code, 1);
    assert.match(nothing.stderr, /Say which stills/);

    const early = await run('stills', directory, ['ep02', '--all', '--dry-run']);
    assert.equal(early.code, 1);
    assert.match(early.stderr, /No timeline at src\/ep02\.audio\.json/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('render.mjs cuts the video into parts of about twenty seconds, where a line takes over', async () => {
  const directory = await workspace();
  try {
    const result = await run('render', directory, ['ep01', '--dry-run']);
    assert.equal(result.code, 0, result.stderr);
    // A line's picture takes over a fifth of a second before it is said: l03 at 21s is frame 624.
    assert.equal(
      result.stdout,
      [
        'ep01: 3060 frames at 30 fps in 5 parts — rendering 5 and the sound:',
        '  part-01.mp4  frames 0-623  l01–l02',
        '  part-02.mp4  frames 624-1223  l03–l04',
        '  part-03.mp4  frames 1224-1823  l05–l06',
        '  part-04.mp4  frames 1824-2423  l07–l08',
        '  part-05.mp4  frames 2424-3059  l09–l10',
        '',
      ].join('\n')
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** The parts of the ten-line workspace, as a finished run leaves them behind. */
async function rendered(directory) {
  const parts = join(directory, 'out', '.parts', 'ep01');
  await mkdir(parts, { recursive: true });
  const cuts = [[0, 623], [624, 1223], [1224, 1823], [1824, 2423], [2424, 3059]];
  // Two lines a part: each said from 1s into its ten seconds, for nine.
  const line = n => [`l${String(n).padStart(2, '0')}`, (1 + (n - 1) * 10) * 30, 270, 'A line.'];
  const manifest = { fps: 30, scale: '1', parts: cuts.map(([from, to], i) => ({ from, to, lines: [line(i * 2 + 1), line(i * 2 + 2)], pulses: [] })) };
  await writeFile(join(parts, 'parts.json'), JSON.stringify(manifest));
  for (let i = 1; i <= 5; i++) await writeFile(join(parts, `part-0${i}.mp4`), '');
  await writeFile(join(parts, 'audio.wav'), '');
  return parts;
}

test('render.mjs renders only the parts the named lines are in, and keeps the rest', async () => {
  const directory = await workspace();
  try {
    await rendered(directory);
    const one = await run('render', directory, ['ep01', '--lines', 'l06', '--dry-run']);
    assert.equal(one.stdout, 'ep01: 3060 frames at 30 fps in 5 parts — rendering 1:\n  part-03.mp4  frames 1224-1823  l05–l06\n');

    // A range that crosses a cut takes both sides of it; a list takes each.
    const range = await run('render', directory, ['ep01', '--lines', 'l04-l05,l10', '--dry-run']);
    assert.match(range.stdout, /rendering 3:\n  part-02\.mp4 .*\n  part-03\.mp4 .*\n  part-05\.mp4 /);

    const sound = await run('render', directory, ['ep01', '--audio', '--dry-run']);
    assert.equal(sound.stdout, 'ep01: 3060 frames at 30 fps in 5 parts — rendering 0 and the sound:\n');

    const backwards = await run('render', directory, ['ep01', '--lines', 'l05-l02', '--dry-run']);
    assert.equal(backwards.code, 1);
    assert.match(backwards.stderr, /l02 comes before l05/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('render.mjs renders again the parts the timeline changed, and the sound when the timeline is newer', async () => {
  const directory = await workspace();
  try {
    const parts = await rendered(directory);
    const clips = shift => Array.from({ length: 10 }, (_, i) => ({ id: `l${String(i + 1).padStart(2, '0')}`, text: 'A line.', seconds: 9, at: 1 + i * 10 + shift(i) }));
    const write = track => writeFile(join(directory, 'src', 'ep01.audio.json'), JSON.stringify({ cutLead: 0.2, ...track }));

    // The timeline was written again after the sound was rendered, with the same cuts.
    const old = new Date(Date.now() - 60000);
    await utimes(join(parts, 'audio.wav'), old, old);
    const stale = await run('render', directory, ['ep01', '--lines', 'l01', '--dry-run']);
    assert.match(stale.stdout, /^note: src\/ep01\.audio\.json is newer than the sound that was rendered: rendering the sound again\.\n/);
    assert.match(stale.stdout, /rendering 1 and the sound:/);

    // A longer hold on the closing scene changes only the last part: the others are kept.
    await write({ totalSeconds: 108, clips: clips(() => 0) });
    const held = await run('render', directory, ['ep01', '--audio', '--dry-run']);
    assert.match(held.stdout, /^note: The timeline has changed since the parts were rendered: part-05\.mp4 is rendered again, the rest kept\.\n/);
    assert.match(held.stdout, /in 5 parts — rendering 1 and the sound:\n  part-05\.mp4  frames 2424-3239  l09–l10\n$/);

    // A reworded line is a new caption: its part is rendered again along with the one asked for.
    const reworded = clips(() => 0);
    reworded[2].text = 'Another line.';
    await write({ totalSeconds: 102, clips: reworded });
    const caption = await run('render', directory, ['ep01', '--lines', 'l10', '--dry-run']);
    assert.match(caption.stdout, /part-02\.mp4 is rendered again, the rest kept/);
    assert.match(caption.stdout, /rendering 2 and the sound:\n  part-02\.mp4 .*\n  part-05\.mp4 /);

    // A first line voiced a second longer moves every cut after it.
    await write({ totalSeconds: 103, clips: clips(i => (i > 0 ? 1 : 0)) });
    const moved = await run('render', directory, ['ep01', '--lines', 'l06', '--dry-run']);
    assert.match(moved.stdout, /^note: The timeline has changed since the parts were rendered, and every cut has moved: rendering everything\.\n/);
    assert.match(moved.stdout, /rendering 5 and the sound:/);

    // A smaller draft is a different set of parts, and starts from nothing.
    const draft = await run('render', directory, ['ep01', '--lines', 'l06', '--scale', '0.5', '--dry-run']);
    assert.match(draft.stdout, /^note: Nothing has been rendered yet: rendering everything\.\n/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
