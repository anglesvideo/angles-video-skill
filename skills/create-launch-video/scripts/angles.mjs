#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const DEFAULT_BASE_URL = 'https://api.angles.video/api/developer/v1';

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
    flags[name] = next;
    index += 1;
  }
  return { command, flags };
}

function requireString(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required --${name} value.`);
  }
  return value.trim();
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
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text || `Angles returned HTTP ${response.status}.` };
  }
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    const error = new Error(message || `Angles returned HTTP ${response.status}.`);
    error.status = response.status;
    error.code = body.code;
    error.details = body;
    throw error;
  }
  return body;
}

function stableRenderKey(videoId, templateId) {
  return `skill-${createHash('sha256')
    .update(`${videoId}:${templateId}`)
    .digest('hex')
    .slice(0, 40)}`;
}

function usage() {
  return [
    'Usage:',
    '  angles.mjs concepts --input <file|->',
    '  angles.mjs templates [--video <video-id>]',
    '  angles.mjs render --video <video-id> --template <template-id> --confirm [--idempotency-key <key>]',
    '  angles.mjs status --video <video-id>',
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
  } else if (command === 'render') {
    const videoId = requireString(flags, 'video');
    const templateId = requireString(flags, 'template');
    if (flags.confirm !== true) {
      throw new Error('Rendering consumes an Angles video allowance. Re-run with --confirm.');
    }
    const idempotencyKey =
      typeof flags['idempotency-key'] === 'string'
        ? flags['idempotency-key']
        : stableRenderKey(videoId, templateId);
    result = await request(`/videos/${encodeURIComponent(videoId)}/render`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ templateId, confirmed: true }),
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
  };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = 1;
});
