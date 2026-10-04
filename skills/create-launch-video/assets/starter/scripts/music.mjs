#!/usr/bin/env node
// Finds the pulse of a music track, so a video can be cut to it — and gets a
// track from the Angles library when the user has none of their own.
//
//   node scripts/music.mjs library [--for src/ep01.audio.json] [--lift l06] [--mood warm]
//       the tracks on offer (ANGLES_API_KEY): length, tempo, mood, where each
//       lifts. With --for, says which are long enough for that video, and with
//       --lift, which can put a lift on that line and where the track would start
//   node scripts/music.mjs use <id>
//       downloads that track into public/music/ and analyses it
//   node scripts/music.mjs public/music/track.mp3 [--json]
//       analyses any track: tempo, where every beat falls, how the energy
//       moves, and where it lifts
//   node scripts/music.mjs make <name> "<what it should sound like>" --seconds 45
//       makes a new track with a provider key of the user's own
//       (ELEVENLABS_API_KEY, or MINIMAX_API_KEY with --provider minimax).
//       This spends their credits: ask first.
//
// scripts/voice.mjs runs the same analysis when the script names a track, and
// moves each cut onto a beat.
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioLibrary, fetchSound, samplesOf, soundFormatOf } from './media.mjs';

const RATE = 22050;
const WINDOW = 1024;
const HOP = 256;
const FRAMES_PER_SECOND = RATE / HOP;
/** Below this, a track has no beat steady enough to cut a video to. */
export const CLEAR_PULSE = 0.15;

const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const r = re[i];
      re[i] = re[j];
      re[j] = r;
      const m = im[i];
      im[i] = im[j];
      im[j] = m;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const stepR = Math.cos((-2 * Math.PI) / size);
    const stepI = Math.sin((-2 * Math.PI) / size);
    for (let start = 0; start < n; start += size) {
      let curR = 1;
      let curI = 0;
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const tr = re[b] * curR - im[b] * curI;
        const ti = re[b] * curI + im[b] * curR;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = curR * stepR - curI * stepI;
        curI = curR * stepI + curI * stepR;
        curR = next;
      }
    }
  }
}

/** Keeps what stands out from its surroundings, scaled by its own spread. */
function standOut(values) {
  const frames = values.length;
  const reach = Math.round(0.4 * FRAMES_PER_SECOND);
  const prefix = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) prefix[i + 1] = prefix[i] + values[i];
  const peaks = new Float32Array(frames);
  let squares = 0;
  for (let i = 0; i < frames; i++) {
    const from = Math.max(0, i - reach);
    const to = Math.min(frames, i + reach + 1);
    peaks[i] = Math.max(0, values[i] - (prefix[to] - prefix[from]) / (to - from));
    squares += peaks[i] * peaks[i];
  }
  const deviation = Math.sqrt(squares / Math.max(1, frames)) || 1;
  for (let i = 0; i < frames; i++) peaks[i] /= deviation;
  return peaks;
}

/**
 * How much new sound arrives in each frame: the rise in spectral energy from
 * one frame to the next. Peaks where notes and drum hits start. `low` is the
 * same measure below 200 Hz — where the bass drum is.
 */
function onsetStrength(samples) {
  const frames = Math.max(0, Math.floor(samples.length / HOP));
  const hann = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1));
  const bins = Math.floor((8000 / RATE) * WINDOW);
  const lowBins = Math.ceil((200 / RATE) * WINDOW);
  const low = new Float32Array(frames);
  const re = new Float32Array(WINDOW);
  const im = new Float32Array(WINDOW);
  let previous = new Float32Array(bins);
  let current = new Float32Array(bins);
  const strength = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    // Centre each window on its frame, so a frame's time is frame * HOP / RATE.
    const offset = frame * HOP - WINDOW / 2;
    for (let i = 0; i < WINDOW; i++) {
      const sample = offset + i;
      re[i] = sample >= 0 && sample < samples.length ? samples[sample] * hann[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0;
    let lowFlux = 0;
    for (let bin = 1; bin < bins; bin++) {
      const magnitude = Math.log1p((100 * Math.hypot(re[bin], im[bin])) / (WINDOW / 4));
      current[bin] = magnitude;
      if (magnitude > previous[bin]) {
        flux += magnitude - previous[bin];
        if (bin < lowBins) lowFlux += magnitude - previous[bin];
      }
    }
    strength[frame] = frame === 0 ? 0 : flux;
    low[frame] = frame === 0 ? 0 : lowFlux;
    const swap = previous;
    previous = current;
    current = swap;
  }
  return { strength: standOut(strength), low: standOut(low) };
}

