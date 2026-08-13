#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const DEFAULT_BASE_URL = 'https://api.angles.video/api/developer/v1';
const MUSIC_TRACKS = new Map([
  ['raising me higher', 'https://assets.mixkit.co/music/34/34.mp3'],
  ['motivating mornings', 'https://assets.mixkit.co/music/33/33.mp3'],
  ['a blue day', 'https://assets.mixkit.co/music/150/150.mp3'],
]);

const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
/** The types Angles accepts, keyed by the extension it reads them from. */
const UPLOAD_MIME_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
]);

/**
 * What to do about an error the caller cannot fix by changing the request.
 * Gateway failures are the ones worth explaining: the response body is an error
 * page rather than anything from Angles, so nothing else in it says whether
 * trying again is safe or what it would cost.
 */
const GATEWAY_STATUSES = new Set([502, 504, 520, 522, 524]);
const GATEWAY_HINT =
  'Angles did not answer in time. The request may still be completing on the server. ' +
  'Only render spends a video allowance, and a repeated render with the same idempotency key ' +
  'is treated as a retry rather than a second video, so retrying is safe for quota. ' +
  'A repeated concepts request is safe for quota too, but can leave a duplicate project to delete later.';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      flags[name] = true;
      continue;
    }
    // Asset flags are given once per file, so a repeated flag collects rather
    // than overwrites. Anything meant to appear once is rejected when repeated.
    flags[name] = name in flags ? [].concat(flags[name], next) : next;
    index += 1;
  }
  return { command, flags };
}

function requireString(flags, name) {
  const value = flags[name];
  if (Array.isArray(value)) {
    throw new Error(`Provide --${name} once.`);
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required --${name} value.`);
  }
  return value.trim();
}

function assetUrls(flags, name) {
  const value = flags[name];
  if (value === undefined) return undefined;
  return [].concat(value).map(entry => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(`--${name} needs a public HTTPS URL.`);
    }
    let parsed;
    try {
      parsed = new URL(entry.trim());
    } catch {
      throw new Error(`--${name} needs a public HTTPS URL, not "${entry}".`);
    }
    if (parsed.protocol !== 'https:') {
      throw new Error(`--${name} URLs must use HTTPS.`);
    }
    return parsed.toString();
  });
}

/**
 * Media travels in the render settings rather than beside them so it reaches the
 * idempotency key: Angles rejects a key reused with different media, so a retry
 * that corrects a bad clip has to hash to a different key than the one it fixes.
 */
function mediaSettings(flags) {
  const productImages = assetUrls(flags, 'image-asset');
  const productVideos = assetUrls(flags, 'video-asset');
  return {
    ...(productImages ? { productImages } : {}),
    ...(productVideos ? { productVideos: productVideos.map(url => ({ url })) } : {}),
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonInput(flags) {
  const inputPath = typeof flags.input === 'string' ? flags.input : '-';
  const raw = inputPath === '-' ? await readStdin() : await readFile(inputPath, 'utf8');
  if (!raw.trim()) throw new Error('Concept input JSON is empty.');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Concept input is not valid JSON: ${error.message}`);
  }
}

/**
 * Angles reports rejected fields in `details.message` and leaves the top-level
 * `message` as the exception name, so a client that reads only `message` turns
 * every rejected request into the same unhelpful "Bad Request Exception".
 * Validation failures arrive as one sentence per field; other errors as a string.
 */
function errorTextFrom(body) {
  const details = body?.details;
  const candidates = [typeof details === 'string' ? details : details?.message, body?.message];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const lines = candidate.filter(line => typeof line === 'string' && line.trim());
      if (lines.length) return lines.join('; ');
    }
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

function apiConfig() {
  const apiKey = process.env.ANGLES_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'ANGLES_API_KEY is not configured. Create a key in Angles Integrations and set it in your environment.'
    );
  }
  return {
    apiKey,
    baseUrl: (process.env.ANGLES_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
  };
}

async function request(path, options = {}) {
  const { apiKey, baseUrl } = apiConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      // Multipart sets its own content type, boundary included. Naming it here
      // would replace the boundary with nothing and the upload would not parse.
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // A gateway or proxy error page rather than the API. Keep a short excerpt:
    // the full page is unreadable in a terminal and says nothing extra.
    const excerpt = text.trim().slice(0, 200);
    body = {
      message: excerpt
        ? `${excerpt}${text.trim().length > 200 ? '…' : ''}`
        : `Angles returned HTTP ${response.status}.`,
    };
  }
  if (!response.ok) {
    const error = new Error(errorTextFrom(body) || `Angles returned HTTP ${response.status}.`);
    error.status = response.status;
    error.code = body.code;
    error.details = body.details ?? null;
    if (GATEWAY_STATUSES.has(response.status)) error.hint = GATEWAY_HINT;
    throw error;
  }
  return body;
}

function stableRenderKey(videoId, templateId) {
  return stableRenderKeyWithSettings(videoId, templateId, {});
}

function stableRenderKeyWithSettings(videoId, templateId, settings) {
  const suffix = Object.keys(settings).length ? `:${JSON.stringify(settings)}` : '';
  return `skill-${createHash('sha256')
    .update(`${videoId}:${templateId}${suffix}`)
    .digest('hex')
    .slice(0, 40)}`;
}

