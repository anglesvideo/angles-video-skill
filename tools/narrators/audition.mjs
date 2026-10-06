#!/usr/bin/env node
// Speaks one sentence in each voice that might be offered as a narrator, and
// lays the results out for a person to listen to. An agent can find a voice id
// in a provider's list; it cannot hear whether the voice is any good, or even
// whether it is the man or the woman its name promises.
//
//   node tools/narrators/audition.mjs [--only zh-CN,en] [--out dist/narrators]
//       the voices in candidates.json: for each language, its own voice first,
//       then each candidate, asked for by its provider voice id
//   node tools/narrators/audition.mjs --offered [--only zh-CN,en]
//       the voices the account already offers (GET /audio/voices), each asked
//       for by name: what a caller gets after a narrator has been added
//
// Needs ANGLES_API_KEY and a system ffmpeg. Every sentence is one voice line
// against the account's daily limit; the count is printed before it starts.
//
// It writes <out>/index.html to listen through, and <out>/results.json: for
// each voice, who spoke it and how high the voice sits. A candidate spoken by
// anything but the first provider was refused by it — the id is wrong.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { angles, samplesOf } from '../../src/starter/scripts/media.mjs';

const RATE = 16000;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/**
 * How high a voice sits: the median pitch of its voiced frames, in Hz. Most
 * men speak below about 155 Hz and most women above about 175; in between,
 * listen.
 *
 * Each frame is compared with itself shifted by every period a voice could
 * have, and the match is scaled by the loudness of both halves — unscaled, a
 * short shift always wins and a deep voice reads an octave too high. Of the
 * shifts that match nearly as well as the best, the shortest is taken, since
 * twice the true period matches just as well and would read an octave too low.
 */
export function pitchOf(samples, rate = RATE) {
  const size = Math.round(rate * 0.06);
  const shortest = Math.floor(rate / 400);
  const longest = Math.ceil(rate / 65);
  const found = [];
  for (let start = 0; start + size + longest < samples.length; start += Math.round(rate * 0.02)) {
    let energy = 0;
    for (let i = 0; i < size; i++) energy += samples[start + i] ** 2;
    if (energy / size < 0.0004) continue;
    const match = new Float64Array(longest + 1);
    let best = 0;
    for (let lag = shortest; lag <= longest; lag++) {
      let sum = 0;
      let shifted = 0;
      for (let i = 0; i < size; i++) {
        sum += samples[start + i] * samples[start + i + lag];
        shifted += samples[start + i + lag] ** 2;
      }
      match[lag] = shifted > 0 ? sum / Math.sqrt(energy * shifted) : 0;
      if (match[lag] > best) best = match[lag];
    }
    if (best < 0.5) continue;
    // The first peak that matches nearly as well as the best one.
    for (let lag = shortest + 1; lag < longest; lag++) {
      if (match[lag] >= 0.9 * best && match[lag] >= match[lag - 1] && match[lag] >= match[lag + 1]) {
        found.push(rate / lag);
        break;
      }
    }
  }
  found.sort((a, b) => a - b);
  return found.length ? Math.round(found[Math.floor(found.length / 2)]) : null;
}

const register = hz => (hz === null ? 'no pitch found' : hz < 155 ? 'low — a man, most likely' : hz > 175 ? 'high — a woman, most likely' : 'in between — listen');
const escape = text => String(text).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

