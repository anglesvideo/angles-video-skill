// Runs ffmpeg and ffprobe for the other scripts: the system build when one is
// installed, otherwise the build that ships inside Remotion — so a workspace
// needs nothing beyond `npm install`.
//
// Remotion's build is a small one. It measures, cuts, scales, encodes and
// normalises loudness, which is everything these scripts ask of it, but it has
// no scene-detection or tiling filters; reach for a system ffmpeg for those.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

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
 * Calls the Angles audio API with the account's key. Returns the parsed reply;
 * throws with the server's own message when it refuses.
 */
export async function angles(method, path, body) {
  const key = process.env.ANGLES_API_KEY;
  if (!key) throw new Error('ANGLES_API_KEY is not set.');
  const base = (process.env.ANGLES_API_BASE_URL || 'https://api.angles.video/api/developer/v1').replace(/\/+$/, '');
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
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