/**
 * A tracker can settle half a beat out, on the hi-hats between the beats
 * instead of on the bass drum. When the low end clearly hits between the
 * beats rather than on them, move every beat across by half.
 */
function onTheBassDrum(beats, low) {
  if (beats.length < 4) return beats;
  const around = frame => Math.max(low[frame - 2] ?? 0, low[frame - 1] ?? 0, low[frame] ?? 0, low[frame + 1] ?? 0, low[frame + 2] ?? 0);
  const between = beats.slice(1).map((beat, i) => Math.round((beats[i] + beat) / 2));
  const mean = frames => frames.reduce((sum, frame) => sum + around(frame), 0) / frames.length;
  const on = mean(beats);
  const off = mean(between);
  if (!(off > 1 && off > 2 * on)) return beats;
  const half = Math.round((beats[beats.length - 1] - beats[0]) / (beats.length - 1) / 2);
  const shifted = [...between];
  if (beats[0] - half >= 0) shifted.unshift(beats[0] - half);
  if (beats[beats.length - 1] + half < low.length) shifted.push(beats[beats.length - 1] + half);
  return shifted;
}

/** Frames between beats, from how strongly the onsets repeat at each spacing. */
function beatPeriod(strength) {
  const shortest = Math.floor((FRAMES_PER_SECOND * 60) / 200);
  const longest = Math.ceil((FRAMES_PER_SECOND * 60) / 60);
  const repeat = lag => {
    let sum = 0;
    for (let i = 0; i + lag < strength.length; i++) sum += strength[i] * strength[i + lag];
    return sum / Math.max(1, strength.length - lag);
  };
  let level = 0;
  for (const value of strength) level += value;
  level /= Math.max(1, strength.length);
  const score = new Float64Array(longest + 2);
  let best = shortest;
  for (let lag = shortest; lag <= longest; lag++) {
    const bpm = (FRAMES_PER_SECOND * 60) / lag;
    // Listeners hear the tempo nearest 120; without this a track is as likely
    // to be read at half or double speed.
    const preference = Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
    score[lag] = preference * (repeat(lag) + 0.5 * repeat(lag * 2));
    if (score[lag] > score[best]) best = lag;
  }
  const before = score[best - 1] ?? 0;
  const after = score[best + 1] ?? 0;
  const curve = before - 2 * score[best] + after;
  return {
    period: best + (curve < 0 ? (0.5 * (before - after)) / curve : 0),
    // How much of the track's onset pattern comes round again one beat later:
    // near 1 for a drum loop, near 0 for speech or a pad with no beat.
    pulse: Math.max(0, (Math.max(repeat(best - 1), repeat(best), repeat(best + 1)) - level * level) / (repeat(0) - level * level || 1)),
  };
}

/**
 * Places the beats: the sequence that lands on the strongest onsets while
 * keeping an even spacing near `period`. It follows the track through small
 * changes of tempo rather than laying a rigid grid over it.
 */
function trackBeats(strength, period) {
  const frames = strength.length;
  const spread = Math.max(1, period / 32);
  const reach = Math.ceil(spread * 3);
  const local = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let k = -reach; k <= reach; k++) {
      const j = i + k;
      if (j >= 0 && j < frames) sum += strength[j] * Math.exp(-0.5 * (k / spread) ** 2);
    }
    local[i] = sum;
  }

  const tightness = 100;
  const nearest = Math.round(period / 2);
  const farthest = Math.round(period * 2);
  const best = new Float64Array(frames);
  const link = new Int32Array(frames).fill(-1);
  for (let i = 0; i < frames; i++) {
    let top = -Infinity;
    let from = -1;
    for (let gap = nearest; gap <= farthest; gap++) {
      const j = i - gap;
      if (j < 0) break;
      const value = best[j] - tightness * Math.log(gap / period) ** 2;
      if (value > top) {
        top = value;
        from = j;
      }
    }
    best[i] = local[i] + (from >= 0 ? top : 0);
    link[i] = from;
  }

  let last = frames - 1;
  for (let i = Math.max(0, frames - Math.round(period)); i < frames; i++) {
    if (best[i] > best[last]) last = i;
  }
  const beats = [];
  for (let i = last; i >= 0; i = link[i]) beats.push(i);
  return beats.reverse();
}

