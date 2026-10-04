#!/usr/bin/env node
// Builds the Angles audio library from files a person has made and listened to.
//
//   node tools/audio-library/build.mjs <source-dir> [--out dist/audio-library]
//                                                   [--base-url https://cdn.angles.video/audio-library]
//                                                   [--manifest tools/audio-library/library.json]
//
// <source-dir>/music/<id>.<ext> and <source-dir>/sfx/<id>.<ext> hold one file
// per entry of the manifest, named after its id. For each one found this:
//
//   music  brings it to one loudness, so every track sits under a voice at the
//          same level, and measures what a video is cut to: tempo, how clear
//          the beat is, where it lifts
//   sfx    trims the silence either side, brings the peak to one level, and
//          measures where its loudest moment — the hit — falls
//
// and writes <out>/music, <out>/sfx and <out>/catalog.json. Entries with no
// file yet are listed, not failed, so the library can be built up over time.
// Publishing is a copy: upload <out> to the bucket, catalog.json last.
//
// Needs a system ffmpeg.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { durationOf, run, samplesOf } from '../../src/starter/scripts/media.mjs';
import { CLEAR_PULSE, analyse } from '../../src/starter/scripts/music.mjs';

const SOUND_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.aiff'];
/** Quieter than a finished video, so a track has headroom under a voice. */
const MUSIC_LUFS = -16;
const SFX_PEAK_DB = -3;

const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function sourceOf(directory, id) {
  if (!existsSync(directory)) return null;
  const file = readdirSync(directory).find(
    name => basename(name, extname(name)) === id && SOUND_EXTENSIONS.includes(extname(name).toLowerCase())
  );
  return file ? join(directory, file) : null;
}

