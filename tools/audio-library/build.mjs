#!/usr/bin/env node
// Builds the Angles audio library from files a person has made and listened to.
//
//   node tools/audio-library/build.mjs <source-dir> [--out dist/audio-library]
//                                                   [--base-url https://cdn.angles.video/audio-library]
//                                                   [--manifest tools/audio-library/library.json]
//                                                   [--packs <dir of downloaded sound packs>]
//
// <source-dir>/music/<id>.<ext> and <source-dir>/sfx/<id>.<ext> hold the files
// for each entry of the manifest, named after its id. An entry may have several
// takes — <id>-a, <id>-b — and each becomes its own item. For each file found this:
//
//   music  brings it to one loudness, so every track sits under a voice at the
//          same level, and measures what a video is cut to: tempo, how clear
//          the beat is, where it lifts
//   sfx    trims the silence either side, brings the peak to one level, and
//          measures where its loudest moment — the hit — falls
//
// and writes <out>/music, <out>/sfx, <out>/catalog.json, and <out>/index.html —
// a page to listen through the whole library. Entries with no file yet are
// listed, not failed, so the library can be built up over time. An entry that
// names a file in a downloaded pack (`from`) is taken from --packs. Where an
// entry says where it came from and under what licence, the catalog says so too.
// Publishing is a copy: upload <out>/music and <out>/sfx, then catalog.json.
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

/** The files made for an entry: `<id>` itself, and any takes named `<id>-a`, `<id>-b`… */
function sourcesOf(directory, id) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter(name => SOUND_EXTENSIONS.includes(extname(name).toLowerCase()))
    .map(name => ({ id: basename(name, extname(name)), file: join(directory, name) }))
    .filter(found => found.id === id || (found.id.startsWith(`${id}-`) && /^[a-z]$/.test(found.id.slice(id.length + 1))))
    .sort((a, b) => a.id.localeCompare(b.id));
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

const escape = text => String(text ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);