/** Loudness in decibels over consecutive windows of `seconds`. */
function loudness(samples, seconds) {
  const size = Math.round(seconds * RATE);
  const levels = [];
  for (let start = 0; start + size <= samples.length; start += size) {
    let squares = 0;
    for (let i = start; i < start + size; i++) squares += samples[i] * samples[i];
    levels.push(10 * Math.log10(squares / size + 1e-10));
  }
  return levels;
}

/** Beats where the track becomes clearly louder and stays that way. */
function findLifts(samples, beats) {
  const step = 0.05;
  const levels = loudness(samples, step);
  const prefix = new Float64Array(levels.length + 1);
  for (let i = 0; i < levels.length; i++) prefix[i + 1] = prefix[i] + levels[i];
  // Rise in level across `at`: the `span` seconds after it against those before.
  const rise = (at, span) => {
    const index = Math.round(at / step);
    const width = Math.round(span / step);
    if (index - width < 0 || index + width > levels.length) return -Infinity;
    return (prefix[index + width] - 2 * prefix[index] + prefix[index - width]) / width;
  };

  const candidates = beats.map(at => ({ at, rise: rise(at, 3) })).filter(candidate => candidate.rise >= 3);
  candidates.sort((a, b) => b.rise - a.rise);
  const lifts = [];
  for (const candidate of candidates) {
    if (lifts.every(lift => Math.abs(lift.at - candidate.at) >= 4)) lifts.push(candidate);
    if (lifts.length === 3) break;
  }
  // The long window says a lift is here; a short one says which beat it starts on.
  return lifts.map(lift => {
    const nearby = beats.filter(at => Math.abs(at - lift.at) <= 1);
    const start = nearby.reduce((best, at) => (rise(at, 0.5) > rise(best, 0.5) ? at : best), lift.at);
    return { at: round(start), rise: round(lift.rise, 1) };
  });
}

/**
 * Analyses a music file.
 *
 * Returns `seconds`, `bpm`, `beats` (seconds from the start of the track),
 * `pulse` (0–1: how strongly the track repeats from one beat to the next —
 * below `CLEAR_PULSE` there is no beat a viewer would feel), `energy` (0–1,
 * one value a second) and `lifts` (the beats where it gets clearly louder,
 * strongest first).
 */
export function analyse(file) {
  const samples = samplesOf(file, RATE);
  const seconds = samples.length / RATE;
  if (seconds < 4) throw new Error(`${file} is ${seconds.toFixed(1)}s long — too short to find a beat in.`);

  const { strength, low } = onsetStrength(samples);
  const { period, pulse } = beatPeriod(strength);
  const frames = onTheBassDrum(trackBeats(strength, period), low);
  const beats = frames.map(frame => round(frame / FRAMES_PER_SECOND));
  const bpm = beats.length > 1 ? (60 * (beats.length - 1)) / (beats[beats.length - 1] - beats[0]) : 0;

  const levels = loudness(samples, 1);
  const loudest = Math.max(...levels);
  const energy = levels.map(level => round(Math.min(1, Math.max(0, (level - (loudest - 30)) / 30)), 2));

  return {
    seconds: round(seconds),
    bpm: round(bpm, 1),
    pulse: round(pulse, 2),
    beats,
    energy,
    lifts: findLifts(samples, beats),
  };
}

// ---------------------------------------------------------------------------
// Making a track

