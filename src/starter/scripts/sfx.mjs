#!/usr/bin/env node
// Gets sound effects for the video: from the Angles library, or made new.
//
//   node scripts/sfx.mjs library [--family soft]
//       the sounds on offer (ANGLES_API_KEY), grouped in families that belong together
//   node scripts/sfx.mjs use soft-tick soft-pop soft-riser
//       downloads those into public/sfx/ ("--as <name>" renames a single one)
//   node scripts/sfx.mjs stamp "A rubber stamp hitting paper once, dry and close" --seconds 0.7
//       makes a new one with the user's own ElevenLabs key. This spends their
//       credits: ask first. --influence <0-1> holds it closer to the words;
//       --force makes it again.
//   node scripts/sfx.mjs --list
//       what this workspace already has
//
// Every sound is recorded in src/sfx.json, which a scene can import:
// { "stamp": { "src": "sfx/stamp.mp3", "seconds": 0.7, "hit": 0.04, … } }.
// `hit` is how far into the sound its loudest moment is.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { audioLibrary, durationOf, fetchSound, samplesOf, soundFormatOf } from './media.mjs';

const MANIFEST = join('src', 'sfx.json');
const DIRECTORY = join('public', 'sfx');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/** Length of a sound file, and how far in its loudest moment — the hit — is. */
function measure(file) {
  const samples = samplesOf(file);
  let loudest = 0;
  for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i]) > Math.abs(samples[loudest])) loudest = i;
  return { seconds: Math.round(durationOf(file) * 1000) / 1000, hit: Math.round((loudest / 22050) * 1000) / 1000 };
}

function keep(sounds, name, file, details) {
  sounds[name] = { src: file.split(/[\\/]/).slice(1).join('/'), ...measure(file), ...details };
  mkdirSync('src', { recursive: true });
  writeFileSync(MANIFEST, `${JSON.stringify(sounds, null, 2)}\n`);
  process.stdout.write(`${name}: ${sounds[name].src}, ${sounds[name].seconds.toFixed(2)}s, hit at ${sounds[name].hit.toFixed(2)}s\n`);
}

async function listLibrary(args) {
  const family = option(args, '--family');
  const sounds = (await audioLibrary()).sfx.filter(sound => !family || sound.family === family);
  if (!sounds.length) fail(family ? `The library has no "${family}" family.` : 'The library has no sound effects yet.');
  let current;
  for (const sound of [...sounds].sort((a, b) => String(a.family).localeCompare(String(b.family)))) {
    if (sound.family !== current) process.stdout.write(`${current ? '\n' : ''}${sound.family}\n`);
    current = sound.family;
    process.stdout.write(
      `  ${sound.id.padEnd(20)} ${Number(sound.seconds).toFixed(2)}s  hit at ${Number(sound.hit).toFixed(2)}s  ${sound.description}\n`
    );
  }
  process.stdout.write(`\n${sounds.length} sounds. Keep to one family in a video. Take some with: node scripts/sfx.mjs use <id> <id> …\n`);
}

async function useSounds(args, sounds) {
  const rename = option(args, '--as');
  const ids = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--as');
  if (!ids.length) fail('usage: node scripts/sfx.mjs use <id> [<id> …] [--as <name>]');
  if (rename && ids.length > 1) fail('--as names one sound; take the others in a separate call.');
  if (rename && !/^[A-Za-z0-9_-]+$/.test(rename)) fail('--as takes a name made of letters, digits, - and _.');

  const library = (await audioLibrary()).sfx;
  mkdirSync(DIRECTORY, { recursive: true });
  for (const id of ids) {
    const sound = library.find(entry => entry.id === id);
    if (!sound) fail(`The library has no sound "${id}". List them with: node scripts/sfx.mjs library`);
    const name = rename || id;
    const file = join(DIRECTORY, `${name}${extname(new URL(sound.url, 'file:///').pathname) || '.wav'}`);
    writeFileSync(file, await fetchSound(sound.url));
    keep(sounds, name, file, { text: sound.description, library: id });
  }
}

async function makeSound(args, sounds) {
  const [name, text] = args.filter((arg, index) => !arg.startsWith('--') && !(args[index - 1] || '').startsWith('--'));
  if (!name || !text || !/^[A-Za-z0-9_-]+$/.test(name)) {
    fail(
      'usage: node scripts/sfx.mjs library [--family <name>]\n       node scripts/sfx.mjs use <id> [<id> …]\n       node scripts/sfx.mjs <name> "<what it sounds like>" [--seconds <0.5-10>] [--influence <0-1>] [--force]\n       node scripts/sfx.mjs --list'
    );
  }
  const seconds = option(args, '--seconds');
  const influence = option(args, '--influence');
  if (seconds !== undefined && !(Number(seconds) >= 0.5 && Number(seconds) <= 10)) fail('--seconds takes a length from 0.5 to 10.');
  if (influence !== undefined && !(Number(influence) >= 0 && Number(influence) <= 1)) fail('--influence takes a number from 0 to 1.');

  const asked = { text, ...(seconds ? { length: Number(seconds) } : {}), ...(influence ? { influence: Number(influence) } : {}) };
  const made = sounds[name];
  if (made && !args.includes('--force') && existsSync(join('public', made.src)) && JSON.stringify(made.asked) === JSON.stringify(asked)) {
    process.stdout.write(`${name} is already made: ${made.src}, ${made.seconds.toFixed(2)}s\n`);
    return;
  }

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) fail('ELEVENLABS_API_KEY is not set. To take a sound from the Angles library instead: node scripts/sfx.mjs library');
  const base = process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io';
  const response = await fetch(`${base}/v1/sound-generation`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      ...(seconds ? { duration_seconds: Number(seconds) } : {}),
      ...(influence ? { prompt_influence: Number(influence) } : {}),
    }),
  });
  if (!response.ok) {
    fail(`elevenlabs could not make ${name}: HTTP ${response.status} ${(await response.text().catch(() => '')).slice(0, 300)}`.trim());
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) fail('elevenlabs returned an empty file.');

  mkdirSync(DIRECTORY, { recursive: true });
  const draft = join(DIRECTORY, `${name}.download`);
  writeFileSync(draft, bytes);
  const file = join(DIRECTORY, `${name}.${soundFormatOf(draft)}`);
  renameSync(draft, file);
  keep(sounds, name, file, { text, asked });
}

async function main() {
  const args = process.argv.slice(2);
  const sounds = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  if (args[0] === 'library') return listLibrary(args.slice(1));
  if (args[0] === 'use') return useSounds(args.slice(1), sounds);
  if (args.includes('--list')) {
    for (const [name, sound] of Object.entries(sounds)) {
      process.stdout.write(`${name.padEnd(20)} ${sound.seconds.toFixed(2)}s, hit at ${sound.hit.toFixed(2)}s  ${sound.src}  ${sound.text}\n`);
    }
    return;
  }
  return makeSound(args, sounds);
}

main().catch(error => fail(error.message));