/** The built library on one page: every track and sound with a player and what was measured. */
function listeningPage(catalog) {
  const bars = levels => (levels ?? []).map(level => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(level * 8))]).join('');
  const tracks = catalog.music
    .map(
      track => `
    <div class="row">
      <span class="name">${escape(track.id)}</span>
      <audio controls preload="none" src="music/${escape(track.id)}.mp3"></audio>
      <span class="about">${escape((track.mood ?? []).join(', '))} · ${Math.round(track.seconds)}s · ${track.bpm} BPM · beat ${track.pulse} · lifts at ${track.lifts.map(lift => `${lift.at}s`).join(', ') || '—'}<br>${escape(track.description)}<br><span class="energy">${bars(track.energy)}</span></span>
    </div>`
    )
    .join('');
  const families = [...new Set(catalog.sfx.map(sound => sound.family))];
  const sounds = families
    .map(
      family => `
    <h3>${escape(family)}</h3>${catalog.sfx
      .filter(sound => sound.family === family)
      .map(
        sound => `
    <div class="row">
      <span class="name">${escape(sound.id)}</span>
      <audio controls preload="none" src="sfx/${escape(sound.id)}.wav"></audio>
      <span class="about">${sound.seconds.toFixed(2)}s · hit at ${sound.hit.toFixed(2)}s · ${escape(sound.description)}${sound.source ? `<br><span class="from">${escape(sound.source)}${sound.license ? ` · ${escape(sound.license)}` : ''}</span>` : ''}</span>
    </div>`
      )
      .join('')}`
    )
    .join('');
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audio library</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 980px; margin: 32px auto; padding: 0 16px 64px; color: #1b1b18; background: #faf9f6; }
  h1 { font-size: 22px; } h2 { font-size: 18px; margin-top: 36px; border-top: 1px solid #dedbd2; padding-top: 20px; } h3 { font-size: 15px; margin: 24px 0 4px; text-transform: uppercase; letter-spacing: 1px; color: #77756c; }
  .row { display: grid; grid-template-columns: 190px 300px 1fr; gap: 4px 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid #eceae3; }
  .name { font-weight: 600; } .about { font-size: 13px; color: #55534c; } .energy { font-family: ui-monospace, monospace; letter-spacing: 1px; } .from { color: #99968c; }
  audio { width: 300px; height: 32px; }
  @media (max-width: 760px) { .row { grid-template-columns: 1fr; } audio { width: 100%; } }
</style>
<h1>Audio library</h1>
<p>${catalog.music.length} tracks and ${catalog.sfx.length} sounds, built ${escape(catalog.updatedAt)}. "energy" is one mark every four seconds; "hit" is how far into a sound its loudest moment is.</p>
<h2>Sound effects</h2>${sounds || '<p>None yet.</p>'}${catalog.sfxCredit ? `<p class="about">${escape(catalog.sfxCredit)}</p>` : ''}
<h2>Music</h2>${tracks || '<p>None yet.</p>'}
`;
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
const packs = option(args, '--packs');
/** Where an entry came from and under what licence, when the manifest says. */
const provenance = entry => ({
  ...(entry.source ? { source: entry.source } : {}),
  ...(entry.license ? { license: entry.license } : {}),
});

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'music'), { recursive: true });
mkdirSync(join(out, 'sfx'), { recursive: true });

const catalog = { version: 1, updatedAt: new Date().toISOString().slice(0, 10), music: [], sfx: [] };
const missing = [];
const warnings = [];

for (const entry of manifest.music) {
  const found = sourcesOf(join(source, 'music'), entry.id);
  if (!found.length) missing.push(`music/${entry.id}`);
  for (const { id, file } of found) {
    let measured;
    try {
      measured = buildTrack(file, join(out, 'music', `${id}.mp3`));
    } catch (error) {
      fail(`${file} could not be built: ${error.message}`);
    }
    if (measured.pulse < CLEAR_PULSE) warnings.push(`${id}: no clear beat (pulse ${measured.pulse}) — a video cannot be cut to it`);
    if (measured.seconds < 60) warnings.push(`${id}: only ${measured.seconds.toFixed(0)}s long — too short to place under most videos`);
    if (!measured.lifts.length) warnings.push(`${id}: never lifts — there is nothing to land a reveal on`);
    catalog.music.push({
      id,
      mood: entry.mood,
      description: entry.description,
      url: `${baseUrl}/music/${id}.mp3`,
      ...measured,
      ...provenance(entry),
    });
    process.stdout.write(
      `music ${id.padEnd(24)} ${measured.seconds.toFixed(0).padStart(4)}s  ${String(measured.bpm).padStart(5)} BPM  pulse ${measured.pulse}  lifts ${measured.lifts.map(lift => `${lift.at}s`).join(', ') || 'none'}\n`
    );
  }
}

const scratch = join(out, 'trim.wav');
for (const entry of manifest.sfx) {
  const found = sourcesOf(join(source, 'sfx'), entry.id);
  // A sound taken from a pack is read straight from it, unless a file was put in its place.
  if (!found.length && entry.from && packs) {
    if (!existsSync(join(packs, entry.from))) fail(`${entry.id} names ${entry.from}, which is not in ${packs}.`);
    found.push({ id: entry.id, file: join(packs, entry.from) });
  }
  if (!found.length) missing.push(`sfx/${entry.id}`);
  for (const { id, file } of found) {
    let measured;
    try {
      measured = buildSound(file, join(out, 'sfx', `${id}.wav`), scratch);
    } catch (error) {
      fail(`${file} could not be built: ${error.message}`);
    }
    // Sounds that build towards their peak, or run on, are meant to hit late.
    if (measured.hit > 0.15 && !/^(rise|riser|whoosh|processing)/.test(entry.kind)) {
      warnings.push(`${id}: its hit is ${measured.hit}s in — a scene has to start it that early to land on time`);
    }
    if (entry.seconds && measured.seconds > entry.seconds * 2.5) {
      warnings.push(`${id}: ${measured.seconds}s long, where about ${entry.seconds}s was wanted`);
    }
    catalog.sfx.push({
      id,
      family: entry.family,
      kind: entry.kind,
      description: entry.description,
      url: `${baseUrl}/sfx/${id}.wav`,
      ...measured,
      ...provenance(entry),
    });
    process.stdout.write(`sfx   ${id.padEnd(24)} ${measured.seconds.toFixed(2).padStart(5)}s  hit at ${measured.hit.toFixed(2)}s\n`);
  }
}
rmSync(scratch, { force: true });

if (manifest.sfxCredit && catalog.sfx.length) catalog.sfxCredit = manifest.sfxCredit;
writeFileSync(join(out, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
writeFileSync(join(out, 'index.html'), listeningPage(catalog));
process.stdout.write(`\n${catalog.music.length} tracks and ${catalog.sfx.length} sounds -> ${join(out, 'catalog.json')}\n`);
if (warnings.length) process.stdout.write(`\nWorth another listen:\n${warnings.map(line => `  ${line}`).join('\n')}\n`);
if (missing.length) process.stdout.write(`\nNot made yet (${missing.length}):\n  ${missing.join(', ')}\n`);
process.stdout.write(`\nListen through it: ${join(out, 'index.html')}\nTo publish: upload ${out}/music and ${out}/sfx so they are served under ${baseUrl}/, then catalog.json.\n`);