function page(rows, offered) {
  const languages = [...new Set(rows.map(row => row.language))];
  const section = language => {
    const own = rows.filter(row => row.language === language);
    return `<section><h2>${escape(language)}</h2><p class="said">${escape(own[0].text)}</p>${own
      .map(
        row => `<div class="row"><div><b>${escape(row.asked)}</b>${row.note ? ` <i>${escape(row.note)}</i>` : ''}<br><span>${
          row.failed ? `failed: ${escape(row.failed)}` : `spoken by ${escape(row.provider)} · ${row.hz ?? '—'} Hz · ${escape(register(row.hz))}`
        }</span></div>${row.file ? `<audio controls preload="none" src="${escape(row.file)}"></audio>` : ''}</div>`
      )
      .join('')}</section>`;
  };
  return `<!doctype html><meta charset="utf-8"><title>Narrators to listen to</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 20px;color:#1c1a17;background:#faf7f0}
h1{font-size:26px}h2{margin:36px 0 4px;font-size:20px}.said{color:#6f675b;margin:0 0 10px}
.row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:10px 0;border-top:1px solid #e3dccb}
.row span{color:#6f675b;font-size:14px}i{color:#b3361f;font-style:normal;font-size:14px}audio{width:320px;flex:none}</style>
<h1>${offered ? 'The narrators on offer' : 'Narrators to listen to'}</h1>
<p>${
    offered
      ? 'Each voice the account offers, asked for by name.'
      : 'For each language: its own voice first, then the candidates. A candidate not spoken by the first provider was refused by it.'
  }</p>
${languages.map(section).join('\n')}`;
}

async function main() {
  const args = process.argv.slice(2);
  if (!process.env.ANGLES_API_KEY) fail('ANGLES_API_KEY is not set.');
  const offered = args.includes('--offered');
  const only = (option(args, '--only') || '').split(',').filter(Boolean);
  const out = option(args, '--out') || join('dist', 'narrators');
  const book = JSON.parse(readFileSync(fileURLToPath(new URL('./candidates.json', import.meta.url)), 'utf8')).languages;

  const wanted = [];
  if (offered) {
    const { voices } = await angles('GET', '/audio/voices');
    for (const voice of voices) {
      if (!book[voice.language]) continue;
      wanted.push({ language: voice.language, asked: voice.voice, voice: voice.voice, note: `${voice.description ?? ''}${voice.default ? ' · the language\'s own' : ''}`.trim() });
    }
  } else {
    for (const [language, { voices }] of Object.entries(book)) {
      wanted.push({ language, asked: 'the language\'s own', voice: null, note: '' });
      for (const voice of voices) wanted.push({ language, asked: voice, voice, note: '' });
    }
  }
  const lines = wanted.filter(row => !only.length || only.includes(row.language));
  if (!lines.length) fail(`Nothing to speak. Languages here: ${Object.keys(book).join(', ')}.`);
  process.stdout.write(`${lines.length} voice lines against the account's daily limit.\n`);

  mkdirSync(out, { recursive: true });
  const rows = [];
  for (const line of lines) {
    const text = book[line.language].text;
    const row = { language: line.language, asked: line.asked, note: line.note, text };
    try {
      const reply = await angles('POST', '/audio/voice', { text, language: line.language, ...(line.voice ? { voice: line.voice } : {}) });
      const file = `${line.language}--${(line.voice ?? 'own').replace(/[^A-Za-z0-9_-]+/g, '-')}.mp3`;
      writeFileSync(join(out, file), Buffer.from(reply.audio ?? '', 'base64'));
      Object.assign(row, { provider: reply.provider, file, hz: pitchOf(samplesOf(join(out, file), RATE)) });
    } catch (error) {
      row.failed = error.message;
    }
    rows.push(row);
    process.stdout.write(
      `${row.language.padEnd(6)} ${row.asked.padEnd(40)} ${row.failed ? `failed: ${row.failed}` : `${String(row.provider).padEnd(9)} ${String(row.hz ?? '—').padStart(3)} Hz  ${register(row.hz)}`}\n`
    );
  }
  writeFileSync(join(out, 'results.json'), `${JSON.stringify(rows.map(({ text, ...row }) => row), null, 2)}\n`);
  writeFileSync(join(out, 'index.html'), page(rows, offered));
  process.stdout.write(`\nListen: ${join(out, 'index.html')}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch(error => fail(error.message));
}
