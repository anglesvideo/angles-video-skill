#!/usr/bin/env node
// Makes a picture the video needs and code cannot draw — an illustration, a
// scene, a cover — through the user's Angles account (ANGLES_API_KEY).
//
//   node scripts/image.mjs --style "Flat gouache, deep teal and warm amber, visible brush texture, no text"
//       fixes how every picture in this workspace is drawn. The words are added
//       to every description, and the first picture made becomes the one every
//       later picture is drawn like. Alone, --style shows what is in force.
//   node scripts/image.mjs harbour "A harbour at night seen from the quay, three boats low in the frame"
//       makes public/images/harbour.jpg, 16:9. --aspect 9:16 | 1:1 | 4:3 | 3:4
//       for another shape; --force makes it again from the same words.
//   node scripts/image.mjs dawn "The harbour at dawn, the window dark, mist on the water" --like harbour
//       the same place and things again, changed only as the words say
//   node scripts/image.mjs --style-from harbour
//       names another picture as the one the rest are drawn like
//   node scripts/image.mjs --list
//       what this workspace has, and which pictures no longer match the style
//
// An account makes a limited number of pictures a day; every call says how many
// are left. The same name with the same words is not made twice.
//
// Every picture is recorded in src/images.json, which a scene can import:
// { "harbour": { "src": "images/harbour.jpg", "width": 2848, "height": 1600, "generated": true, … } }.
// `generated` is there so the video can say so: a made picture is an
// illustration, and is never shown as a photograph of the thing itself.
// The style is in src/images.style.json; delete that file to draw without one.
//
// A picture is drawn like another by sending that other picture along. It goes
// to the account's storage once, and only pictures this script made are sent.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { angles } from './media.mjs';

const MANIFEST = join('src', 'images.json');
const STYLE = join('src', 'images.style.json');
const DIRECTORY = join('public', 'images');
const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const LONGEST_PROMPT = 1500;
const LONGEST_STYLE = 300;
const TAKES_A_VALUE = ['--aspect', '--like', '--style', '--style-from'];
const MIME_TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

// What the provider is told about the picture sent along. Both were tried
// against it: the first holds the hand and lets the scene go, the second holds
// the place and its things.
const IN_ITS_STYLE =
  'Drawn in the same style as the reference picture: the same medium, palette and brushwork. A different scene — nothing in the reference picture appears here unless these words ask for it.';
const THE_SAME_AGAIN =
  'Drawn from the reference picture: the same place and things in the same style, changed only as these words say.';

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

/** Width and height of a JPEG, PNG or WebP, read from the file's own header. */
function sizeOf(bytes) {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const kind = bytes.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    if (kind === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const packed = bytes.readUInt32LE(21);
      return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
    }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // A JPEG is a run of segments; the frame header is the one that holds the size.
    for (let at = 2; at + 9 < bytes.length; ) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1];
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrameHeader) return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
      at += 2 + bytes.readUInt16BE(at + 2);
    }
  }
  return null;
}

const fileOf = picture => join('public', picture.src);

/** What a picture file is, in a few characters: a picture made again is a different picture. */
const stampOf = picture => (existsSync(fileOf(picture)) ? createHash('sha256').update(readFileSync(fileOf(picture))).digest('hex').slice(0, 16) : null);

/** One sentence after another, each closed with a full stop; a description with nothing added goes as it was written. */
function sentences(...parts) {
  const said = parts.map(part => (part || '').trim()).filter(Boolean);
  return said.length < 2 ? (said[0] ?? '') : said.map(part => (/[.!?。！？…]$/.test(part) ? part : `${part}.`)).join(' ');
}

/**
 * Why a picture no longer belongs with the rest, or null. Each of these is put
 * right by running the picture's command again: it will not say "already made".
 */
function outOfStep(name, picture, pictures, style) {
  for (const [other, stamp] of Object.entries(picture.from ?? {})) {
    if (!pictures[other] || stampOf(pictures[other]) !== stamp) return `drawn from an earlier ${other}`;
  }
  if (!style || name === style.like) return null;
  if ((picture.asked?.style ?? '') !== (style.words ?? '')) return 'made before this style';
  if (style.like && !picture.asked?.like && !(style.like in (picture.from ?? {}))) return `not drawn like ${style.like}`;
  return null;
}

