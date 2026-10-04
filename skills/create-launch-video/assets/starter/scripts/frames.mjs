#!/usr/bin/env node
// Pulls still frames out of a video so they can be looked at: a rendered video
// before it is handed over, or a screen recording before it is used.
//
//   node scripts/frames.mjs out/ep01.mp4 --beats src/ep01.audio.json
//       the opening frame, the middle and the end of every spoken line, and
//       the closing frame — the moments where a picture has to be right
//   node scripts/frames.mjs out/ep01.mp4 --at 12.4,31
//       exact moments, in seconds
//   node scripts/frames.mjs ~/Desktop/demo.mov --every 3
//       one frame every 3 seconds
//
// Frames land in out/frames/<video>/, named by time so they sort in order.
// --size <px> sets the longest edge (default 1280); --out <dir> moves them.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { run, videoInfo } from './media.mjs';

const OWN_FRAME = /^t\d{3}\.\d-[a-z0-9_-]+\.jpg$/i;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const video = args.find((arg, index) => !arg.startsWith('--') && !(args[index - 1] || '').startsWith('--'));
if (!video) {
  fail('usage: node scripts/frames.mjs <video> (--beats <audio.json> | --at <s,s,…> | --every <seconds>) [--size <px>] [--out <dir>]');
}
if (!existsSync(video)) fail(`No video at ${video}.`);

const info = videoInfo(video);
const lastMoment = Math.max(0, info.seconds - 0.1);
const moments = [];

const beats = option(args, '--beats');
if (beats) {
  if (!existsSync(beats)) fail(`No timeline at ${beats}. Run scripts/voice.mjs first.`);
  const track = JSON.parse(readFileSync(beats, 'utf8'));
  moments.push({ at: 0, label: 'open' });
  for (const clip of track.clips) {
    moments.push({ at: clip.at + clip.seconds / 2, label: `${clip.id}-mid` });
    moments.push({ at: clip.at + clip.seconds, label: `${clip.id}-end` });
  }
  moments.push({ at: lastMoment, label: 'close' });
}

const at = option(args, '--at');
if (at) {
  for (const value of at.split(',')) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) fail(`--at takes seconds, such as 12.4,31 — got "${value}".`);
    moments.push({ at: seconds, label: 'at' });
  }
}

const every = option(args, '--every');
if (every) {
  const step = Number(every);
  if (!Number.isFinite(step) || step <= 0) fail(`--every takes a number of seconds — got "${every}".`);
  for (let seconds = 0; seconds < info.seconds; seconds += step) moments.push({ at: seconds, label: 'every' });
}

if (moments.length === 0) fail('Say which frames: --beats <audio.json>, --at <s,s,…> or --every <seconds>.');

const size = Number(option(args, '--size') || 1280);
const directory = option(args, '--out') || join('out', 'frames', basename(video, extname(video)));
mkdirSync(directory, { recursive: true });
// Frames from an earlier render would be read as if they showed this one.
for (const file of readdirSync(directory)) {
  if (OWN_FRAME.test(file)) rmSync(join(directory, file));
}

const written = [];
for (const moment of moments) {
  const seconds = Math.min(moment.at, lastMoment);
  const file = join(directory, `t${seconds.toFixed(1).padStart(5, '0')}-${moment.label}.jpg`);
  run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-ss',
    seconds.toFixed(3),
    '-i',
    video,
    '-frames:v',
    '1',
    '-vf',
    `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
    '-q:v',
    '3',
    file,
  ]);
  written.push(file);
}

process.stdout.write(
  `${info.width}x${info.height}, ${info.seconds.toFixed(1)}s — ${written.length} frames:\n${written.join('\n')}\n`
);