const MAKERS = {
  elevenlabs: {
    key: 'ELEVENLABS_API_KEY',
    async make({ prompt, seconds, model }, key) {
      const base = process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io';
      const response = await fetch(`${base}/v1/music`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          music_length_ms: Math.round(seconds * 1000),
          force_instrumental: true,
          ...(model ? { model_id: model } : {}),
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text().catch(() => '')).slice(0, 300)}`.trim());
      return Buffer.from(await response.arrayBuffer());
    },
  },
  minimax: {
    key: 'MINIMAX_API_KEY',
    // MiniMax decides the length itself; `seconds` is not sent.
    async make({ prompt, model }, key) {
      const base = process.env.MINIMAX_BASE_URL || 'https://api.minimax.io';
      const response = await fetch(`${base}/v1/music_generation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'music-3.0',
          prompt,
          is_instrumental: true,
          output_format: 'hex',
          audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' },
        }),
      });
      const body = await response.json().catch(() => null);
      if (body?.base_resp?.status_code !== 0 || !body?.data?.audio) {
        throw new Error(body?.base_resp?.status_msg || `HTTP ${response.status}`);
      }
      return Buffer.from(body.data.audio, 'hex');
    },
  },
};

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function describe(file, analysis) {
  const steady = analysis.pulse >= CLEAR_PULSE;
  const lines = [
    `${file}: ${analysis.seconds.toFixed(1)}s, ${analysis.bpm} BPM, ${analysis.beats.length} beats, first at ${analysis.beats[0] ?? 0}s`,
    steady
      ? `pulse ${analysis.pulse} — a clear beat; cuts placed on it will read as on the beat`
      : `pulse ${analysis.pulse} — no clear beat. Cuts snapped to this track will not feel timed to it; use it as a bed, or choose another.`,
    `energy, one mark every 4s: ${analysis.energy
      .filter((_, second) => second % 4 === 0)
      .map(level => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(level * 8))])
      .join('')}`,
    analysis.lifts.length
      ? `lifts: ${analysis.lifts.map(lift => `${lift.at}s (+${lift.rise} dB)`).join(', ')}`
      : 'lifts: none — the track stays at one level',
  ];
  return `${lines.join('\n')}\n`;
}

async function make(args) {
  const [name, prompt] = args.filter((arg, index) => !arg.startsWith('--') && !(args[index - 1] || '').startsWith('--'));
  const length = option(args, '--seconds');
  const seconds = length === undefined ? undefined : Number(length);
  const providerName = option(args, '--provider') || 'elevenlabs';
  const maker = MAKERS[providerName];
  if (!name || !prompt || !/^[A-Za-z0-9_-]+$/.test(name)) {
    fail('usage: node scripts/music.mjs make <name> "<what it should sound like>" --seconds <length> [--provider elevenlabs|minimax] [--model <id>] [--force]');
  }
  if (!maker) fail(`Unknown music provider "${providerName}". Use one of: ${Object.keys(MAKERS).join(', ')}.`);
  if (providerName === 'elevenlabs' && !(seconds >= 3 && seconds <= 600)) fail('--seconds takes the length to make, from 3 to 600.');
  const key = process.env[maker.key];
  if (!key) fail(`${maker.key} is not set.`);

  const directory = join('public', 'music');
  mkdirSync(directory, { recursive: true });
  const taken = ['', '-a', '-b']
    .flatMap(take => ['mp3', 'wav', 'ogg', 'm4a', 'flac'].map(ext => join(directory, `${name}${take}.${ext}`)))
    .find(existsSync);
  if (taken && !args.includes('--force')) {
    fail(`${taken} already exists. Choose another name to keep it, or pass --force to replace it.`);
  }

  let made;
  try {
    made = [].concat(await maker.make({ prompt, seconds, name, model: option(args, '--model') }, key));
  } catch (error) {
    fail(`${providerName} could not make the track: ${error.message}`);
  }
  if (!made.length || made.some(bytes => !bytes.length)) fail(`${providerName} returned an empty file.`);

  // One take keeps the name; several are told apart by a letter.
  made.forEach((bytes, index) => {
    const take = made.length > 1 ? `${name}-${'abcdefgh'[index]}` : name;
    const draft = join(directory, `${take}.download`);
    writeFileSync(draft, bytes);
    const file = join(directory, `${take}.${soundFormatOf(draft)}`);
    renameSync(draft, file);
    process.stdout.write(`${index ? '\n' : ''}${describe(file, analyse(file))}`);
  });
}

const bars = levels => levels.map(level => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(level * 8))]).join('');

/**
 * Whether a library track suits a voiced video: long enough to run under all
 * of it and, when a line is named, with a lift that can be put on the cut into
 * that line by starting the track part-way in.
 */
