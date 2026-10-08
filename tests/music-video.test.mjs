import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The music video Skill's own scripts. They live in its starter and nowhere
// else: a music video is cut to a song, so it shares little with the others.
const skill = fileURLToPath(new URL('../skills/create-music-video/', import.meta.url));
const scripts = join(skill, 'assets', 'starter', 'scripts');
const testKey = 'song_key_that_must_not_leak';
const python = spawnSync('python3', ['--version']).status === 0;
const needsPython = { skip: python ? false : 'python3 is not installed here' };

async function run(directory, command, args, env = {}) {
  const child = spawn(command, args, { cwd: directory, env: { ...process.env, ANGLES_API_KEY: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}
const node = (directory, script, args, env) => run(directory, process.execPath, [join(scripts, script), ...args], env);
const py = (directory, script, args) => run(directory, 'python3', [join(scripts, script), ...args]);

async function workspace(files = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'angles-mv-'));
  await mkdir(join(directory, 'src'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(directory, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return directory;
}

const LYRICS = '[Verse]\nSide project, three a.m.\nJust one more feature\n\n[Chorus]\nI will not promote\nI will not promote\n';
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 7)]);

/** Angles, as far as songs go: one song, finished the first time it is asked after. */
async function withSongs(runWith) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, body: body ? JSON.parse(body) : null, key: request.headers.authorization });
    const here = `http://127.0.0.1:${server.address().port}`;
    if (request.url.startsWith('/files/')) {
      response.setHeader('content-type', 'audio/mpeg');
      return response.end(MP3);
    }
    response.setHeader('content-type', 'application/json');
    if (request.method === 'POST') {
      response.statusCode = 201;
      return response.end(JSON.stringify({ id: 'song-1', status: 'processing', model: 'a-music-model' }));
    }
    response.end(JSON.stringify({ status: 'completed', model: 'a-music-model', versions: [{ url: `${here}/files/a.mp3`, seconds: 88.6 }, { url: `${here}/files/b.mp3`, seconds: 88.8 }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const directory = await workspace({ 'src/anthem.lyrics.txt': LYRICS });
  try {
    return await runWith({ directory, requests, env: { ANGLES_API_KEY: testKey, ANGLES_API_BASE_URL: `http://127.0.0.1:${server.address().port}` } });
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const asking = ['anthem', '--lyrics', 'src/anthem.lyrics.txt', '--title', 'Our Anthem', '--style', 'pop punk, 160bpm'];

test('a song is checked before anything is asked of the account', async () => {
  const directory = await workspace({ 'src/anthem.lyrics.txt': LYRICS });
  try {
    const noKey = await node(directory, 'song.mjs', asking);
    assert.equal(noKey.code, 1);
    assert.match(noKey.stderr, /ANGLES_API_KEY is not set/);
    // A key that would fail if it were ever sent: none of these get that far.
    const env = { ANGLES_API_KEY: testKey, ANGLES_API_BASE_URL: 'http://127.0.0.1:9' };
    assert.match((await node(directory, 'song.mjs', ['Bad_Name', ...asking.slice(1)], env)).stderr, /lowercase letters, digits and hyphens/);
    assert.match((await node(directory, 'song.mjs', ['anthem', '--lyrics', 'src/anthem.lyrics.txt', '--style', 'pop'], env)).stderr, /needs --title/);
    assert.match((await node(directory, 'song.mjs', ['anthem', '--lyrics', 'src/none.txt', '--title', 'T', '--style', 'pop'], env)).stderr, /There is no src\/none\.txt/);
    assert.match((await node(directory, 'song.mjs', [...asking, '--seconds', '5'], env)).stderr, /whole number from 10 to 360/);
    assert.match((await node(directory, 'song.mjs', [...asking, '--vocals', 'robot'], env)).stderr, /male or female/);
    assert.equal(existsSync(join(directory, 'src', 'songs.json')), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('starts a song, keeps both versions, and does not start it twice', async () => {
  await withSongs(async ({ directory, requests, env }) => {
    const first = await node(directory, 'song.mjs', [...asking, '--vocals', 'male', '--seconds', '90'], env);
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(requests[0].body, { lyrics: LYRICS.trim(), title: 'Our Anthem', style: 'pop punk, 160bpm', vocals: 'male', seconds: 90 });
    assert.equal(requests[0].key, `Bearer ${testKey}`);
    assert.match(first.stdout, /song\/anthem-1\.mp3\s+89s/);
    assert.match(first.stdout, /Listen to both/);
    assert.ok(!(first.stdout + first.stderr).includes(testKey));
    for (const version of ['anthem-1.mp3', 'anthem-2.mp3']) {
      assert.deepEqual(await readFile(join(directory, 'public', 'song', version)), MP3);
    }
    const songs = JSON.parse(await readFile(join(directory, 'src', 'songs.json'), 'utf8'));
    assert.equal(songs.anthem.id, 'song-1');
    assert.deepEqual(songs.anthem.versions.map(version => version.src), ['song/anthem-1.mp3', 'song/anthem-2.mp3']);

    const started = requests.filter(request => request.method === 'POST').length;
    const again = await node(directory, 'song.mjs', [...asking, '--vocals', 'male', '--seconds', '90'], env);
    assert.match(again.stdout, /already made/);
    // Other words under the same name are a new song, and that has to be said on purpose.
    await writeFile(join(directory, 'src', 'anthem.lyrics.txt'), `${LYRICS}\n[Outro]\nKeep going\n`);
    const changed = await node(directory, 'song.mjs', [...asking, '--vocals', 'male', '--seconds', '90'], env);
    assert.equal(changed.code, 1);
    assert.match(changed.stderr, /started from other words/);
    assert.equal(requests.filter(request => request.method === 'POST').length, started);
  });
});

test('comes back for a song that was started and never collected', async () => {
  await withSongs(async ({ directory, requests, env }) => {
    await writeFile(join(directory, 'src', 'songs.json'), JSON.stringify({ anthem: { id: 'song-1', title: 'Our Anthem', versions: [] } }));
    const result = await node(directory, 'song.mjs', ['anthem'], env);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(requests.some(request => request.method === 'POST'), false);
    assert.equal(requests[0].url, '/audio/songs/song-1');
    assert.ok(existsSync(join(directory, 'public', 'song', 'anthem-2.mp3')));
  });
});

const ART = {
  candidates: [
    { name: 'night', words: 'An ordinary developer of about twenty-eight, drawn as a character in a 3D animated film. A grey hoodie, pyjama trousers, slippers.' },
    { name: 'plaid', words: 'An ordinary developer of about thirty-five. Thick glasses, a checked shirt, a backpack.' },
  ],
  shots: [
    { name: 'refuse', words: 'Now a medium shot: both open palms held out toward the camera.' },
    { name: 'empty', words: 'Now seen from behind, facing an arena in which every seat is empty.', room: false },
  ],
};

test('a singer is chosen from candidates before any shot is drawn', async () => {
  const directory = await workspace({ 'src/dev.art.json': ART });
  try {
    const none = await node(directory, 'art.mjs', ['dev']);
    assert.equal(none.code, 1);
    assert.match(none.stderr, /Nobody has been chosen yet/);

    const sheets = await node(directory, 'art.mjs', ['dev', '--candidates', '--dry-run']);
    assert.equal(sheets.code, 0, sheets.stderr);
    assert.match(sheets.stdout, /— dev-night \(3:4, \d+ characters\)\nCharacter reference sheet\..* A grey hoodie/);
    assert.match(sheets.stdout, /— dev-plaid/);

    // Made through the account, which is not there: it stops at the first one and says where.
    const made = await node(directory, 'art.mjs', ['dev', '--candidates']);
    assert.equal(made.code, 1);
    assert.match(made.stderr, /ANGLES_API_KEY is not set[\s\S]*Stopped at night/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('every shot is drawn from the one who was chosen, in the same words', async () => {
  const chosen = { ...ART, chosen: 'night' };
  const directory = await workspace({ 'src/dev.art.json': chosen, 'src/images.json': { 'dev-night': { src: 'images/dev-night.jpg', width: 1728, height: 2304 } } });
  try {
    const shots = await node(directory, 'art.mjs', ['dev', '--dry-run']);
    assert.equal(shots.code, 0, shots.stderr);
    assert.match(shots.stdout, /— dev-refuse \(16:9, drawn from dev-night, \d+ characters\)\nThe same person as in the reference picture: An ordinary developer of about twenty-eight.*both open palms.* A dark concert stage/);
    // A shot that describes its own surroundings is not put on the stage as well.
    const empty = shots.stdout.slice(shots.stdout.indexOf('— dev-empty'));
    assert.match(empty, /every seat is empty\.\n/);
    assert.doesNotMatch(empty, /A dark concert stage/);

    assert.match((await node(directory, 'art.mjs', ['dev', 'refuse', '--dry-run'])).stdout, /^\n— dev-refuse[^—]*$/);
    assert.match((await node(directory, 'art.mjs', ['dev', 'nothing'])).stderr, /No shot called nothing\. The shots are: refuse, empty\./);

    await writeFile(join(directory, 'src', 'dev.art.json'), JSON.stringify({ ...chosen, who: 'a man '.repeat(300) }));
    const long = await node(directory, 'art.mjs', ['dev']);
    assert.equal(long.code, 1);
    assert.match(long.stderr, /Too many words: refuse is \d+ characters, empty is \d+ characters/);

    await writeFile(join(directory, 'src', 'dev.art.json'), JSON.stringify({ ...chosen, chosen: 'plaid' }));
    assert.match((await node(directory, 'art.mjs', ['dev'])).stderr, /dev-plaid has not been made/);
    await writeFile(join(directory, 'src', 'dev.art.json'), JSON.stringify({ ...chosen, chosen: 'nobody' }));
    assert.match((await node(directory, 'art.mjs', ['dev'])).stderr, /not one of the candidates: night, plaid/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** A song as scripts/beats.py measures it: 120 beats a minute, the first bar half a second in. */
function measured(bars) {
  const beats = Array.from({ length: bars * 4 + 1 }, (_, i) => i * 15);
  const frames = bars * 60;
  const level = on => Array.from({ length: frames }, (_, frame) => (on(Math.floor(frame / 60)) ? 0.75 : 0));
  return { song: 'anthem-2.mp3', fps: 30, start: 0.5, frames, bpm: 120, beats, kick: level(bar => bar !== 2), body: level(() => true), top: level(() => false), bands: [] };
}

test('the measured song is printed a bar at a time, and a bar with no kick shows as one', needsPython, async () => {
  const directory = await workspace({ 'src/anthem.song.json': measured(4) });
  try {
    const result = await py(directory, 'beats.py', ['--bars', 'src/anthem.song.json']);
    assert.equal(result.code, 0, result.stderr);
    const rows = result.stdout.trim().split('\n').slice(2);
    assert.equal(rows.length, 4);
    assert.match(rows[0], /^\s+1\s+0\.50s\s+###### /);
    // The third bar starts four seconds later, and nothing in it is a kick.
    assert.match(rows[2], /^\s+3\s+4\.50s\s{20,}######/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('lyrics are placed by section when nothing has listened to the song', needsPython, async () => {
  const directory = await workspace({ 'src/anthem.lyrics.txt': LYRICS, 'src/anthem.song.json': measured(8) });
  try {
    const args = ['--lyrics', 'src/anthem.lyrics.txt', '--song', 'src/anthem.song.json', '--out', 'src/anthem.lines.json'];
    const result = await py(directory, 'lines.py', [...args, '--sections', 'verse 1=0.5, chorus 1=0:08.5', '--end', '16.5']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /4 lines placed by their sections, not heard/);
    const { lines } = JSON.parse(await readFile(join(directory, 'src', 'anthem.lines.json'), 'utf8'));
    assert.deepEqual(lines.map(line => line.how), ['by section', 'by section', 'by section', 'by section']);
    // Two lines to a section of four bars: each starts a bar, and every word of a line has the line's time.
    assert.deepEqual(lines.map(line => line.at[0]), [0, 8, 16, 24]);
    assert.deepEqual(lines[1].seconds, [4.5, 4.5, 4.5, 4.5]);
    assert.equal(lines[3].until_second, 16.5);

    const missing = await py(directory, 'lines.py', [...args, '--sections', 'verse 1=0.5']);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /in order: verse 1, chorus 1\. No start was given for: chorus 1\./);
    assert.match((await py(directory, 'lines.py', args)).stderr, /Give --words <file>.*or --sections/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('lyrics are lined up with what was heard, past what the listener made up', needsPython, async () => {
  const word = (text, from, to, window = '0-24', sure = 0.95) => ({ word: text, from, to, sure, window });
  const heard = [
    word('Side', 0.6, 1.0), word('project,', 1.0, 1.5), word('three', 1.5, 1.9), word('a', 1.9, 2.1), word('.m.', 2.1, 2.5),
    word('Just', 4.5, 4.8), word('one', 4.8, 5.1), word('more', 5.1, 5.5), word('feature', 5.5, 6.1),
    word('I', 8.5, 8.8), word('will', 8.8, 9.2), word('not', 9.2, 9.6), word('promote', 9.6, 10.3),
    // The listener, left with a chant, goes on repeating it; and two stretches both hear the last line.
    ...Array.from({ length: 30 }, (_, i) => word('oh', 10.4 + i * 0.01, 10.41 + i * 0.01)),
    word('I', 12.5, 12.8), word('will', 12.8, 13.2), word('knot', 13.2, 13.6), word('promote', 13.6, 14.3),
    word('I', 12.52, 12.8, '10-24', 0.4), word('will', 12.82, 13.2, '10-24', 0.4),
  ];
  const directory = await workspace({ 'src/anthem.lyrics.txt': LYRICS, 'src/anthem.words.json': { windows: '0-24,10-24', words: heard } });
  try {
    const result = await py(directory, 'lines.py', ['--lyrics', 'src/anthem.lyrics.txt', '--words', 'src/anthem.words.json', '--out', 'src/anthem.lines.json']);
    assert.equal(result.code, 0, result.stderr);
    const { lines, extras } = JSON.parse(await readFile(join(directory, 'src', 'anthem.lines.json'), 'utf8'));
    assert.deepEqual(lines.map(line => line.how), ['heard', 'heard', 'heard', 'heard']);
    // "a.m." was heard as two words and is one; the word that was misheard sits between its neighbours.
    assert.deepEqual(lines[0].seconds, [0.6, 1.0, 1.5, 1.9]);
    assert.deepEqual(lines[2].seconds, [8.5, 8.8, 9.2, 9.6]);
    assert.deepEqual(lines[3].seconds, [12.5, 12.8, 13.2, 13.6]);
    assert.ok(extras.every(extra => extra.text.split(' ').length <= 4), 'a chant the listener kept repeating is cut short');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a moment that is not in the song is refused before anything is rendered', async () => {
  const directory = await workspace({ 'src/anthem.song.json': measured(4) });
  try {
    assert.match((await node(directory, 'look.mjs', ['other', '1'])).stderr, /No src\/other\.song\.json\. Measure the song first/);
    assert.match((await node(directory, 'look.mjs', ['anthem'])).stderr, /Say which moments/);
    const outside = await node(directory, 'look.mjs', ['anthem', '99', '--bars', '2']);
    assert.equal(outside.code, 1);
    assert.match(outside.stderr, /Not in the song: beat-99\. It has 17 beats, 4 bars/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the Skill names only scripts and files it ships', async () => {
  const text = (await Promise.all(['SKILL.md', 'references/the-stage.md', 'references/timing-the-words.md'].map(file => readFile(join(skill, file), 'utf8')))).join('\n');
  assert.match(text, /^---\nname: create-music-video\n/);
  const shipped = new Set(await readdir(scripts));
  for (const [, name] of text.matchAll(/scripts\/([a-z-]+\.(?:mjs|py))/g)) {
    assert.ok(shipped.has(name), `scripts/${name} is named in the Skill and is not in its starter`);
  }
  const sources = new Set(await readdir(join(skill, 'assets', 'starter', 'src')));
  for (const [, name] of text.matchAll(/`src\/((?:rig|shots|type|song|singer|readout|Root)\.tsx?)`/g)) {
    assert.ok(sources.has(name), `src/${name} is named in the Skill and is not in its starter`);
  }
});