function buildTrack(source, output) {
  const goal = `loudnorm=I=${MUSIC_LUFS}:TP=-1.5:LRA=11`;
  const { stderr } = run('ffmpeg', ['-hide_banner', '-i', source, '-vn', '-af', `${goal}:print_format=json`, '-f', 'null', '-']);
  const measured = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  const correction = [
    goal,
    `measured_I=${measured.input_i}`,
    `measured_TP=${measured.input_tp}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    'linear=true',
  ].join(':');
  run('ffmpeg', ['-v', 'error', '-y', '-i', source, '-vn', '-af', correction, '-c:a', 'libmp3lame', '-b:a', '160k', '-ar', '44100', '-ac', '2', output]);

  // Measure the file that ships, not the one that came in.
  const analysis = analyse(output);
  return {
    seconds: analysis.seconds,
    bpm: analysis.bpm,
    pulse: analysis.pulse,
    lifts: analysis.lifts,
    // One value every four seconds: enough to see a track's shape in a listing.
    energy: analysis.energy.filter((_, second) => second % 4 === 0),
  };
}

function buildSound(source, output, scratch) {
  // Cut the lead-in and the dead tail. The tail threshold is lower, so a decay is kept.
  const trim = [
    'silenceremove=start_periods=1:start_threshold=-45dB',
    'areverse',
    'silenceremove=start_periods=1:start_threshold=-60dB',
    'areverse',
  ].join(',');
  run('ffmpeg', ['-v', 'error', '-y', '-i', source, '-vn', '-af', trim, '-ac', '1', '-ar', '44100', scratch]);
  const { stderr } = run('ffmpeg', ['-hide_banner', '-i', scratch, '-af', 'volumedetect', '-f', 'null', '-']);
  const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(stderr)?.[1]);
  if (!Number.isFinite(peak)) throw new Error('is silent');
  run('ffmpeg', ['-v', 'error', '-y', '-i', scratch, '-af', `volume=${round(SFX_PEAK_DB - peak, 2)}dB`, '-c:a', 'pcm_s16le', output]);

  const samples = samplesOf(output);
  let loudest = 0;
  for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i]) > Math.abs(samples[loudest])) loudest = i;
  return { seconds: round(durationOf(output)), hit: round(loudest / 22050) };
}

const args = process.argv.slice(2);
const source = args.find((arg, index) => !arg.startsWith('--') && !(args[index - 1] || '').startsWith('--'));
if (!source) {
  fail('usage: node tools/audio-library/build.mjs <source-dir> [--out dist/audio-library] [--base-url <where it will be served>] [--manifest <library.json>]');
}
if (!existsSync(source)) fail(`No source directory at ${source}.`);
try {
  run('ffmpeg', ['-version']);
} catch {
  fail('This needs ffmpeg installed.');
}

const out = option(args, '--out', join('dist', 'audio-library'));
const baseUrl = option(args, '--base-url', 'https://cdn.angles.video/audio-library').replace(/\/+$/, '');
const manifestPath = option(args, '--manifest', fileURLToPath(new URL('./library.json', import.meta.url)));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'music'), { recursive: true });
mkdirSync(join(out, 'sfx'), { recursive: true });

const catalog = { version: 1, updatedAt: new Date().toISOString().slice(0, 10), music: [], sfx: [] };
const missing = [];
const warnings = [];

for (const entry of manifest.music) {
  const file = sourceOf(join(source, 'music'), entry.id);
  if (!file) {
    missing.push(`music/${entry.id}`);
    continue;
  }
  let measured;
  try {
    measured = buildTrack(file, join(out, 'music', `${entry.id}.mp3`));
  } catch (error) {
    fail(`${file} could not be built: ${error.message}`);
  }
  if (measured.pulse < CLEAR_PULSE) warnings.push(`${entry.id}: no clear beat (pulse ${measured.pulse}) — a video cannot be cut to it`);
  if (measured.seconds < 60) warnings.push(`${entry.id}: only ${measured.seconds.toFixed(0)}s long — too short to place under most videos`);
  if (!measured.lifts.length) warnings.push(`${entry.id}: never lifts — there is nothing to land a reveal on`);
  catalog.music.push({
    id: entry.id,
    mood: entry.mood,
    description: entry.description,
    url: `${baseUrl}/music/${entry.id}.mp3`,
    ...measured,
  });
  process.stdout.write(
    `music ${entry.id.padEnd(22)} ${measured.seconds.toFixed(0).padStart(4)}s  ${String(measured.bpm).padStart(5)} BPM  pulse ${measured.pulse}  lifts ${measured.lifts.map(lift => `${lift.at}s`).join(', ') || 'none'}\n`
  );
}

const scratch = join(out, 'trim.wav');
for (const entry of manifest.sfx) {
  const file = sourceOf(join(source, 'sfx'), entry.id);
  if (!file) {
    missing.push(`sfx/${entry.id}`);
    continue;
  }
  let measured;
  try {
    measured = buildSound(file, join(out, 'sfx', `${entry.id}.wav`), scratch);
  } catch (error) {
    fail(`${file} could not be built: ${error.message}`);
  }
  if (measured.hit > 0.15 && entry.kind !== 'riser' && !entry.kind.startsWith('whoosh')) {
    warnings.push(`${entry.id}: its hit is ${measured.hit}s in — a scene has to start it that early to land on time`);
  }
  if (entry.seconds && measured.seconds > entry.seconds * 2.5) {
    warnings.push(`${entry.id}: ${measured.seconds}s long, where about ${entry.seconds}s was wanted`);
  }
  catalog.sfx.push({
    id: entry.id,
    family: entry.family,
    kind: entry.kind,
    description: entry.description,
    url: `${baseUrl}/sfx/${entry.id}.wav`,
    ...measured,
  });
  process.stdout.write(`sfx   ${entry.id.padEnd(22)} ${measured.seconds.toFixed(2).padStart(5)}s  hit at ${measured.hit.toFixed(2)}s\n`);
}
rmSync(scratch, { force: true });

writeFileSync(join(out, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
process.stdout.write(`\n${catalog.music.length} tracks and ${catalog.sfx.length} sounds -> ${join(out, 'catalog.json')}\n`);
if (warnings.length) process.stdout.write(`\nWorth another listen:\n${warnings.map(line => `  ${line}`).join('\n')}\n`);
if (missing.length) process.stdout.write(`\nNot made yet (${missing.length}):\n  ${missing.join(', ')}\n`);
process.stdout.write(`\nTo publish: upload ${out}/music and ${out}/sfx so they are served under ${baseUrl}/, then catalog.json.\n`);
