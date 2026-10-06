#!/usr/bin/env node
// Writes what goes out beside a finished episode, from what the episode was
// made of — so the subtitles, the chapter times and the source list cannot
// disagree with the video.
//
//   node scripts/handover.mjs src/ep01.script.json
//   node scripts/handover.mjs src/ep01.script.json --cover 12.5
//
// Into out/<video>/:
//   <video>.srt         the lines as subtitles, timed to the voice
//   chapters.txt        where each chapter starts, as platforms read them
//   sources.md          the sources the script and the screen actually rest
//                       on, and the credit each picture's licence asks for
//   description.md      the question, the chapters and the sources together
//   cover.jpg           one frame of out/<video>.final.mp4 at full size: the
//                       first, or the one --cover names in seconds
//
// The titles are yours to write; this is the part that is copied, not written.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { run } from './media.mjs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const list = value => (Array.isArray(value) ? value : value ? [value] : []);
const pad = (value, width = 2) => String(value).padStart(width, '0');

/** 3723.5 -> "01:02:03,500" */
function srtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

/** 83 -> "1:23"; past an hour, "1:02:03". */
function clock(seconds) {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  return hours ? `${hours}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}` : `${Math.floor(whole / 60)}:${pad(whole % 60)}`;
}

const args = process.argv.slice(2);
const scriptPath = args.find((arg, index) => !arg.startsWith('--') && !(args[index - 1] || '').startsWith('--'));
if (!scriptPath || !scriptPath.endsWith('.script.json')) fail('usage: node scripts/handover.mjs src/<video>.script.json [--cover <seconds>]');
const name = basename(scriptPath, '.script.json');
const beside = file => join(dirname(scriptPath), `${name}.${file}`);
for (const file of [scriptPath, beside('facts.json'), beside('audio.json')]) {
  if (!existsSync(file)) fail(`No ${file}. The handover is written from the script, the facts and the voiced timeline.`);
}
const script = JSON.parse(readFileSync(scriptPath, 'utf8'));
const book = JSON.parse(readFileSync(beside('facts.json'), 'utf8'));
const track = JSON.parse(readFileSync(beside('audio.json'), 'utf8'));

const directory = join('out', name);
mkdirSync(directory, { recursive: true });
const written = [];
const write = (file, text) => {
  writeFileSync(join(directory, file), text);
  written.push(join(directory, file));
};

// Subtitles: each line from the moment it is said until the next one is.
const srt = track.clips
  .map((clip, index) => {
    const next = track.clips[index + 1];
    const end = Math.min(clip.at + clip.seconds + 0.3, next ? next.at - 0.05 : track.totalSeconds);
    return `${index + 1}\n${srtTime(clip.at)} --> ${srtTime(Math.max(end, clip.at + 0.5))}\n${clip.text}\n`;
  })
  .join('\n');
write(`${name}.srt`, srt);

// Chapters: the first one at 0:00, as platforms require; the others where their first line is said.
const chapters = (script.chapters ?? [])
  .map((chapter, index) => {
    const first = track.clips.find(clip => clip.id.startsWith(chapter.id));
    return first ? `${clock(index === 0 ? 0 : first.at)} ${chapter.title}` : null;
  })
  .filter(Boolean);
if (chapters.length) write('chapters.txt', `${chapters.join('\n')}\n`);

// Sources: the ones a spoken line or something on screen rests on, in the order the facts file lists them.
const factOf = new Map((book.facts ?? []).map(fact => [fact.id, fact]));
const usedFacts = new Set([
  ...(script.lines ?? []).flatMap(line => list(line.facts)),
  ...Object.values(book.screen ?? {}).map(entry => entry?.fact).filter(Boolean),
]);
const usedSources = new Set([...usedFacts].flatMap(id => list(factOf.get(id)?.sources)));
const cited = (book.sources ?? []).filter(source => usedSources.has(source.id));
const cite = source =>
  `- ${[source.author, source.title, source.edition, source.year].filter(Boolean).join(', ')}${source.url ? ` — ${source.url}` : ''}`;
const credits = (book.images ?? []).filter(image => image.credit).map(image => `- ${image.credit}`);
const sources = [`## Sources`, '', ...cited.map(cite), ...(credits.length ? ['', '## Pictures', '', ...credits] : [])].join('\n');
write('sources.md', `${sources}\n`);

const description = [book.question ?? script.title ?? '', '', ...(chapters.length ? [...chapters, ''] : []), sources].join('\n');
write('description.md', `${description}\n`);

// The cover: a frame of the finished video, at the size it was rendered.
const video = [join('out', `${name}.final.mp4`), join('out', `${name}.mp4`)].find(existsSync);
const coverAt = Number(option(args, '--cover') ?? 0);
if (!Number.isFinite(coverAt) || coverAt < 0) fail(`--cover takes a moment in seconds — got "${option(args, '--cover')}".`);
if (video) {
  const cover = join(directory, 'cover.jpg');
  run('ffmpeg', ['-v', 'error', '-y', '-ss', coverAt.toFixed(3), '-i', video, '-frames:v', '1', '-q:v', '2', cover]);
  written.push(cover);
}

process.stdout.write(`${written.join('\n')}\n`);
if (!video) process.stdout.write(`note: no cover — out/${name}.final.mp4 is not there yet. Run this again after scripts/finish.mjs.\n`);
const uncited = [...usedFacts].filter(id => !factOf.has(id));
if (uncited.length) process.stdout.write(`note: the script names facts that are not in the facts file (${uncited.join(', ')}). Run scripts/check.mjs.\n`);
