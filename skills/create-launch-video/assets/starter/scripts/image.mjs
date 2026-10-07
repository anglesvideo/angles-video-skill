#!/usr/bin/env node
// Makes a picture the video needs and code cannot draw — an illustration, a
// scene, a cover — through the user's Angles account (ANGLES_API_KEY).
//
//   node scripts/image.mjs harbour "A harbour at night seen from the quay, flat gouache, teal and amber, no text"
//       makes public/images/harbour.jpg, 16:9. --aspect 9:16 | 1:1 | 4:3 | 3:4
//       for another shape; --force makes it again from the same words.
//   node scripts/image.mjs --list
//       what this workspace already has
//
// An account makes a limited number of pictures a day; every call says how many
// are left. The same name with the same words is not made twice.
//
// Every picture is recorded in src/images.json, which a scene can import:
// { "harbour": { "src": "images/harbour.jpg", "width": 2848, "height": 1600, "generated": true, … } }.
// `generated` is there so the video can say so: a made picture is an
// illustration, and is never shown as a photograph of the thing itself.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { angles } from './media.mjs';

const MANIFEST = join('src', 'images.json');
const DIRECTORY = join('public', 'images');
const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const LONGEST_PROMPT = 1500;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
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

async function makePicture(args, pictures) {
  const [name, text] = args.filter((arg, index) => !arg.startsWith('--') && !(args[index - 1] || '').startsWith('--'));
  if (!name || !text || !/^[A-Za-z0-9_-]+$/.test(name)) {
    fail(
      `usage: node scripts/image.mjs <name> "<what the picture shows, and how it is drawn>" [--aspect ${ASPECTS.join('|')}] [--force]\n       node scripts/image.mjs --list`
    );
  }
  const aspect = option(args, '--aspect') ?? '16:9';
  if (!ASPECTS.includes(aspect)) fail(`--aspect takes one of ${ASPECTS.join(', ')}.`);
  if (text.length > LONGEST_PROMPT) fail(`The description is ${text.length} characters; the longest a picture can be asked for in is ${LONGEST_PROMPT}.`);

  const asked = { text, aspect };
  const made = pictures[name];
  if (made && !args.includes('--force') && existsSync(join('public', made.src)) && JSON.stringify(made.asked) === JSON.stringify(asked)) {
    process.stdout.write(`${name} is already made: ${made.src}, ${made.width}×${made.height}. --force makes it again.\n`);
    return;
  }

  if (!process.env.ANGLES_API_KEY) {
    fail('ANGLES_API_KEY is not set. Pictures are made through an Angles account; without one, use a picture the user has, or draw the scene in code.');
  }
  let reply;
  try {
    reply = await angles('POST', '/images', { prompt: text, aspect });
  } catch (error) {
    fail(`angles could not make ${name}: ${error.message}`);
  }
  const bytes = Buffer.from(String(reply?.image ?? ''), 'base64');
  const size = sizeOf(bytes);
  if (!size || !['jpg', 'png', 'webp'].includes(reply.format)) fail(`angles returned something that is not a picture for ${name}.`);

  mkdirSync(DIRECTORY, { recursive: true });
  const file = join(DIRECTORY, `${name}.${reply.format}`);
  // The same name made again may come back in another format; one file per name.
  if (made && join('public', made.src) !== file) rmSync(join('public', made.src), { force: true });
  writeFileSync(file, bytes);

  pictures[name] = {
    src: `images/${name}.${reply.format}`,
    ...size,
    generated: true,
    model: reply.model,
    asked,
  };
  mkdirSync('src', { recursive: true });
  writeFileSync(MANIFEST, `${JSON.stringify(pictures, null, 2)}\n`);
  const left = Number.isFinite(reply.remaining) ? ` ${reply.remaining} left today.` : '';
  process.stdout.write(`${name}: ${pictures[name].src}, ${size.width}×${size.height}, made by ${reply.model}.${left}\n`);
  process.stdout.write('Open it before it goes into a scene: a made picture can come back with the wrong thing in it.\n');
}

async function main() {
  // A listing piped into `head` closes the pipe early; that is not an error.
  process.stdout.on('error', error => process.exit(error.code === 'EPIPE' ? 0 : 1));
  const args = process.argv.slice(2);
  const pictures = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  if (args.includes('--list')) {
    for (const [name, picture] of Object.entries(pictures)) {
      process.stdout.write(`${name.padEnd(20)} ${`${picture.width}×${picture.height}`.padEnd(11)} ${picture.src}  ${picture.asked?.text ?? ''}\n`);
    }
    return;
  }
  return makePicture(args, pictures);
}

main().catch(error => fail(error.message));
