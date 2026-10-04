#!/usr/bin/env node
// Brings a rendered video to the loudness social platforms play at, and moves
// the index to the front of the file so it starts playing before it has
// finished downloading.
//
//   node scripts/finish.mjs out/ep01.mp4            -> out/ep01.final.mp4
//   node scripts/finish.mjs out/ep01.mp4 --lufs -16
//
// A render straight out of Remotion sits around -18 LUFS, which sounds quiet
// next to everything else in a feed. The picture is copied untouched.
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { run, streamsOf, videoInfo } from './media.mjs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const input = args.find((arg, index) => !arg.startsWith('--') && !(args[index - 1] || '').startsWith('--'));
if (!input) fail('usage: node scripts/finish.mjs <rendered.mp4> [--lufs <target, default -14>]');
if (!existsSync(input)) fail(`No video at ${input}.`);

const lufsFlag = args.indexOf('--lufs');
const target = lufsFlag >= 0 ? Number(args[lufsFlag + 1]) : -14;
if (!Number.isFinite(target) || target > -5 || target < -30) fail('--lufs takes a loudness target such as -14.');

const output = join(dirname(input), `${basename(input, extname(input))}.final${extname(input)}`);
const info = videoInfo(input);

let loudness = 'no sound track';
if (streamsOf(input).includes('audio')) {
  const goal = `loudnorm=I=${target}:TP=-1.5:LRA=11`;
  const { stderr } = run('ffmpeg', ['-hide_banner', '-i', input, '-vn', '-af', `${goal}:print_format=json`, '-f', 'null', '-']);
  const report = stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1);
  let measured;
  try {
    measured = JSON.parse(report);
  } catch {
    fail(`Could not read the loudness measurement from ffmpeg:\n${stderr.trim().split('\n').slice(-8).join('\n')}`);
  }
  // A silent track measures as -inf, which the second pass cannot correct.
  const usable = ['input_i', 'input_tp', 'input_lra', 'input_thresh'].every(field => Number.isFinite(Number(measured[field])));
  if (usable) {
    const correction = [
      goal,
      `measured_I=${measured.input_i}`,
      `measured_TP=${measured.input_tp}`,
      `measured_LRA=${measured.input_lra}`,
      `measured_thresh=${measured.input_thresh}`,
      `offset=${measured.target_offset}`,
      'linear=true',
    ].join(':');
    run('ffmpeg', [
      '-v', 'error', '-y', '-i', input,
      '-c:v', 'copy',
      '-af', correction,
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart',
      output,
    ]);
    loudness = `${measured.input_i} LUFS -> ${target} LUFS`;
  } else {
    run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-c', 'copy', '-movflags', '+faststart', output]);
    loudness = 'sound track is silent';
  }
} else {
  run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-c', 'copy', '-movflags', '+faststart', output]);
}

const megabytes = (statSync(output).size / (1024 * 1024)).toFixed(1);
process.stdout.write(
  `${output}\n${info.width}x${info.height}, ${info.seconds.toFixed(1)}s, ${megabytes} MB, ${loudness}\n`
);
