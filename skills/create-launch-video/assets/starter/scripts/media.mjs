// Runs ffmpeg and ffprobe for the other scripts: the system build when one is
// installed, otherwise the build that ships inside Remotion — so a workspace
// needs nothing beyond `npm install`.
//
// Remotion's build is a small one. It measures, cuts, scales, joins, encodes
// and normalises loudness, which is everything these scripts ask of it, but it
// has no scene-detection or tiling filters. Pages of frames are therefore put
// together here, in `tile`; reach for a system ffmpeg for scene detection.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

const MAX_OUTPUT = 64 * 1024 * 1024;

let remotionCli;
function findRemotionCli() {
  if (remotionCli) return remotionCli;
  let manifestPath;
  try {
    manifestPath = createRequire(join(process.cwd(), 'package.json')).resolve('@remotion/cli/package.json');
  } catch {
    manifestPath = join(process.cwd(), 'node_modules', '@remotion', 'cli', 'package.json');
  }
  if (!existsSync(manifestPath)) {
    throw new Error(
      'Neither a system ffmpeg nor Remotion was found. Run `npm install` in the video workspace, and run this script from that directory.'
    );
  }
  const bin = JSON.parse(readFileSync(manifestPath, 'utf8')).bin;
  remotionCli = join(dirname(manifestPath), typeof bin === 'string' ? bin : bin.remotion);
  return remotionCli;
}

function spawn(command, args, encoding) {
  return spawnSync(command, args, { encoding, maxBuffer: MAX_OUTPUT, stdio: ['ignore', 'pipe', 'pipe'] });
}

function runWith(tool, args, encoding) {
  let result = spawn(tool, args, encoding);
  if (result.error?.code === 'ENOENT') {
    result = spawn(process.execPath, [findRemotionCli(), tool, ...args], encoding);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const tail = String(result.stderr || '').trim().split('\n').slice(-6).join('\n');
    throw new Error(`${tool} failed (exit ${result.status}):\n${tail}`);
  }
  return result;
}

/** Runs a Remotion command (`render`, `still`…) in this workspace, showing what it prints. */
export function remotion(args) {
  const result = spawnSync(process.execPath, [findRemotionCli(), ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`remotion ${args[0]} failed (exit ${result.status}).`);
}

/**
 * Runs `ffmpeg` or `ffprobe` with `args` and returns `{ stdout, stderr }`.
 * Throws with the tail of stderr when the tool exits non-zero.
 */
export function run(tool, args) {
  const result = runWith(tool, args, 'utf8');
  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Decodes a sound file to mono samples between -1 and 1 at `rate` Hz.
 * Goes through WAV because Remotion's ffmpeg cannot write raw PCM.
 */
export function samplesOf(file, rate = 22050) {
  const { stdout } = runWith(
    'ffmpeg',
    ['-v', 'error', '-t', '600', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-c:a', 'pcm_s16le', '-f', 'wav', '-'],
    'buffer'
  );
  const marker = stdout.indexOf('data', 12, 'latin1');
  if (marker < 0) throw new Error(`Could not decode ${file}.`);
  const start = marker + 8;
  const count = Math.floor((stdout.length - start) / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = stdout.readInt16LE(start + i * 2) / 32768;
  return samples;
}

/** Container a sound file is really in, whatever its name says: 'mp3', 'wav', 'ogg', 'm4a'… */
export function soundFormatOf(file) {
  const { stdout } = run('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name', '-of', 'csv=p=0', file]);
  const names = stdout.trim().split(',');
  if (names.includes('mp3')) return 'mp3';
  if (names.includes('wav')) return 'wav';
  if (names.includes('ogg')) return 'ogg';
  if (names.includes('m4a') || names.includes('mp4')) return 'm4a';
  if (names.includes('flac')) return 'flac';
  return names[0] || 'mp3';
}

/**
 * Calls the Angles API with the account's key: a JSON body, or a FormData to
 * upload a file. Returns the parsed reply; throws with the server's own message
 * when it refuses.
 */
export async function angles(method, path, body) {
  const key = process.env.ANGLES_API_KEY;
  if (!key) throw new Error('ANGLES_API_KEY is not set.');
  const base = (process.env.ANGLES_API_BASE_URL || 'https://api.angles.video/api/developer/v1').replace(/\/+$/, '');
  // A form is a file being uploaded; fetch writes its own content type for one.
  const form = body instanceof FormData;
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body && !form ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: form ? body : JSON.stringify(body) } : {}),
  });
  const reply = await response.json().catch(() => null);
  if (!response.ok) {
    const said = reply?.details?.message ?? reply?.message;
    throw new Error(`HTTP ${response.status}${said ? ` ${[].concat(said).join('; ')}` : ''}`);
  }
  return reply;
}

/**
 * The Angles audio library: `{ music: [...], sfx: [...] }`, each entry with an
 * id, a description, a url, and the measurements needed to choose it.
 * ANGLES_LIBRARY_URL reads a catalog from somewhere else — a URL, or a
 * catalog.json on disk — to try a library before it is published.
 */