function renderSettings(flags) {
  const settings = {};
  if (typeof flags.music === 'string') {
    const music = flags.music.trim();
    if (!music) throw new Error('The --music value cannot be empty.');
    const namedTrack = MUSIC_TRACKS.get(music.toLowerCase());
    if (music.toLowerCase() === 'none') {
      settings.backgroundMusicUrl = null;
    } else if (namedTrack) {
      settings.backgroundMusicUrl = namedTrack;
    } else {
      let musicUrl;
      try {
        musicUrl = new URL(music);
      } catch {
        throw new Error('--music must be a bundled track name, an HTTPS audio URL, or none.');
      }
      if (musicUrl.protocol !== 'https:') {
        throw new Error('--music URL must use HTTPS.');
      }
      settings.backgroundMusicUrl = musicUrl.toString();
    }
  }
  if (typeof flags['music-volume'] === 'string') {
    const volume = Number(flags['music-volume']);
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
      throw new Error('--music-volume must be a number from 0 to 1, such as 0.25.');
    }
    settings.backgroundMusicVolume = volume;
  }
  return { ...settings, ...mediaSettings(flags) };
}

/**
 * Reads a local file into a multipart body Angles will accept.
 *
 * Both checks happen before the bytes are sent, because both failures are
 * cheaper to describe than to discover after a 94MB upload: the type is read
 * from the extension the same way Angles reads it, and the size limit is the
 * server's own. Oversized clips are not re-encoded here — that would put ffmpeg
 * between the user and an upload — but the ceiling is worth stating with the one
 * command that gets them under it.
 */
async function uploadBody(path) {
  const extension = extname(path).toLowerCase();
  const mimeType = UPLOAD_MIME_TYPES.get(extension);
  if (!mimeType) {
    throw new Error(
      `Angles does not accept ${extension || 'files without an extension'}. ` +
        `Supported types are ${[...UPLOAD_MIME_TYPES.keys()].join(', ')}.`
    );
  }

  let stats;
  try {
    stats = await stat(path);
  } catch {
    throw new Error(`No file at ${path}.`);
  }
  if (stats.size > UPLOAD_MAX_BYTES) {
    const megabytes = (stats.size / 1024 / 1024).toFixed(1);
    throw new Error(
      `${basename(path)} is ${megabytes}MB and the limit is 50MB. Re-encode it smaller, for ` +
        `example: ffmpeg -i "${path}" -vf scale=-2:1080 -r 30 -c:v libx264 -crf 28 -an out.mp4`
    );
  }

  const form = new FormData();
  form.append('file', new Blob([await readFile(path)], { type: mimeType }), basename(path));
  return form;
}

function usage() {
  return [
    'Usage:',
    '  angles.mjs concepts --input <file|->',
    '  angles.mjs templates [--video <video-id>]',
    '  angles.mjs upload --file <path>',
    '  angles.mjs preview --video <video-id> --template <template-id> [asset and music options]',
    '  angles.mjs render --video <video-id> --template <template-id> --confirm [asset and music options] [--idempotency-key <key>]',
    '  angles.mjs status --video <video-id>',
    '',
    'Asset and music options:',
    '  --video-asset <https-url>   uploaded clip to place in the video (repeat per clip)',
    '  --image-asset <https-url>   uploaded screenshot to place in the video (repeat per image)',
    '  --music <track-name|url|none>',
    '  --music-volume <0-1>',
  ].join('\n');
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  let result;

  if (command === 'concepts') {
    result = await request('/concepts', {
      method: 'POST',
      body: JSON.stringify(await readJsonInput(flags)),
    });
  } else if (command === 'templates') {
    const query = typeof flags.video === 'string'
      ? `?videoId=${encodeURIComponent(flags.video)}`
      : '';
    result = await request(`/templates${query}`);
  } else if (command === 'upload') {
    result = await request('/assets', {
      method: 'POST',
      body: await uploadBody(requireString(flags, 'file')),
    });
  } else if (command === 'preview') {
    const videoId = requireString(flags, 'video');
    const templateId = requireString(flags, 'template');
    result = await request(`/videos/${encodeURIComponent(videoId)}/render/preview`, {
      method: 'POST',
      body: JSON.stringify({ templateId, ...renderSettings(flags) }),
    });
  } else if (command === 'render') {
    const videoId = requireString(flags, 'video');
    const templateId = requireString(flags, 'template');
    if (flags.confirm !== true) {
      throw new Error('Rendering consumes an Angles video allowance. Re-run with --confirm.');
    }
    const settings = renderSettings(flags);
    const idempotencyKey =
      typeof flags['idempotency-key'] === 'string'
        ? flags['idempotency-key']
        : Object.keys(settings).length
          ? stableRenderKeyWithSettings(videoId, templateId, settings)
          : stableRenderKey(videoId, templateId);
    result = await request(`/videos/${encodeURIComponent(videoId)}/render`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ templateId, confirmed: true, ...settings }),
    });
  } else if (command === 'status') {
    const videoId = requireString(flags, 'video');
    result = await request(`/videos/${encodeURIComponent(videoId)}`);
  } else {
    throw new Error(usage());
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => {
  const payload = {
    error: error.message,
    ...(error.status ? { status: error.status } : {}),
    ...(error.code ? { code: error.code } : {}),
    ...(error.hint ? { hint: error.hint } : {}),
    ...(error.details ? { details: error.details } : {}),
  };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = 1;
});
