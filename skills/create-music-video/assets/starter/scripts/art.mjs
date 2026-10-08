#!/usr/bin/env node
// Makes the pictures of a song's singer: first a few candidates to choose
// between, then every shot drawn from the one that was chosen, so that it is
// the same person in each.
//
//   node scripts/art.mjs dev --candidates    every candidate not yet made
//   node scripts/art.mjs dev                 every shot not yet made
//   node scripts/art.mjs dev refuse fist     those shots (add --force to remake them)
//   node scripts/art.mjs dev --dry-run       the words each picture would be made from
//
// What to draw is in src/<singer>.art.json, which you write:
//
//   {
//     "candidates": [
//       { "name": "night", "words": "An ordinary software developer of about twenty-eight, drawn as a character in a 3D animated film. Tall, thin and slouching, …" }
//     ],
//     "chosen": "night",
//     "who": "an ordinary software developer of about twenty-eight, drawn as a character in a 3D animated film. Tall, thin and slouching, …",
//     "shots": [
//       { "name": "refuse", "words": "Now a medium shot from the waist up: both open palms held out toward the camera, eyes closed." },
//       { "name": "empty", "words": "Now seen from behind, facing a dark arena in which every seat is empty.", "room": false }
//     ]
//   }
//
// A candidate is a reference sheet — full body, plain background — because
// that is what the shots are drawn from. Make candidates, show them, and write
// the name of the one the user picks into "chosen". "who" is that person again
// in the words every shot repeats; left out, the chosen candidate's own words
// are used. A shot says only what is different about this picture. "room" is
// the place every shot is in, and "sheet" how a reference sheet is laid out;
// both have a dark stage's defaults, and a shot with "room": false describes
// its own surroundings.
//
// Pictures are named <singer>-<name>, land in public/images/ and are listed in
// src/images.json. Each is one call to scripts/image.mjs, through the user's
// Angles account (ANGLES_API_KEY). A name already made from the same words is
// skipped, so this can be run again after it stops part-way without making
// anything twice.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LONGEST_PROMPT = 1500;
const SHEET =
  'Character reference sheet. Full body, standing and facing the camera, arms at the sides unless said otherwise. ' +
  'Plain dark charcoal studio background, soft even light. No text, no letters, no logos, no watermark.';
const ROOM =
  'A dark concert stage: near-black background, thin haze, cool white rim light from behind. ' +
  'No coloured light beams, no text, no letters, no logos, no watermark. Cinematic, shallow depth of field, high contrast.';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = args.filter(arg => arg.startsWith('--'));
const [singer, ...asked] = args.filter(arg => !arg.startsWith('--'));
if (!singer || !/^[a-z0-9][a-z0-9-]*$/.test(singer)) {
  fail('usage: node scripts/art.mjs <singer> [--candidates | <shot> …] [--force] [--dry-run]\nThe singer is named in lowercase letters, digits and hyphens, and described in src/<singer>.art.json.');
}
const file = join('src', `${singer}.art.json`);
if (!existsSync(file)) fail(`There is no ${file}. Write it first: the candidates to choose between, then the shots.`);
let art;
try {
  art = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  fail(`${file} is not valid JSON: ${error.message}`);
}
const candidates = art.candidates ?? [];
const shots = art.shots ?? [];
for (const one of [...candidates, ...shots]) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(one?.name ?? '') || !one.words?.trim()) fail(`Every candidate and shot in ${file} needs a "name" in lowercase letters, digits and hyphens, and "words".`);
}

let wanted;
if (flags.includes('--candidates')) {
  if (!candidates.length) fail(`${file} has no "candidates".`);
  wanted = candidates.map(candidate => ({ name: candidate.name, words: `${art.sheet ?? SHEET} ${candidate.words.trim()}`, aspect: '3:4' }));
} else {
  const chosen = candidates.find(candidate => candidate.name === art.chosen);
  if (!art.chosen) fail(`Nobody has been chosen yet. Make the candidates (--candidates), show them to the user, and write the one they pick into "chosen" in ${file}.`);
  if (!chosen) fail(`"chosen" is ${art.chosen}, which is not one of the candidates: ${candidates.map(candidate => candidate.name).join(', ') || 'there are none'}.`);
  const pictures = existsSync(join('src', 'images.json')) ? JSON.parse(readFileSync(join('src', 'images.json'), 'utf8')) : {};
  if (!pictures[`${singer}-${chosen.name}`]) fail(`${singer}-${chosen.name} has not been made, so there is nothing to draw the shots from. Run: node scripts/art.mjs ${singer} --candidates`);
  if (!shots.length) fail(`${file} has no "shots".`);
  const unknown = asked.filter(name => !shots.some(shot => shot.name === name));
  if (unknown.length) fail(`No shot called ${unknown.join(', ')}. The shots are: ${shots.map(shot => shot.name).join(', ')}.`);
  const who = (art.who ?? chosen.words).trim();
  wanted = shots
    .filter(shot => !asked.length || asked.includes(shot.name))
    .map(shot => ({
      name: shot.name,
      words: `The same person as in the reference picture: ${who} ${shot.words.trim()}${shot.room === false ? '' : ` ${art.room ?? ROOM}`}`,
      aspect: shot.aspect ?? '16:9',
      like: `${singer}-${chosen.name}`,
    }));
}

// Found before anything is made: a picture refused half-way down the list has already paid for the ones above it.
const long = wanted.filter(picture => picture.words.length > LONGEST_PROMPT);
if (long.length) fail(`Too many words: ${long.map(picture => `${picture.name} is ${picture.words.length} characters`).join(', ')}. A picture is described in at most ${LONGEST_PROMPT}; shorten "who" or the shot.`);

if (flags.includes('--dry-run')) {
  for (const picture of wanted) process.stdout.write(`\n— ${singer}-${picture.name} (${picture.aspect}${picture.like ? `, drawn from ${picture.like}` : ''}, ${picture.words.length} characters)\n${picture.words}\n`);
  process.exit(0);
}

for (const picture of wanted) {
  process.stdout.write(`\n— ${picture.name}\n`);
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./image.mjs', import.meta.url)), `${singer}-${picture.name}`, picture.words, '--aspect', picture.aspect, ...(picture.like ? ['--like', picture.like] : []), ...(flags.includes('--force') ? ['--force'] : [])],
    { stdio: 'inherit' }
  );
  if (result.status !== 0) {
    process.stderr.write(`\nStopped at ${picture.name}. Run the same command again to carry on from here.\n`);
    process.exit(result.status ?? 1);
  }
}
process.stdout.write(`\nAll of them are in public/images/. Open each one before it goes into the video.\n`);