export async function audioLibrary() {
  const elsewhere = process.env.ANGLES_LIBRARY_URL;
  if (!elsewhere) return angles('GET', '/audio/library');
  if (!/^https?:\/\//i.test(elsewhere)) {
    // A catalog on disk is a library that has been built but not published:
    // its links point at where the files will be, so use the ones beside it.
    const catalog = JSON.parse(readFileSync(elsewhere, 'utf8'));
    for (const kind of ['music', 'sfx']) {
      for (const entry of catalog[kind] ?? []) {
        const beside = join(dirname(elsewhere), kind, String(entry.url).split('/').pop());
        if (existsSync(beside)) entry.url = beside;
      }
    }
    return catalog;
  }
  const response = await fetch(elsewhere);
  if (!response.ok) throw new Error(`HTTP ${response.status} reading ${elsewhere}`);
  return response.json();
}

/** Downloads a library file, or copies it when the catalog points at the disk. */
export async function fetchSound(url) {
  if (!/^https?:\/\//i.test(url)) return readFileSync(url.replace(/^file:\/\//, ''));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Length of a sound or video file in seconds. */
export function durationOf(file) {
  const { stdout } = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Could not measure ${file}: ffprobe reported "${stdout.trim()}".`);
  }
  return seconds;
}

/** Stream kinds in a file, e.g. ['video', 'audio']. */
export function streamsOf(file) {
  const { stdout } = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]);
  return stdout
    .split('\n')
    .map(line => line.replace(/,/g, '').trim())
    .filter(Boolean);
}

/** Width, height and length of a video file's first video stream. */
export function videoInfo(file) {
  const { stdout } = run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height:format=duration',
    '-of',
    'json',
    file,
  ]);
  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0];
  if (!stream) throw new Error(`${file} has no picture.`);
  return { width: stream.width, height: stream.height, seconds: Number(parsed.format?.duration) };
}

/** An 8-bit RGB or RGBA PNG, as ffmpeg writes one, as rows of RGB bytes. */
function decodePng(buffer) {
  let width = 0;
  let height = 0;
  let channels = 3;
  const packed = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || (data[9] !== 2 && data[9] !== 6) || data[12] !== 0) throw new Error('Not an 8-bit RGB PNG.');
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      packed.push(data);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(packed));
  const stride = width * channels;
  const rgb = Buffer.alloc(width * height * 3);
  let above = Buffer.alloc(stride);
  let row = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = above[x];
      const corner = x >= channels ? above[x - channels] : 0;
      let value = raw[line + x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const guess = left + up - corner;
        const fromLeft = Math.abs(guess - left);
        const fromUp = Math.abs(guess - up);
        const fromCorner = Math.abs(guess - corner);
        value += fromLeft <= fromUp && fromLeft <= fromCorner ? left : fromUp <= fromCorner ? up : corner;
      }
      row[x] = value & 255;
    }
    for (let x = 0; x < width; x++) row.copy(rgb, (y * width + x) * 3, x * channels, x * channels + 3);
    [above, row] = [row, above];
  }
  return { width, height, rgb };
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = CRC[(crc ^ byte) & 255] ^ (crc >>> 8);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 4);
  return out;
}

function encodePng(width, height, rgb) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) rgb.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Lays pictures out twelve to a page, in order, as `<directory>/sheet-01.jpg`
 * and so on, and returns the pages written. A portrait video gets more,
 * narrower columns, so a page stays about as wide as it is tall. The pages are
 * put together here rather than by ffmpeg, whose build inside Remotion has no
 * filter for it.
 */
export function tile(files, directory, { portrait = false } = {}) {
  const perPage = 12;
  const columns = portrait ? 6 : 4;
  const across = portrait ? 420 : 640;
  const gap = 6;
  const work = mkdtempSync(join(tmpdir(), 'sheet-'));
  const pages = [];
  try {
    for (let start = 0; start < files.length; start += perPage) {
      const cells = files.slice(start, start + perPage).map((file, index) => {
        const small = join(work, `${index}.png`);
        run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', `scale=${across}:-2`, '-pix_fmt', 'rgb24', small]);
        return decodePng(readFileSync(small));
      });
      const down = cells[0].height;
      const rowsOfCells = perPage / columns;
      const width = columns * across + (columns - 1) * gap;
      const height = rowsOfCells * down + (rowsOfCells - 1) * gap;
      const page = Buffer.alloc(width * height * 3, 255);
      cells.forEach((cell, index) => {
        const left = (index % columns) * (across + gap);
        const top = Math.floor(index / columns) * (down + gap);
        for (let y = 0; y < Math.min(cell.height, down); y++) {
          cell.rgb.copy(page, ((top + y) * width + left) * 3, y * cell.width * 3, (y * cell.width + Math.min(cell.width, across)) * 3);
        }
      });
      const whole = join(work, 'page.png');
      writeFileSync(whole, encodePng(width, height, page));
      const file = join(directory, `sheet-${String(pages.length + 1).padStart(2, '0')}.jpg`);
      run('ffmpeg', ['-v', 'error', '-y', '-i', whole, '-frames:v', '1', '-q:v', '3', file]);
      pages.push(file);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return pages;
}

