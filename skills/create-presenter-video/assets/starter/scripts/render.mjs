#!/usr/bin/env node
// Renders a video in parts and joins them, so that changing one scene costs
// one part and not the whole video.
//
//   node scripts/render.mjs ep01
//       every part, the sound, and out/ep01.mp4
//   node scripts/render.mjs ep01 --lines l04-l06
//       only the parts those lines are in (a range, or l04,l09); the other
//       parts and the sound are kept from the last run
//   node scripts/render.mjs ep01 --audio
//       the sound again — after a line was voiced again at the same length, or
//       a level was changed — with every picture kept
//
// A part is about twenty seconds, cut where a line's picture takes over. The
// pictures are rendered without sound and the sound once for the whole video,
// so a join can never click. Parts live in out/.parts/<video>/.
//
// --scale <n> renders a smaller draft (its parts are kept apart from the full
// size ones); --dry-run only says what it would render. When the timeline has
// changed since the parts were made — a line re-voiced longer, a pause moved,
// a longer hold on the closing scene — the parts it changed are rendered again
// with whatever was asked for, and the ones it left alone are kept.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { remotion, run } from './media.mjs';

const PART_SECONDS = 20;

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
if (!id) fail('usage: node scripts/render.mjs <video> [--lines <id-id | id,id>] [--audio] [--scale <n>] [--dry-run]');
const timeline = join('src', `${id}.audio.json`);
if (!existsSync(timeline)) fail(`No timeline at ${timeline}. Run scripts/voice.mjs first.`);
const track = JSON.parse(readFileSync(timeline, 'utf8'));

const look = existsSync(join('src', 'look.tsx')) ? readFileSync(join('src', 'look.tsx'), 'utf8') : '';
const fps = Number(option(args, '--fps') || /export const FPS\s*=\s*(\d+)/.exec(look)?.[1] || 30);
const scale = option(args, '--scale') || '1';
const total = Math.round(track.totalSeconds * fps);
const lead = Math.round((track.cutLead ?? 0.2) * fps);
// The frame each line's picture takes over, as src/timeline.ts works it out.
const cuts = track.clips.map((clip, index) => (index === 0 ? 0 : Math.round(clip.at * fps) - lead));

const parts = [];
track.clips.forEach((clip, index) => {
  const open = parts[parts.length - 1];
  if (open && cuts[index] - open.from < PART_SECONDS * fps) open.lines.push(clip.id);
  else parts.push({ from: cuts[index], lines: [clip.id] });
});
// The beats of the music, which scenes may move to as well as the voice.
const pulses = (track.music?.beats ?? (track.beds ?? []).flatMap(bed => bed.beats)).map(seconds => Math.round(seconds * fps));
parts.forEach((part, index) => {
  part.to = (parts[index + 1]?.from ?? total) - 1;
  part.file = `part-${String(index + 1).padStart(2, '0')}.mp4`;
  // Everything the timeline gives the scenes of this part. While it is the same, so are the frames.
  part.timing = {
    from: part.from,
    to: part.to,
    lines: part.lines.map(id => {
      const clip = track.clips.find(candidate => candidate.id === id);
      return [id, Math.round(clip.at * fps), Math.ceil(clip.seconds * fps), clip.text];
    }),
    pulses: pulses.filter(pulse => pulse >= part.from && pulse <= part.to),
  };
});

const directory = join('out', '.parts', scale === '1' ? id : `${id}@${scale}`);
const manifestPath = join(directory, 'parts.json');
const audioFile = join(directory, 'audio.wav');
const before = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
/** A part is kept when the timeline gives it what it gave the part that is on disk. */
const kept = (part, index) =>
  before?.fps === fps && existsSync(join(directory, part.file)) && JSON.stringify(before.parts?.[index]) === JSON.stringify(part.timing);

const ids = track.clips.map(clip => clip.id);
const asked = new Set();
for (const entry of (option(args, '--lines') || '').split(',').filter(Boolean)) {
  const [first, lastOf = first] = entry.split('-');
  const from = ids.indexOf(first);
  const to = ids.indexOf(lastOf);
  if (from < 0 || to < 0) fail(`"${entry}": ${from < 0 ? first : lastOf} is not a line of ${timeline}.`);
  if (to < from) fail(`"${entry}": ${lastOf} comes before ${first}.`);
  ids.slice(from, to + 1).forEach(line => asked.add(line));
}

const partial = asked.size > 0 || args.includes('--audio');
const notes = [];
if (partial && !before) notes.push('Nothing has been rendered yet: rendering everything.');
const everything = !partial || !before;
const moved = parts.filter((part, index) => !kept(part, index));
const pictures = everything ? parts : parts.filter((part, index) => !kept(part, index) || part.lines.some(line => asked.has(line)));
if (!everything && moved.length) {
  notes.push(
    moved.length === parts.length
      ? 'The timeline has changed since the parts were rendered, and every cut has moved: rendering everything.'
      : `The timeline has changed since the parts were rendered: ${moved.map(part => part.file).join(', ')} ${moved.length === 1 ? 'is' : 'are'} rendered again, the rest kept.`
  );
}
const soundIsOld = existsSync(audioFile) && statSync(audioFile).mtimeMs < statSync(timeline).mtimeMs;
const sound = everything || args.includes('--audio') || !existsSync(audioFile) || soundIsOld;
if (!everything && soundIsOld && !args.includes('--audio')) notes.push(`${timeline} is newer than the sound that was rendered: rendering the sound again.`);

const describe = part => `${part.file}  frames ${part.from}-${part.to}  ${part.lines[0]}${part.lines.length > 1 ? `–${part.lines[part.lines.length - 1]}` : ''}`;
for (const note of notes) process.stdout.write(`note: ${note}\n`);
process.stdout.write(
  `${id}: ${total} frames at ${fps} fps in ${parts.length} parts — rendering ${pictures.length}${sound ? ' and the sound' : ''}:\n${pictures.map(part => `  ${describe(part)}`).join('\n')}${pictures.length ? '\n' : ''}`
);
if (args.includes('--dry-run')) process.exit(0);

mkdirSync(directory, { recursive: true });
const entry = join('src', 'index.ts');
for (const part of pictures) {
  remotion(['render', entry, id, join(directory, part.file), `--frames=${part.from}-${part.to}`, '--muted', `--scale=${scale}`, '--log=error']);
}
let hasSound = existsSync(audioFile);
if (sound) {
  try {
    remotion(['render', entry, id, audioFile, '--log=error']);
    hasSound = true;
  } catch (error) {
    // A video with no voice and no music has no sound to render.
    hasSound = false;
    process.stdout.write(`note: no sound was rendered (${error.message}); joining the pictures alone.\n`);
  }
}
writeFileSync(manifestPath, JSON.stringify({ fps, scale, parts: parts.map(part => part.timing) }));

const list = join(directory, 'parts.txt');
writeFileSync(list, `${parts.map(part => `file '${part.file}'`).join('\n')}\n`);
const output = join('out', scale === '1' ? `${id}.mp4` : `${id}@${scale}.mp4`);
run('ffmpeg', [
  '-v',
  'error',
  '-y',
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  list,
  ...(hasSound ? ['-i', audioFile, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k'] : ['-map', '0:v:0']),
  '-c:v',
  'copy',
  '-movflags',
  '+faststart',
  output,
]);
process.stdout.write(`${output}\n`);