/** The link Angles serves a picture from, uploading it the first time it is asked for. */
async function linkTo(name, pictures) {
  const picture = pictures[name];
  const stamp = stampOf(picture);
  if (picture.uploaded?.of === stamp) return picture.uploaded.url;
  const form = new FormData();
  const type = MIME_TYPES[extname(picture.src).toLowerCase()];
  form.append('file', new Blob([readFileSync(fileOf(picture))], { type }), basename(picture.src));
  let reply;
  try {
    reply = await angles('POST', '/assets', form);
  } catch (error) {
    fail(`angles could not take ${name} to draw from: ${error.message}`);
  }
  if (!/^https:\/\//.test(String(reply?.url ?? ''))) fail(`angles took ${name} and gave no link to it.`);
  // Kept at once: if the picture that follows fails, this one is not sent twice.
  picture.uploaded = { of: stamp, url: reply.url };
  writeJson(MANIFEST, pictures);
  return reply.url;
}

function showStyle(style) {
  if (!style) {
    process.stdout.write('No style is set. Set one before the first picture: node scripts/image.mjs --style "<how every picture is drawn>"\n');
    return;
  }
  if (style.words) process.stdout.write(`Style: ${style.words}\n`);
  process.stdout.write(
    style.like ? `Every picture is drawn like ${style.like}.\n` : 'The next picture made becomes the one the others are drawn like.\n'
  );
}

function setStyle(words, pictures) {
  if (words.length > LONGEST_STYLE) fail(`The style is ${words.length} characters; keep it to ${LONGEST_STYLE}: the medium, the palette, the light, what is left out.`);
  const before = readJson(STYLE, null);
  if (before?.words === words) return showStyle(before);
  // New words are a new hand, so the picture the others were drawn like goes with the old ones.
  const style = { words, like: null };
  writeJson(STYLE, style);
  showStyle(style);
  const old = Object.keys(pictures);
  if (old.length) process.stdout.write(`Made before this style: ${old.join(', ')}. Run each one's command again to draw it in the new one.\n`);
}

function setStyleFrom(name, pictures) {
  if (!pictures[name]) fail(`There is no picture "${name}". ${Object.keys(pictures).length ? `There are: ${Object.keys(pictures).join(', ')}.` : 'Make one first.'}`);
  if (!existsSync(fileOf(pictures[name]))) fail(`${pictures[name].src} is not in public/. Make ${name} again first.`);
  const style = { words: readJson(STYLE, null)?.words ?? '', like: name };
  writeJson(STYLE, style);
  showStyle(style);
  const others = Object.keys(pictures).filter(other => outOfStep(other, pictures[other], pictures, style));
  if (others.length) process.stdout.write(`Not drawn like it yet: ${others.join(', ')}. Run each one's command again.\n`);
}

async function makePicture(args, pictures) {
  const [name, text] = args.filter((arg, index) => !arg.startsWith('--') && !TAKES_A_VALUE.includes(args[index - 1]));
  if (!name || !text || !/^[A-Za-z0-9_-]+$/.test(name)) {
    fail(
      `usage: node scripts/image.mjs <name> "<what the picture shows>" [--aspect ${ASPECTS.join('|')}] [--like <name>] [--force]\n       node scripts/image.mjs --style "<how every picture is drawn>"\n       node scripts/image.mjs --style-from <name>\n       node scripts/image.mjs --list`
    );
  }
  const aspect = option(args, '--aspect') ?? '16:9';
  if (!ASPECTS.includes(aspect)) fail(`--aspect takes one of ${ASPECTS.join(', ')}.`);

  const style = readJson(STYLE, null);
  const like = option(args, '--like');
  if (args.includes('--like') && !like) fail('--like takes the name of a picture this workspace has.');
  if (like === name) fail(`${name} cannot be drawn like itself.`);
  // Drawn like the picture it names, or else like the one the style is fixed to.
  const source = like ?? (style?.like && style.like !== name ? style.like : null);
  if (source && !pictures[source]) {
    fail(`There is no picture "${source}" to draw from. ${like ? `There are: ${Object.keys(pictures).join(', ') || 'none yet'}.` : 'Name another with: node scripts/image.mjs --style-from <name>'}`);
  }
  if (source && !existsSync(fileOf(pictures[source]))) fail(`${pictures[source].src} is not in public/. Make ${source} again first.`);

  const prompt = sentences(text, style?.words, source && (like ? THE_SAME_AGAIN : IN_ITS_STYLE));
  if (prompt.length > LONGEST_PROMPT) {
    const added = prompt.length > text.trim().length ? ', with the style and what it is drawn from added,' : '';
    fail(`The description${added} is ${prompt.length} characters; the longest a picture can be asked for in is ${LONGEST_PROMPT}. Shorten it by ${prompt.length - LONGEST_PROMPT}.`);
  }

  const asked = { text, aspect, ...(style?.words ? { style: style.words } : {}), ...(like ? { like } : {}) };
  const from = source ? { [source]: stampOf(pictures[source]) } : {};
  const made = pictures[name];
  const same = made && JSON.stringify(made.asked) === JSON.stringify(asked) && JSON.stringify(made.from ?? {}) === JSON.stringify(from);
  if (same && !args.includes('--force') && existsSync(fileOf(made))) {
    process.stdout.write(`${name} is already made: ${made.src}, ${made.width}×${made.height}. --force makes it again.\n`);
    return;
  }

  if (!process.env.ANGLES_API_KEY) {
    fail('ANGLES_API_KEY is not set. Pictures are made through an Angles account; without one, use a picture the user has, or draw the scene in code.');
  }
  const references = source ? [await linkTo(source, pictures)] : [];
  let reply;
  try {
    reply = await angles('POST', '/images', { prompt, aspect, ...(references.length ? { references } : {}) });
  } catch (error) {
    fail(`angles could not make ${name}: ${error.message}`);
  }
  const bytes = Buffer.from(String(reply?.image ?? ''), 'base64');
  const size = sizeOf(bytes);
  if (!size || !['jpg', 'png', 'webp'].includes(reply.format)) fail(`angles returned something that is not a picture for ${name}.`);

  mkdirSync(DIRECTORY, { recursive: true });
  const file = join(DIRECTORY, `${name}.${reply.format}`);
  // The same name made again may come back in another format; one file per name.
  if (made && fileOf(made) !== file) rmSync(fileOf(made), { force: true });
  writeFileSync(file, bytes);

  pictures[name] = {
    src: `images/${name}.${reply.format}`,
    ...size,
    generated: true,
    model: reply.model,
    asked,
    ...(source ? { from } : {}),
  };
  writeJson(MANIFEST, pictures);
  const drawn = source ? `, ${like ? 'drawn from' : 'drawn like'} ${source}` : '';
  const left = Number.isFinite(reply.remaining) ? ` ${reply.remaining} left today.` : '';
  process.stdout.write(`${name}: ${pictures[name].src}, ${size.width}×${size.height}, made by ${reply.model}${drawn}.${left}\n`);

  if (style && !style.like) {
    // The first picture under a style is the style, as far as the provider can be shown it.
    writeJson(STYLE, { ...style, like: name });
    process.stdout.write(`${name} is now the picture every later one is drawn like. Open it first: if it is not right, make it again before making the next.\n`);
  } else {
    process.stdout.write('Open it before it goes into a scene: a made picture can come back with the wrong thing in it.\n');
  }
  const stale = Object.keys(pictures).filter(other => other !== name && outOfStep(other, pictures[other], pictures, readJson(STYLE, null)) === `drawn from an earlier ${name}`);
  if (stale.length) process.stdout.write(`Drawn from the ${name} this replaces: ${stale.join(', ')}. Run each one's command again.\n`);
}

function list(pictures) {
  const style = readJson(STYLE, null);
  if (style) showStyle(style);
  for (const [name, picture] of Object.entries(pictures)) {
    const note = name === style?.like ? 'the others are drawn like this' : outOfStep(name, picture, pictures, style);
    process.stdout.write(
      `${name.padEnd(20)} ${`${picture.width}×${picture.height}`.padEnd(11)} ${picture.src}  ${note ? `[${note}] ` : ''}${picture.asked?.text ?? ''}\n`
    );
  }
}

async function main() {
  // A listing piped into `head` closes the pipe early; that is not an error.
  process.stdout.on('error', error => process.exit(error.code === 'EPIPE' ? 0 : 1));
  const args = process.argv.slice(2);
  const pictures = readJson(MANIFEST, {});
  if (args.includes('--list')) return list(pictures);
  const named = args.filter((arg, index) => !arg.startsWith('--') && !TAKES_A_VALUE.includes(args[index - 1]));
  if (named.length && (args.includes('--style') || args.includes('--style-from'))) {
    fail('Set the style in a call of its own, then make the picture.');
  }
  if (args.includes('--style-from')) {
    const name = option(args, '--style-from');
    if (!name) fail('--style-from takes the name of a picture this workspace has.');
    return setStyleFrom(name, pictures);
  }
  if (args.includes('--style')) {
    const words = option(args, '--style')?.trim();
    return words ? setStyle(words, pictures) : showStyle(readJson(STYLE, null));
  }
  return makePicture(args, pictures);
}

main().catch(error => fail(error.message));
