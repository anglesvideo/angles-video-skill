#!/usr/bin/env node
// Renders single frames of a video that has not been rendered yet — to show a
// few pictures before all of them are written, or to look at one scene after
// changing it without waiting for the whole video.
//
//   node scripts/stills.mjs ep01 --lines l01,l04:mid,l09 --close
//       the frame where each of those lines has finished being said (or
//       :start, :mid), and the closing frame
//   node scripts/stills.mjs ep01 --all --sheet
//       the end of every line, tiled twelve to a page
//   node scripts/stills.mjs ep01 --all --at mid --sheet
//       the middle of every line instead (or --at both): where a picture
//       that arrives late shows as an empty frame
//   node scripts/stills.mjs ep01 --frames 0,450
//       exact frames
//
// Stills land in out/stills/<video>/, named by frame so they sort in order.
// --open and --close add the first and last frame. --scale <n> sets the size
// (default 0.5: half the video's, which is enough to judge a layout by);
// --fps overrides the rate read from src/look.tsx; --dry-run only says which
// frames it would render.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { remotion, tile } from './media.mjs';

const OWN_STILL = /^(f\d{5}-[a-z0-9_-]+\.png|sheet-\d+\.jpg)$/i;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const id = args.find((arg, index) => !arg.startsWith('--') && !(args[index - 1] || '').startsWith('--'));
if (!id) {
  fail('usage: node scripts/stills.mjs <video> (--lines <id[:start|:mid],…> | --all [--at mid|end|both] | --frames <n,n,…>) [--open] [--close] [--sheet] [--scale <n>] [--dry-run]');
}
const timeline = join('src', `${id}.audio.json`);
if (!existsSync(timeline)) fail(`No timeline at ${timeline}. Run scripts/voice.mjs first: a still is taken at a moment of the voice.`);
const track = JSON.parse(readFileSync(timeline, 'utf8'));

const look = existsSync(join('src', 'look.tsx')) ? readFileSync(join('src', 'look.tsx'), 'utf8') : '';
const fps = Number(option(args, '--fps') || /export const FPS\s*=\s*(\d+)/.exec(look)?.[1] || 30);
const last = Math.max(0, Math.round(track.totalSeconds * fps) - 1);
const frameAt = seconds => Math.min(last, Math.max(0, Math.round(seconds * fps)));

const moments = [];
if (args.includes('--open')) moments.push({ frame: 0, label: 'open' });
const everyAt = option(args, '--at') || 'end';
if (!['mid', 'end', 'both'].includes(everyAt)) fail(`--at takes mid, end or both — got "${everyAt}".`);
const wanted = args.includes('--all')
  ? track.clips.flatMap(clip => (everyAt === 'both' ? [`${clip.id}:mid`, clip.id] : [everyAt === 'mid' ? `${clip.id}:mid` : clip.id]))
  : (option(args, '--lines') || '').split(',').filter(Boolean);
for (const entry of wanted) {
  const [lineId, where = 'end'] = entry.split(':');
  const clip = track.clips.find(candidate => candidate.id === lineId);
  if (!clip) fail(`"${lineId}" is not a line of ${timeline}.`);
  if (!['start', 'mid', 'end'].includes(where)) fail(`"${entry}": a line is looked at :start, :mid or at its end.`);
  const seconds = where === 'start' ? clip.at : where === 'mid' ? clip.at + clip.seconds / 2 : clip.at + clip.seconds;
  moments.push({ frame: frameAt(seconds), label: `${lineId}-${where}` });
}
for (const value of (option(args, '--frames') || '').split(',').filter(Boolean)) {
  const frame = Number(value);
  if (!Number.isInteger(frame) || frame < 0) fail(`--frames takes whole frame numbers, such as 0,450 — got "${value}".`);
  moments.push({ frame: Math.min(last, frame), label: 'frame' });
}
if (args.includes('--close')) moments.push({ frame: last, label: 'close' });
if (moments.length === 0) fail('Say which stills: --lines <id,…>, --all, --frames <n,…>, --open or --close.');

const scale = option(args, '--scale') || '0.5';
const directory = option(args, '--out') || join('out', 'stills', id);
const stills = moments.map(moment => ({ ...moment, file: join(directory, `f${String(moment.frame).padStart(5, '0')}-${moment.label}.png`) }));

if (args.includes('--dry-run')) {
  process.stdout.write(`${fps} fps, ${last + 1} frames — would render ${stills.length} stills:\n${stills.map(still => still.file).join('\n')}\n`);
  process.exit(0);
}

mkdirSync(directory, { recursive: true });
// Stills from an earlier version of the scenes would be read as if they showed this one.
for (const file of readdirSync(directory)) {
  if (OWN_STILL.test(file)) rmSync(join(directory, file));
}
for (const still of stills) {
  remotion(['still', join('src', 'index.ts'), id, still.file, `--frame=${still.frame}`, `--scale=${scale}`, '--log=error']);
}
const sizeOf = name => Number(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`).exec(look)?.[1] ?? 0);
const sheets = args.includes('--sheet') ? tile(stills.map(still => still.file), directory, { portrait: sizeOf('H') > sizeOf('W') }) : [];

process.stdout.write(`${stills.length} stills:\n${stills.map(still => still.file).join('\n')}\n`);
if (sheets.length) process.stdout.write(`${sheets.length} sheets:\n${sheets.join('\n')}\n`);
