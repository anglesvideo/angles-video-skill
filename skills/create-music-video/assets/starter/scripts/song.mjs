#!/usr/bin/env node
// Has a song made from words the video's author wrote, through the user's
// Angles account (ANGLES_API_KEY). The words are sung as given, so every line
// the video will later put on screen is known before there is any sound.
//
//   node scripts/song.mjs anthem --lyrics src/anthem.lyrics.txt --title "Our Anthem" \
//       --style "pop punk, driving guitars, punchy drums, 160bpm, male vocals"
//       starts the song, waits for it, and saves the two versions the model
//       makes as public/song/anthem-1.mp3 and public/song/anthem-2.mp3.
//       --vocals male|female, --avoid "acoustic, slow tempo" and --seconds 90
//       (a target, not a promise) narrow it down.
//   node scripts/song.mjs anthem
//       comes back for a song that was started and not collected, or says
//       what is already there
//   node scripts/song.mjs --list
//       every song this workspace has, and its versions
//
// A song costs real money each time it is started. The same name with the
// same words is therefore never started twice: --force is how to ask again on
// purpose.
//
// The lyrics file is the words with [Verse], [Chorus], [Bridge] on lines of
// their own. The style is tags in English: genre, mood, instruments, tempo.
// Write the song for the video it will become — a build, a bar of silence
// before the chorus, a tempo with a clear beat — because the lights can only
// follow what is in it.
//
// The two versions are different performances of the same words. Someone has
// to listen to both: which one is better cannot be read off a file. Then
// scripts/beats.py measures the one that is kept.
//
// Every song is recorded in src/songs.json:
// { "anthem": { "id": …, "title": …, "versions": [{ "src": "song/anthem-1.mp3", "seconds": 90 }, …] } }
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { angles } from './media.mjs';

const MANIFEST = join('src', 'songs.json');
const DIRECTORY = join('public', 'song');
const TAKES_A_VALUE = ['--lyrics', '--title', '--style', '--vocals', '--avoid', '--seconds'];
const LONGEST = { lyrics: 5000, style: 1000, title: 80, avoid: 200 };
/** A song is usually ready in under a minute; a long one takes a few. */
const ASK_EVERY_MS = 5000;
const GIVE_UP_AFTER_MS = 15 * 60 * 1000;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function option(args, name) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value !== undefined && !value.startsWith('--') ? value : undefined;
}

const readJson = (file, otherwise) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : otherwise);

