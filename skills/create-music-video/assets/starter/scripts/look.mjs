#!/usr/bin/env node
// Renders single frames of a song's video, named by where in the music they
// are — to look at a moment after writing it, without rendering the song.
//
//   node scripts/look.mjs anthem 2 17.2 53.8
//       the frame at each of those beats
//   node scripts/look.mjs anthem --bars 14 15 40 --sheet
//       the frame a beat into each of those bars, tiled twelve to a page
//   node scripts/look.mjs anthem --seconds 20.41 20.53
//       exact moments of the song: either side of a word, to see that it is
//       not there before it is sung and is there after
//   node scripts/look.mjs anthem --across 24 --sheet
//       that many frames spread evenly over the whole song
//
// Beats and bars are counted as the video counts them: beat 0 is the first
// beat of the first whole bar, as scripts/beats.py measured it, and bar 1
// starts there. The video itself starts at the start of the song, a little
// before that, which is allowed for here.
//
// Stills land in out/look/<song>/. --scale <n> sets their size (default 0.5:
// half the video's, enough to judge a layout by; 1 to read small type). Each
// still takes a few seconds to start, so ask for the ones you need.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { remotion, tile } from './media.mjs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const TAKES_NUMBERS = ['--bars', '--seconds'];
const TAKES_ONE = ['--across', '--scale'];
const song = args[0];
if (!song || song.startsWith('--')) {
  fail('usage: node scripts/look.mjs <song> [<beat> …] [--bars <bar> …] [--seconds <second> …] [--across <how many>] [--sheet] [--scale <n>]');
}
const measured = join('src', `${song}.song.json`);
if (!existsSync(measured)) fail(`No ${measured}. Measure the song first: python3 scripts/beats.py <song file> --out ${measured}`);
const { beats, fps, start, frames } = JSON.parse(readFileSync(measured, 'utf8'));

// Which list each number belongs to: the one named by the flag before it, or beats.
const asked = { beats: [], '--bars': [], '--seconds': [] };
const one = {};
let list = 'beats';
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (TAKES_NUMBERS.includes(arg)) list = arg;
  else if (TAKES_ONE.includes(arg)) one[arg] = Number(args[++i]);
  else if (arg === '--sheet') continue;
  else if (Number.isFinite(Number(arg))) asked[list].push(Number(arg));
  else fail(`"${arg}" is not a number or an option this takes.`);
}

/** The video starts at the song's first sample; the measured stretch starts `start` seconds in. */
const lead = Math.round(start * fps);
const last = frames + lead - 1;
const gap = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
const frameOfBeat = beat => {
  const i = Math.min(beats.length - 2, Math.max(0, Math.floor(beat)));
  const at = beat < 0 ? beats[0] + beat * gap : beats[i] + (beat - i) * (beats[i + 1] - beats[i]);
  return Math.round(at) + lead;
};

const moments = [
  ...asked.beats.map(beat => ({ frame: frameOfBeat(beat), label: `beat-${beat}` })),
  ...asked['--bars'].map(bar => ({ frame: frameOfBeat((bar - 1) * 4 + 1), label: `bar-${bar}` })),
  ...asked['--seconds'].map(seconds => ({ frame: Math.round(seconds * fps), label: `at-${seconds}s` })),
];
if (one['--across']) {
  const count = Math.max(2, Math.round(one['--across']));
  for (let k = 0; k < count; k++) {
    const frame = Math.round((last * (k + 0.5)) / count);
    moments.push({ frame, label: `at-${(frame / fps).toFixed(1)}s` });
  }
}
if (!moments.length) fail('Say which moments: beats, --bars, --seconds or --across.');
const outside = moments.filter(moment => moment.frame < 0 || moment.frame > last);
if (outside.length) fail(`Not in the song: ${outside.map(moment => moment.label).join(', ')}. It has ${beats.length} beats, ${Math.floor(beats.length / 4)} bars and ${(last / fps).toFixed(1)} seconds.`);

const scale = one['--scale'] ?? 0.5;
const directory = join('out', 'look', song);
mkdirSync(directory, { recursive: true });
moments.sort((a, b) => a.frame - b.frame);
const stills = moments.map(moment => ({ ...moment, file: join(directory, `f${String(moment.frame).padStart(5, '0')}-${moment.label}.png`) }));
for (const still of stills) {
  remotion(['still', join('src', 'index.ts'), song, still.file, `--frame=${still.frame}`, `--scale=${scale}`, '--log=error']);
}
const sheets = args.includes('--sheet') ? tile(stills.map(still => still.file), directory) : [];
process.stdout.write(`${stills.length} stills:\n${stills.map(still => still.file).join('\n')}\n`);
if (sheets.length) process.stdout.write(`Twelve to a page:\n${sheets.join('\n')}\n`);
