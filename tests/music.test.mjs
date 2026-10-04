import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The starter's music, sound-effect and voice scripts, exercised from `src/`,
// the copies the Skills are synced from.
const script = name => fileURLToPath(new URL(`../src/starter/scripts/${name}.mjs`, import.meta.url));
const testKey = 'music_key_that_must_not_leak';

// Decoding a track needs ffmpeg. A workspace gets one from Remotion; this
// repository installs nothing, so these tests need a system one.
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const decoding = { skip: hasFfmpeg ? false : 'needs a system ffmpeg' };

const RATE = 22050;

function wavOf(samples) {
  const bytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + bytes, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(bytes, 40);
  samples.forEach((sample, i) => buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + i * 2));
  return buffer;
}

/**
 * A drum loop with everything known: a bass drum on each beat, a quieter
 * hi-hat halfway between, and a pad that gets louder at `liftAt`. The hi-hat is
 * the brighter sound, so a tracker that ignores the low end settles on it.
 */
function drumLoop({ bpm, seconds, first = 0.3, liftAt = -1 }) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  const period = 60 / bpm;
  let seed = 1;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;
  for (let beat = first; beat < seconds; beat += period) {
    const drum = Math.round(beat * RATE);
    for (let i = 0; i < RATE * 0.12 && drum + i < samples.length; i++) {
      samples[drum + i] += 0.6 * Math.sin((2 * Math.PI * (120 - (60 * i) / (RATE * 0.12)) * i) / RATE) * Math.exp(-i / (RATE * 0.03));
    }
    const hat = Math.round((beat + period / 2) * RATE);
    for (let i = 0; i < RATE * 0.04 && hat + i < samples.length; i++) {
      samples[hat + i] += 0.12 * noise() * Math.exp(-i / (RATE * 0.008));
    }
  }
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    samples[i] += (liftAt >= 0 && t >= liftAt ? 0.25 : 0.04) * Math.sin(2 * Math.PI * 220 * t);
  }
  return wavOf(samples);
}

/** A held note that swells slowly: sound with no beat in it. */
function pad(seconds) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    samples[i] = 0.3 * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.3 * t));
  }
  return wavOf(samples);
}

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'angles-music-'));
  await mkdir(join(directory, 'src'));
  await mkdir(join(directory, 'public', 'music'), { recursive: true });
  return directory;
}