function fitOf(track, video, liftLine) {
  const length = video.totalSeconds + 1;
  if (!liftLine) return track.seconds >= length ? { ok: true, note: 'long enough for this video' } : { ok: false, note: 'too short for this video' };
  const index = video.clips.findIndex(clip => clip.id === liftLine);
  const cut = index <= 0 ? 0 : video.clips[index].at - (video.cutLead ?? 0.2);
  const reachable = (track.lifts ?? []).filter(lift => lift.at >= cut && lift.at - cut + length <= track.seconds);
  if (!reachable.length) {
    return { ok: false, note: track.lifts?.length ? `no lift can land on ${liftLine}` : 'never lifts' };
  }
  // The earliest one, as scripts/voice.mjs will choose: it keeps the track's build-up ahead of the turn.
  const lift = reachable.reduce((first, candidate) => (candidate.at < first.at ? candidate : first));
  return { ok: true, note: `its lift at ${lift.at}s lands on ${liftLine} with the track started ${round(lift.at - cut, 1)}s in` };
}

async function listLibrary(args) {
  const catalog = await audioLibrary();
  const mood = option(args, '--mood');
  const videoPath = option(args, '--for');
  const liftLine = option(args, '--lift');
  if (videoPath && !existsSync(videoPath)) fail(`No timeline at ${videoPath}. Run scripts/voice.mjs first.`);
  const video = videoPath ? JSON.parse(readFileSync(videoPath, 'utf8')) : null;
  if (liftLine && !video) fail('--lift needs --for <the video\'s audio.json>.');
  if (liftLine && !video.clips.some(clip => clip.id === liftLine)) fail(`"${liftLine}" is not a line of ${videoPath}.`);

  const tracks = catalog.music
    .filter(track => !mood || (track.mood ?? []).includes(mood))
    .map(track => ({ track, fit: video ? fitOf(track, video, liftLine) : null }))
    .sort((a, b) => Number(b.fit?.ok ?? 0) - Number(a.fit?.ok ?? 0) || (b.track.pulse ?? 0) - (a.track.pulse ?? 0));
  if (!tracks.length) fail(mood ? `No track in the library is tagged "${mood}".` : 'The library has no music yet.');

  for (const { track, fit } of tracks) {
    const lifts = (track.lifts ?? []).map(lift => `${lift.at}s (+${lift.rise} dB)`).join(', ') || 'none';
    process.stdout.write(
      [
        `${track.id}  ${Math.round(track.seconds)}s  ${track.bpm} BPM  pulse ${track.pulse}  [${(track.mood ?? []).join(', ')}]`,
        `    ${track.description}`,
        `    energy every 4s ${bars(track.energy ?? [])}   lifts: ${lifts}`,
        ...(fit ? [`    ${fit.ok ? 'fits' : 'does not fit'}: ${fit.note}`] : []),
        '',
      ].join('\n')
    );
  }
  process.stdout.write(`${tracks.length} tracks. Take one with: node scripts/music.mjs use <id>\n`);
}

async function useTrack(args) {
  const id = args.find(arg => !arg.startsWith('--'));
  if (!id) fail('usage: node scripts/music.mjs use <id>');
  const track = (await audioLibrary()).music.find(entry => entry.id === id);
  if (!track) fail(`The library has no track "${id}". List them with: node scripts/music.mjs library`);

  const directory = join('public', 'music');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${id}${extname(new URL(track.url, 'file:///').pathname) || '.mp3'}`);
  if (!existsSync(file)) writeFileSync(file, await fetchSound(track.url));
  process.stdout.write(describe(file, analyse(file)));
  process.stdout.write(`In the script: "music": { "src": "music/${basename(file)}" } — add "lift": "<line id>" to land its lift on that line.\n`);
}

async function main() {
  // A listing piped into `head` closes the pipe early; that is not an error.
  process.stdout.on('error', error => process.exit(error.code === 'EPIPE' ? 0 : 1));
  const args = process.argv.slice(2);
  if (args[0] === 'make') return make(args.slice(1));
  if (args[0] === 'library') return listLibrary(args.slice(1));
  if (args[0] === 'use') return useTrack(args.slice(1));
  const file = args.find(arg => !arg.startsWith('--'));
  if (!file) {
    fail('usage: node scripts/music.mjs library [--for <audio.json>] [--lift <line>] [--mood <word>]\n       node scripts/music.mjs use <id>\n       node scripts/music.mjs <track> [--json]\n       node scripts/music.mjs make <name> "<what it should sound like>" --seconds <length>');
  }
  if (!existsSync(file)) fail(`No track at ${file}.`);
  const analysis = analyse(file);
  process.stdout.write(args.includes('--json') ? `${JSON.stringify(analysis)}\n` : describe(file, analysis));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch(error => fail(error.message));
}