function writeJson(file, value) {
  mkdirSync('src', { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const describe = (name, song) =>
  `${name}: ${song.title}, made by ${song.model}\n${song.versions.map(version => `  ${version.src}${version.seconds ? `  ${Math.round(version.seconds)}s` : ''}`).join('\n')}\n`;

/** What the caller asked for, read and checked before anything is spent. */
function asking(args, name) {
  const lyricsFile = option(args, '--lyrics');
  if (!lyricsFile) fail(`${name} has not been started. Start it with --lyrics <file> --title "…" --style "…".`);
  if (!existsSync(lyricsFile)) fail(`There is no ${lyricsFile}.`);
  const asked = {
    lyrics: readFileSync(lyricsFile, 'utf8').trim(),
    title: option(args, '--title')?.trim(),
    style: option(args, '--style')?.trim(),
    ...(option(args, '--vocals') ? { vocals: option(args, '--vocals') } : {}),
    ...(option(args, '--avoid') ? { avoid: option(args, '--avoid').trim() } : {}),
    ...(option(args, '--seconds') ? { seconds: Number(option(args, '--seconds')) } : {}),
  };
  if (!asked.lyrics) fail(`${lyricsFile} is empty.`);
  if (!asked.title) fail('A song needs --title.');
  if (!asked.style) fail('A song needs --style: genre, mood, instruments and tempo, as tags in English.');
  for (const [field, longest] of Object.entries(LONGEST)) {
    if ((asked[field]?.length ?? 0) > longest) fail(`--${field} is ${asked[field].length} characters; the longest it can be is ${longest}.`);
  }
  if (asked.vocals && !['male', 'female'].includes(asked.vocals)) fail('--vocals takes male or female.');
  if ('seconds' in asked && !(Number.isInteger(asked.seconds) && asked.seconds >= 10 && asked.seconds <= 360)) fail('--seconds takes a whole number from 10 to 360.');
  return asked;
}

/** Waits for a started song, then brings its versions into public/song/. */
async function collect(name, songs) {
  const song = songs[name];
  const started = Date.now();
  let said = '';
  for (;;) {
    let reply;
    try {
      reply = await angles('GET', `/audio/songs/${song.id}`);
    } catch (error) {
      // The song is still being made whether or not this call got through.
      reply = { status: 'processing', note: error.message };
    }
    if (reply.status === 'failed') {
      delete songs[name];
      writeJson(MANIFEST, songs);
      fail(`${name} could not be made: ${reply.reason ?? 'no reason was given'}. Reword and start it again.`);
    }
    if (reply.status === 'completed') {
      mkdirSync(DIRECTORY, { recursive: true });
      const versions = [];
      for (const [index, version] of reply.versions.entries()) {
        const response = await fetch(version.url);
        if (!response.ok) fail(`${name} was made, but version ${index + 1} could not be fetched (${response.status}). Run the same command again.`);
        const file = join(DIRECTORY, `${name}-${index + 1}${extname(new URL(version.url).pathname) || '.mp3'}`);
        writeFileSync(file, Buffer.from(await response.arrayBuffer()));
        versions.push({ src: file.replace(/^public\//, ''), seconds: version.seconds ?? null, url: version.url });
      }
      songs[name] = { ...song, model: reply.model, versions };
      writeJson(MANIFEST, songs);
      process.stdout.write(describe(name, songs[name]));
      process.stdout.write('Listen to both before going on: they are two performances of the same words, and only one will be kept.\n');
      return;
    }
    const now = `${reply.progress ?? 0}%${reply.note ? ` (${reply.note})` : ''}`;
    if (now !== said) process.stdout.write(`${name}: being made, ${now}\n`);
    said = now;
    if (Date.now() - started > GIVE_UP_AFTER_MS) {
      fail(`${name} is still being made after ${GIVE_UP_AFTER_MS / 60000} minutes. It has not been lost: run \`node scripts/song.mjs ${name}\` to come back for it.`);
    }
    await new Promise(resolve => setTimeout(resolve, ASK_EVERY_MS));
  }
}

async function makeSong(args, songs) {
  const named = args.filter((arg, index) => !arg.startsWith('--') && !TAKES_A_VALUE.includes(args[index - 1]));
  if (named.length !== 1 || !/^[a-z0-9][a-z0-9-]*$/.test(named[0])) {
    fail('Name the song in lowercase letters, digits and hyphens: node scripts/song.mjs anthem --lyrics … --title … --style …');
  }
  const [name] = named;
  const made = songs[name];
  const starting = args.includes('--lyrics');
  const asked = starting ? asking(args, name) : null;

  if (made && !(starting && args.includes('--force'))) {
    if (asked && JSON.stringify(made.asked) !== JSON.stringify(asked)) {
      fail(`${name} was started from other words. --force starts it again from these, and is counted as a new song; or give this one another name.`);
    }
    if (made.versions?.length && made.versions.every(version => existsSync(join('public', version.src)))) {
      process.stdout.write(`${name} is already made.\n${describe(name, made)}`);
      return;
    }
    return collect(name, songs);
  }
  if (!asked) asking(args, name);

  let reply;
  try {
    reply = await angles('POST', '/audio/songs', asked);
  } catch (error) {
    fail(`angles could not start ${name}: ${error.message}`);
  }
  if (!reply?.id) fail(`angles started ${name} and gave no id to come back for it with.`);
  // Kept before waiting: a song that is being made must not be lost to a closed terminal.
  songs[name] = { id: reply.id, title: asked.title, model: reply.model, asked, versions: [] };
  writeJson(MANIFEST, songs);
  process.stdout.write(`${name}: started.\n`);
  return collect(name, songs);
}

async function main() {
  // A listing piped into `head` closes the pipe early; that is not an error.
  process.stdout.on('error', error => process.exit(error.code === 'EPIPE' ? 0 : 1));
  const args = process.argv.slice(2);
  const songs = readJson(MANIFEST, {});
  if (args.includes('--list')) {
    for (const [name, song] of Object.entries(songs)) {
      process.stdout.write(song.versions?.length ? describe(name, song) : `${name}: ${song.title}, started and not collected yet\n`);
    }
    return;
  }
  if (!process.env.ANGLES_API_KEY) {
    fail('ANGLES_API_KEY is not set. Songs are made through an Angles account; without one, use a song the user already has.');
  }
  return makeSong(args, songs);
}

main().catch(error => fail(error.message));