async function run(name, directory, args, env = {}) {
  const child = spawn(process.execPath, [script(name), ...args], {
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

async function withServer(handler, runWith) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const seen = { url: request.url, headers: request.headers, body: body ? JSON.parse(body) : null };
    requests.push(seen);
    handler(seen, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await runWith(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

const analyse = async (directory, file) => {
  const result = await run('music', directory, [file, '--json']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
};

const noVoice = (music, lines = 4) => ({
  voice: { provider: 'none' },
  tail: 2,
  music,
  lines: Array.from({ length: lines }, (_, i) => ({
    id: `l0${i + 1}`,
    text: 'Your product ships every week, and the video about it does not.',
  })),
});

async function timeline(directory, scriptJson) {
  await writeFile(join(directory, 'src', 'ep01.script.json'), JSON.stringify(scriptJson));
  const result = await run('voice', directory, ['src/ep01.script.json']);
  assert.equal(result.code, 0, result.stderr);
  return { track: JSON.parse(await readFile(join(directory, 'src', 'ep01.audio.json'), 'utf8')), stdout: result.stdout };
}

test('finds the tempo, puts the beats on the bass drum, and finds where the track lifts', decoding, async () => {
  const directory = await workspace();
  try {
    for (const { bpm, first, liftAt } of [
      { bpm: 100, first: 0.3, liftAt: -1 },
      { bpm: 128, first: 0.2, liftAt: 0.2 + 34 * (60 / 128) },
      { bpm: 87, first: 0.45, liftAt: -1 },
    ]) {
      await writeFile(join(directory, 'public', 'music', 'loop.wav'), drumLoop({ bpm, seconds: 40, first, liftAt }));
      const analysis = await analyse(directory, 'public/music/loop.wav');
      assert.ok(Math.abs(analysis.bpm - bpm) < 1, `${bpm} BPM was read as ${analysis.bpm}`);
      assert.ok(analysis.pulse > 0.5, `${bpm} BPM: pulse ${analysis.pulse}`);

      // Away from the ends, every beat is within a frame and a half of a real one.
      const period = 60 / bpm;
      const inner = analysis.beats.filter(beat => beat > 2 && beat < 38);
      const worst = Math.max(...inner.map(beat => Math.abs(beat - (first + Math.round((beat - first) / period) * period))));
      assert.ok(worst < 0.05, `${bpm} BPM: a beat is ${Math.round(worst * 1000)}ms from the drum`);

      if (liftAt >= 0) {
        assert.ok(Math.abs(analysis.lifts[0].at - liftAt) < 0.06, `lift at ${liftAt} was found at ${analysis.lifts[0]?.at}`);
      } else {
        assert.deepEqual(analysis.lifts, []);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('says so when a track has no beat to cut to', decoding, async () => {
  const directory = await workspace();
  try {
    await writeFile(join(directory, 'public', 'music', 'pad.wav'), pad(20));
    assert.ok((await analyse(directory, 'public/music/pad.wav')).pulse < 0.15);
    const described = await run('music', directory, ['public/music/pad.wav']);
    assert.match(described.stdout, /no clear beat/);

    const { stdout } = await timeline(directory, noVoice({ src: 'music/pad.wav' }));
    assert.match(stdout, /note: music\/pad\.wav has no clear beat/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('moves every cut after the first onto a beat, and ends the video on one', decoding, async () => {
  const directory = await workspace();
  try {
    await writeFile(join(directory, 'public', 'music', 'loop.wav'), drumLoop({ bpm: 120, seconds: 60, first: 0.25 }));
    const { track } = await timeline(directory, noVoice({ src: 'music/loop.wav' }));

    assert.equal(track.music.src, 'music/loop.wav');
    assert.equal(track.music.offset, 0);
    assert.ok(Math.abs(track.music.bpm - 120) < 1);
    const offBeat = moment => Math.min(...track.music.beats.map(beat => Math.abs(beat - moment)));
    track.clips.slice(1).forEach(clip => {
      assert.ok(offBeat(clip.at - track.cutLead) < 0.005, `${clip.id} cuts ${offBeat(clip.at - track.cutLead)}s off the beat`);
    });
    assert.ok(offBeat(track.totalSeconds) < 0.005);

    // A cut only ever waits for its beat: no pause is shorter than the script asked for.
    track.clips.slice(1).forEach((clip, i) => {
      const pause = clip.at - (track.clips[i].at + track.clips[i].seconds);
      assert.ok(pause >= 0.35 - 0.045 && pause < 0.35 + 0.5 + 0.01, `${clip.id} waits ${pause}s`);
    });

    const { track: loose } = await timeline(directory, noVoice({ src: 'music/loop.wav', snap: false }));
    assert.ok(Math.abs(loose.clips[1].at - (loose.clips[0].at + loose.clips[0].seconds + 0.35)) < 0.002);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('starts the track where its lift lands on the line that turns the video', decoding, async () => {
  const directory = await workspace();
  try {
    const liftAt = 0.25 + 60 * 0.5;
    await writeFile(join(directory, 'public', 'music', 'loop.wav'), drumLoop({ bpm: 120, seconds: 90, first: 0.25, liftAt }));
    const { track } = await timeline(directory, noVoice({ src: 'music/loop.wav', lift: 'l03' }));

    const cut = track.clips[2].at - track.cutLead;
    assert.ok(Math.abs(cut + track.music.offset - liftAt) < 0.06, `l03 cuts at ${cut + track.music.offset}s of the track; the lift is at ${liftAt}s`);
    assert.ok(track.music.offset > 10);
    // The video opens on a beat as well.
    assert.ok(Math.min(...track.music.beats.map(Math.abs)) < 0.03);

    // A lift the video cannot reach is reported, not silently missed.
    const early = await timeline(directory, noVoice({ src: 'music/loop.wav', lift: 'l04', liftAt: 4 }));
    assert.match(early.stdout, /comes before the video reaches l04/);
    assert.equal(early.track.music.offset, 0);

    const short = await timeline(directory, noVoice({ src: 'music/loop.wav', offset: 80 }));
    assert.match(short.stdout, /ends .*s before the video does/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('makes a track with the user\'s own ElevenLabs key, without vocals, and analyses it', decoding, async () => {
  const directory = await workspace();
  try {
    await withServer(
      (request, response) => response.end(drumLoop({ bpm: 110, seconds: 20 })),
      async (baseUrl, requests) => {
        const env = { ELEVENLABS_API_KEY: testKey, ELEVENLABS_BASE_URL: baseUrl };
        const make = (prompt) => ['make', 'ep01', prompt, '--seconds', '20', '--provider', 'elevenlabs'];
        const result = await run('music', directory, make('Warm piano, then drums'), env);
        assert.equal(result.code, 0, result.stderr);
        assert.equal(requests[0].url, '/v1/music');
        assert.equal(requests[0].headers['xi-api-key'], testKey);
        assert.deepEqual(requests[0].body, { prompt: 'Warm piano, then drums', music_length_ms: 20000, force_instrumental: true });
        // Named for what the provider actually sent, not for what was expected.
        assert.ok(existsSync(join(directory, 'public', 'music', 'ep01.wav')));
        assert.match(result.stdout, /public\/music\/ep01\.wav: 20\.0s, 110(\.\d)? BPM/);
        assert.ok(!result.stdout.includes(testKey));

        const again = await run('music', directory, make('Something else'), env);
        assert.equal(again.code, 1);
        assert.match(again.stderr, /already exists/);
        assert.equal(requests.length, 1);
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('makes a track with MiniMax from hex audio', decoding, async () => {
  const directory = await workspace();
  try {
    await withServer(
      (request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: drumLoop({ bpm: 100, seconds: 12 }).toString('hex') } }));
      },
      async (baseUrl, requests) => {
        const result = await run('music', directory, ['make', 'bed', 'Lo-fi drums', '--provider', 'minimax'], {
          MINIMAX_API_KEY: testKey,
          MINIMAX_BASE_URL: baseUrl,
        });
        assert.equal(result.code, 0, result.stderr);
        assert.equal(requests[0].url, '/v1/music_generation');
        assert.equal(requests[0].headers.authorization, `Bearer ${testKey}`);
        assert.equal(requests[0].body.prompt, 'Lo-fi drums');
        assert.equal(requests[0].body.is_instrumental, true);
        assert.equal(requests[0].body.output_format, 'hex');
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('makes a sound effect with the user\'s own key once, and records where its hit is', decoding, async () => {
  const directory = await workspace();
  try {
    // Silence, then a click 0.2s in.
    const samples = new Float32Array(Math.round(0.6 * RATE));
    for (let i = 0; i < 200; i++) samples[Math.round(0.2 * RATE) + i] = 0.8 * Math.exp(-i / 40);
    await withServer(
      (request, response) => response.end(wavOf(samples)),
      async (baseUrl, requests) => {
        const env = { ELEVENLABS_API_KEY: testKey, ELEVENLABS_BASE_URL: baseUrl };
        const args = ['stamp', 'A rubber stamp hitting paper', '--seconds', '0.6'];
        const result = await run('sfx', directory, args, env);
        assert.equal(result.code, 0, result.stderr);
        assert.equal(requests[0].url, '/v1/sound-generation');
        assert.equal(requests[0].headers['xi-api-key'], testKey);
        assert.deepEqual(requests[0].body, { text: 'A rubber stamp hitting paper', duration_seconds: 0.6 });

        const sounds = JSON.parse(await readFile(join(directory, 'src', 'sfx.json'), 'utf8'));
        assert.equal(sounds.stamp.src, 'sfx/stamp.wav');
        assert.ok(Math.abs(sounds.stamp.seconds - 0.6) < 0.01);
        assert.ok(Math.abs(sounds.stamp.hit - 0.2) < 0.01);

        // The same description is not paid for twice; a new one is.
        await run('sfx', directory, args, env);
        assert.equal(requests.length, 1);
        await run('sfx', directory, ['stamp', 'A heavier stamp', '--seconds', '0.6'], env);
        assert.equal(requests.length, 2);
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** A library served the way Angles serves it: a catalog, and files beside it. */
async function withLibrary(runWith) {
  const click = new Float32Array(Math.round(0.4 * RATE));
  for (let i = 0; i < 200; i++) click[Math.round(0.05 * RATE) + i] = 0.8 * Math.exp(-i / 40);
  const files = {
    '/files/steady.wav': drumLoop({ bpm: 120, seconds: 90, first: 0.25, liftAt: 0.25 + 40 * 0.5 }),
    '/files/short.wav': drumLoop({ bpm: 100, seconds: 12 }),
    '/files/soft-tick.wav': wavOf(click),
  };
  return withServer(
    (request, response) => {
      if (files[request.url]) return response.end(files[request.url]);
      const host = `http://${request.headers.host}`;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          version: 1,
          updatedAt: '2026-10-04',
          music: [
            { id: 'short', mood: ['calm'], description: 'A short loop.', url: `${host}/files/short.wav`, seconds: 12, bpm: 100, pulse: 0.9, lifts: [], energy: [0.8, 0.8, 0.8] },
            { id: 'steady', mood: ['driving'], description: 'Drums that open up.', url: `${host}/files/steady.wav`, seconds: 90, bpm: 120, pulse: 0.8, lifts: [{ at: 20.25, rise: 9 }], energy: [0.3, 0.3, 0.9] },
          ],
          sfx: [
            { id: 'soft-tick', family: 'soft', kind: 'tick', description: 'A single very short tick.', url: `${host}/files/soft-tick.wav`, seconds: 0.4, hit: 0.05 },
            { id: 'tech-pop', family: 'tech', kind: 'pop', description: 'A single soft pop.', url: `${host}/files/soft-tick.wav`, seconds: 0.4, hit: 0.05 },
          ],
        })
      );
    },
    (baseUrl, requests) => runWith({ ANGLES_API_KEY: testKey, ANGLES_API_BASE_URL: baseUrl }, requests)
  );
}

test('lists the library, and says which tracks can put a lift on the line that turns the video', decoding, async () => {
  const directory = await workspace();
  try {
    await timeline(directory, noVoice(undefined));
    await withLibrary(async (env, requests) => {
      const listed = await run('music', directory, ['library', '--for', 'src/ep01.audio.json', '--lift', 'l03'], env);
      assert.equal(listed.code, 0, listed.stderr);
      assert.equal(requests[0].url, '/audio/library');
      assert.equal(requests[0].headers.authorization, `Bearer ${testKey}`);

      // The track that fits is listed first, with where it would start.
      assert.ok(listed.stdout.indexOf('steady') < listed.stdout.indexOf('short'));
      assert.match(listed.stdout, /fits: its lift at 20\.25s lands on l03 with the track started \d+(\.\d)?s in/);
      assert.match(listed.stdout, /does not fit: never lifts/);
      assert.ok(!listed.stdout.includes(testKey));

      const calm = await run('music', directory, ['library', '--mood', 'calm'], env);
      assert.match(calm.stdout, /^short /m);
      assert.doesNotMatch(calm.stdout, /^steady /m);

      const plain = await run('music', directory, ['library', '--for', 'src/ep01.audio.json'], env);
      assert.match(plain.stdout, /does not fit: too short for this video/);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('takes a track from the library, and the video is cut to it', decoding, async () => {
  const directory = await workspace();
  try {
    await withLibrary(async (env, requests) => {
      const used = await run('music', directory, ['use', 'steady'], env);
      assert.equal(used.code, 0, used.stderr);
      assert.ok(existsSync(join(directory, 'public', 'music', 'steady.wav')));
      assert.match(used.stdout, /public\/music\/steady\.wav: 90\.0s, 120(\.\d)? BPM/);
      assert.match(used.stdout, /"music": \{ "src": "music\/steady\.wav" \}/);

      // A second call measures the copy it has; it does not download again.
      const downloads = () => requests.filter(request => request.url === '/files/steady.wav').length;
      await run('music', directory, ['use', 'steady'], env);
      assert.equal(downloads(), 1);

      const missing = await run('music', directory, ['use', 'nope'], env);
      assert.equal(missing.code, 1);
      assert.match(missing.stderr, /The library has no track "nope"/);
    });

    const { track } = await timeline(directory, noVoice({ src: 'music/steady.wav', lift: 'l03' }));
    assert.ok(Math.abs(track.clips[2].at - track.cutLead + track.music.offset - 20.25) < 0.06);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('takes sound effects from the library and records where each one hits', decoding, async () => {
  const directory = await workspace();
  try {
    await withLibrary(async env => {
      const listed = await run('sfx', directory, ['library', '--family', 'soft'], env);
      assert.match(listed.stdout, /soft\n {2}soft-tick/);
      assert.doesNotMatch(listed.stdout, /tech-pop/);

      const used = await run('sfx', directory, ['use', 'soft-tick', 'tech-pop'], env);
      assert.equal(used.code, 0, used.stderr);
      const renamed = await run('sfx', directory, ['use', 'soft-tick', '--as', 'row'], env);
      assert.equal(renamed.code, 0, renamed.stderr);

      const sounds = JSON.parse(await readFile(join(directory, 'src', 'sfx.json'), 'utf8'));
      assert.deepEqual(Object.keys(sounds).sort(), ['row', 'soft-tick', 'tech-pop']);
      assert.equal(sounds['soft-tick'].src, 'sfx/soft-tick.wav');
      assert.equal(sounds.row.src, 'sfx/row.wav');
      assert.equal(sounds.row.library, 'soft-tick');
      assert.ok(Math.abs(sounds['soft-tick'].hit - 0.05) < 0.01);
      assert.ok(existsSync(join(directory, 'public', 'sfx', 'row.wav')));
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('builds a library from files on disk, and that library can be used before it is published', decoding, async () => {
  const directory = await workspace();
  const source = join(directory, 'source');
  const out = join(directory, 'dist');
  try {
    await mkdir(join(source, 'music'), { recursive: true });
    await mkdir(join(source, 'sfx'), { recursive: true });
    const manifest = {
      music: [
        { id: 'steady', mood: ['driving'], description: 'Drums that open up.' },
        { id: 'not-made', mood: ['calm'], description: 'Still to come.' },
      ],
      sfx: [{ id: 'soft-tick', family: 'soft', kind: 'tick', seconds: 0.3, description: 'A single very short tick.' }],
    };
    await writeFile(join(source, 'library.json'), JSON.stringify(manifest));
    await writeFile(join(source, 'music', 'steady.wav'), drumLoop({ bpm: 120, seconds: 70, first: 0.25, liftAt: 0.25 + 40 * 0.5 }));
    // A tick with half a second of silence in front of it, and far too quiet.
    const tick = new Float32Array(Math.round(1.2 * RATE));
    for (let i = 0; i < 300; i++) tick[Math.round(0.5 * RATE) + i] = 0.1 * Math.exp(-i / 60);
    await writeFile(join(source, 'sfx', 'soft-tick.wav'), wavOf(tick));

    const build = fileURLToPath(new URL('../tools/audio-library/build.mjs', import.meta.url));
    const built = spawnSync(
      process.execPath,
      [build, source, '--out', out, '--manifest', join(source, 'library.json')],
      { encoding: 'utf8' }
    );
    assert.equal(built.status, 0, built.stderr);
    assert.match(built.stdout, /1 tracks and 1 sounds/);
    assert.match(built.stdout, /Not made yet \(1\):\s+music\/not-made/);

    const catalog = JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8'));
    const [track] = catalog.music;
    assert.equal(track.id, 'steady');
    assert.equal(track.url, 'https://cdn.angles.video/audio-library/music/steady.mp3');
    assert.ok(Math.abs(track.bpm - 120) < 1);
    assert.ok(track.pulse > 0.5);
    assert.ok(Math.abs(track.lifts[0].at - 20.25) < 0.15, `lift measured at ${track.lifts[0]?.at}`);
    assert.ok(track.energy.length >= 17);

    // Trimmed to the sound itself, so its hit is at the very start, and brought up to level.
    const [sound] = catalog.sfx;
    assert.ok(sound.seconds < 0.4, `still ${sound.seconds}s long`);
    assert.ok(sound.hit < 0.03, `hit at ${sound.hit}s`);
    const level = spawnSync('ffmpeg', ['-hide_banner', '-i', join(out, 'sfx', 'soft-tick.wav'), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    assert.match(level.stderr, /max_volume: -3\.\d dB/);

    // The built catalog works as a library straight from disk, before anything is
    // uploaded: its links say where the files will be, and the ones beside it are used.
    const env = { ANGLES_LIBRARY_URL: join(out, 'catalog.json') };
    const listed = await run('music', directory, ['library'], env);
    assert.match(listed.stdout, /^steady {2}70s {2}120(\.\d)? BPM/m);
    const used = await run('music', directory, ['use', 'steady'], env);
    assert.equal(used.code, 0, used.stderr);
    assert.ok(existsSync(join(directory, 'public', 'music', 'steady.mp3')));
    const taken = await run('sfx', directory, ['use', 'soft-tick'], env);
    assert.equal(taken.code, 0, taken.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
