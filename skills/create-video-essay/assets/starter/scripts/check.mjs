#!/usr/bin/env node
// Checks an episode's words against what they rest on: before anything is
// voiced, and again before it is rendered.
//
//   node scripts/check.mjs src/ep01.script.json
//
// It reads src/ep01.facts.json beside the script, and the copies of sources
// that scripts/read.mjs kept under research/. What has to be fixed is listed
// first and makes it exit 1; what only needs a look is listed after.
//
// It can tell that a quotation is not in the source it names. It cannot tell
// whether a sentence is true — that is still read by you, and by the user.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const WIDE = /[぀-ヿ㐀-鿿가-힯]/g;
const SPOKEN_LIMIT = 400;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const list = value => (Array.isArray(value) ? value : value ? [value] : []);
const squash = text => String(text).replace(/\s+/g, '');
const short = text => (text.length > 22 ? `${text.slice(0, 22)}…` : text);

/** Whether `quote` is in `text` as written; an ellipsis may skip words, in order. */
function holds(text, quote) {
  let from = 0;
  for (const part of squash(quote).split(/…+|\.{3,}/).filter(Boolean)) {
    const at = text.indexOf(part, from);
    if (at < 0) return false;
    from = at + part.length;
  }
  return true;
}

function tooLong(text) {
  const wide = (text.match(WIDE) || []).length;
  const words = text.replace(WIDE, ' ').split(/\s+/).filter(word => /\w/.test(word)).length;
  return wide > 40 || words > 25 || wide / 40 + words / 25 > 1.15;
}

const scriptPath = process.argv.slice(2).find(arg => !arg.startsWith('--'));
if (!scriptPath || !scriptPath.endsWith('.script.json')) fail('usage: node scripts/check.mjs src/<video>.script.json');
if (!existsSync(scriptPath)) fail(`No script at ${scriptPath}.`);
const name = basename(scriptPath, '.script.json');
const factsPath = join(dirname(scriptPath), `${name}.facts.json`);
if (!existsSync(factsPath)) fail(`No facts at ${factsPath}. The facts file comes before the script.`);

const script = JSON.parse(readFileSync(scriptPath, 'utf8'));
const book = JSON.parse(readFileSync(factsPath, 'utf8'));
const lines = script.lines ?? [];
const facts = book.facts ?? [];
const sources = book.sources ?? [];
const factOf = new Map(facts.map(fact => [fact.id, fact]));
const sourceIds = new Set(sources.map(source => source.id));

const fix = [];
const look = [];

for (const [kind, entries] of [['fact', facts], ['source', sources]]) {
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.id) fix.push(`A ${kind} has no id: ${short(JSON.stringify(entry))}`);
    else if (seen.has(entry.id)) fix.push(`${kind} id ${entry.id} is used twice`);
    seen.add(entry.id);
  }
}

// Facts and the sources under them.
const snapshots = new Map();
const snapshotOf = id => {
  if (!snapshots.has(id)) {
    const file = join('research', `${id}.txt`);
    snapshots.set(id, existsSync(file) ? squash(readFileSync(file, 'utf8')) : null);
  }
  return snapshots.get(id);
};
const unchecked = [];
for (const fact of facts) {
  const under = list(fact.sources);
  if (under.length === 0) fix.push(`${fact.id} names no source`);
  for (const id of under) if (!sourceIds.has(id)) fix.push(`${fact.id} names source ${id}, which is not in ${factsPath}`);
  if (fact.kind !== 'quote') continue;
  const copies = under.map(snapshotOf).filter(Boolean);
  if (copies.length === 0) unchecked.push(fact.id);
  else if (!copies.some(copy => holds(copy, fact.text))) {
    fix.push(`${fact.id} is a quotation, and its words are not in research/${under.filter(snapshotOf).join('.txt, research/')}.txt as written: "${short(fact.text)}"`);
  }
}

// The script.
const used = new Map();
const bare = [];
const long = [];
const chapterIds = (script.chapters ?? []).map(chapter => chapter.id);
lines.forEach((line, index) => {
  for (const id of list(line.facts)) {
    if (!factOf.has(id)) fix.push(`${line.id} names fact ${id}, which is not in ${factsPath}`);
    else used.set(id, [...(used.get(id) ?? []), line.id]);
  }
  if (list(line.facts).length === 0) bare.push(`${line.id} "${short(line.text)}"`);
  const spoken = line.say ?? line.text;
  if ([...spoken].length > SPOKEN_LIMIT) fix.push(`${line.id} is ${[...spoken].length} characters; a voiced line may be ${SPOKEN_LIMIT} at most`);
  else if (tooLong(line.text)) long.push(line.id);
  if (chapterIds.length) {
    const chapter = chapterIds.find(id => line.id.startsWith(id));
    if (!chapter) fix.push(`${line.id} belongs to no chapter: its id starts with none of ${chapterIds.join(', ')}`);
    const first = chapter && lines.findIndex(other => other.id.startsWith(chapter)) === index;
    if (first && index > 0 && !(line.pause >= 1)) look.push(`${line.id} opens a chapter with no room for its card: give it a "pause" of a second or more`);
  }
});

// What is printed in the picture.
for (const [key, entry] of Object.entries(book.screen ?? {})) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
  const fact = factOf.get(entry.fact);
  if (!entry.fact) fix.push(`screen.${key} names no fact`);
  else if (!fact) fix.push(`screen.${key} names fact ${entry.fact}, which is not in ${factsPath}`);
  else {
    used.set(fact.id, [...(used.get(fact.id) ?? []), `screen.${key}`]);
    if (fact.kind === 'quote' && typeof entry.value === 'string' && !holds(squash(fact.text), entry.value)) {
      fix.push(`screen.${key} shows words that are not in the quotation ${fact.id}: "${short(entry.value)}"`);
    }
  }
}

// Pictures.
for (const image of book.images ?? []) {
  if (!image.licence) fix.push(`Image ${image.file} has no licence recorded`);
  if (image.file && !existsSync(join('public', image.file))) fix.push(`Image ${image.file} is not in public/`);
}

const usedBy = id => [...new Set(used.get(id))].join(', ');
if (bare.length) look.push(`No facts under — transitions, or inventions? ${bare.join(' · ')}`);
const single = facts.filter(fact => used.has(fact.id) && list(fact.sources).length === 1).map(fact => `${fact.id} (${usedBy(fact.id)})`);
if (single.length) look.push(`Rest on one source — tell the user: ${single.join(' · ')}`);
const readings = facts
  .filter(fact => used.has(fact.id) && (fact.standing === 'disputed' || fact.standing === 'interpretation'))
  .map(fact => `${fact.id} ${fact.standing} (${usedBy(fact.id)})`);
if (readings.length) look.push(`Readings, not records — is each worded as one? ${readings.join(' · ')}`);
if (unchecked.length) look.push(`Quotations with no copy of their source under research/ to check against: ${unchecked.join(', ')}`);
if (long.length) look.push(`Long for one line: ${long.join(', ')}`);

process.stdout.write(`${name}: ${lines.length} lines, ${facts.length} facts, ${sources.length} sources\n`);
if (fix.length) process.stdout.write(`\nMust fix (${fix.length}):\n${fix.map(item => `  ${item}`).join('\n')}\n`);
if (look.length) process.stdout.write(`\nLook at (${look.length}):\n${look.map(item => `  ${item}`).join('\n')}\n`);
if (!fix.length && !look.length) process.stdout.write('Nothing to fix.\n');
process.exit(fix.length ? 1 : 0);
