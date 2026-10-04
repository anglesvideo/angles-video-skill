#!/usr/bin/env node
// Makes candidate tracks for the audio library with Suno, through Evolink, and
// lays them out for a person to listen to and choose from.
//
//   node tools/audio-library/generate.mjs <source-dir> --dry-run
//       what would be made, and what it would cost
//   node tools/audio-library/generate.mjs <source-dir> [--only <id,id>] [--parallel 3]
//       one generation per track in the manifest that has neither candidates
//       nor a chosen file yet. Each returns two takes, saved and measured as
//       <source-dir>/candidates/music/<id>-a and <id>-b. Needs EVOLINK_API_KEY.
//       This spends credits: one flat-priced call per track.
//   node tools/audio-library/generate.mjs <source-dir> --pick calm-keys-01=a,warm-piano-01=b
//       copies the chosen takes to <source-dir>/music/, where build.mjs reads them
//   node tools/audio-library/generate.mjs <source-dir> --keep-all
//       keeps every take, each as a track of its own: <id>-a, <id>-b
//
// Every run rewrites <source-dir>/candidates/review.html: each take with a
// player and its measurements, to listen through and pick from. A generation
// that was started is never started again — its task is recorded the moment it
// is accepted, and a later run picks it back up — so an interrupted run costs
// nothing twice. --redo <id,id> asks for new takes on purpose.
//
// Sound effects are not made here: Suno makes music, not half-second sounds.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { soundFormatOf } from '../../src/starter/scripts/media.mjs';
import { CLEAR_PULSE, analyse } from '../../src/starter/scripts/music.mjs';

/** What Evolink quoted for one Suno generation when this was written (6.7 credits); it returns two takes. */
const PRICE_PER_GENERATION = 0.1;
const SOUND_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.aiff'];
const TAKES = 'abcdefgh';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const list = value => (value ? value.split(',').map(item => item.trim()).filter(Boolean) : []);
const wait = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000));

async function evolink(method, path, body) {
  const base = (process.env.EVOLINK_BASE_URL || 'https://api.evolink.ai').replace(/\/+$/, '');
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.EVOLINK_API_KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const reply = await response.json().catch(() => null);
  if (!response.ok || reply?.error) {
    throw new Error(`HTTP ${response.status} ${reply?.error?.message ?? JSON.stringify(reply ?? '').slice(0, 300)}`);
  }
  return reply;
}

/** The audio links of a finished task: Suno answers with song objects, other models with bare links. */
function linksOf(task) {
  const isLink = value => typeof value === 'string' && /^https?:\/\//i.test(value);
  const songs = (Array.isArray(task.result_data) ? task.result_data : [])
    .map(song => song?.audio_url ?? song?.url)
    .filter(isLink);
  if (songs.length) return songs;
  const links = (Array.isArray(task.results) ? task.results : []).filter(isLink);
  const audio = links.filter(link => /\.(mp3|wav|m4a|ogg|flac)(\?|$)/i.test(link));
  return audio.length ? audio : links;
}

/** A file already chosen for an entry: `<id>` itself, or one of its takes kept as `<id>-a`, `<id>-b`. */
function chosenFile(source, id) {
  const directory = join(source, 'music');
  if (!existsSync(directory)) return null;
  const file = readdirSync(directory).find(name => {
    const base = basename(name, extname(name));
    const isTake = base.startsWith(`${id}-`) && /^[a-z]$/.test(base.slice(id.length + 1));
    return (base === id || isTake) && SOUND_EXTENSIONS.includes(extname(name).toLowerCase());
  });
  return file ? join(directory, file) : null;
}

const escape = text => String(text).replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);

function concernsOf(take) {
  return [
    ...(take.pulse < CLEAR_PULSE ? ['no clear beat'] : []),
    ...(take.lifts.length ? [] : ['never lifts']),
    ...(take.seconds < 60 ? ['short'] : []),
  ];
}

/** A page to listen through: every take with a player, what was measured, and a choice. */
function reviewPage(manifest, state, source) {
  const bars = levels => levels.map(level => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(level * 8))]).join('');
  const sections = manifest.music
    .map(entry => {
      const made = state.music[entry.id];
      const chosen = chosenFile(source, entry.id);
      const takes = (made?.takes ?? [])
        .map(take => {
          const concerns = concernsOf(take);
          return `
        <label class="take">
          <input type="radio" name="${escape(entry.id)}" value="${take.take}">
          <span class="name">${escape(entry.id)}-${take.take}</span>
          <audio controls preload="none" src="music/${escape(basename(take.file))}"></audio>
          <span class="numbers">${Math.round(take.seconds)}s · ${take.bpm} BPM · beat ${take.pulse} · lifts at ${take.lifts.map(lift => `${lift.at}s`).join(', ') || '—'}</span>
          <span class="energy">${bars(take.energy)}</span>
          ${concerns.length ? `<span class="concern">${escape(concerns.join(' · '))}</span>` : ''}
        </label>`;
        })
        .join('');
      const status = made?.status === 'failed' ? `<p class="concern">Failed: ${escape(made.error ?? '')}</p>` : !made ? '<p class="quiet">Not generated yet.</p>' : made.status === 'pending' ? '<p class="quiet">Still generating — run the command again.</p>' : '';
      return `
      <section>
        <h2>${escape(entry.id)} <small>${escape((entry.mood ?? []).join(', '))}</small>${chosen ? ' <em>chosen</em>' : ''}</h2>
        <p>${escape(entry.description)}</p>${status}${takes}
        ${takes ? `<label class="take none"><input type="radio" name="${escape(entry.id)}" value=""> neither — make it again</label>` : ''}
      </section>`;
    })
    .join('');

  return `<!doctype html>
<meta charset="utf-8">
<title>Audio library — candidates</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 980px; margin: 32px auto; padding: 0 16px 160px; color: #1b1b18; background: #faf9f6; }
  h1 { font-size: 22px; } h2 { font-size: 17px; margin: 28px 0 2px; } h2 small { font-weight: 400; color: #77756c; } h2 em { font-style: normal; font-size: 12px; background: #1b1b18; color: #fff; padding: 2px 8px; border-radius: 10px; }
  section { border-top: 1px solid #dedbd2; } p { margin: 2px 0 8px; color: #55534c; }
  .take { display: grid; grid-template-columns: 20px 150px 300px 1fr; gap: 4px 12px; align-items: center; padding: 6px 0; }
  .take .numbers, .take .energy, .take .concern { grid-column: 3 / -1; font-size: 13px; color: #55534c; }
  .take .energy { font-family: ui-monospace, monospace; letter-spacing: 1px; } .take.none { display: block; color: #77756c; }
  .concern { color: #b3401f !important; } .quiet { color: #99968c; } audio { width: 300px; height: 32px; }
  @media (max-width: 760px) {
    .take { grid-template-columns: 20px 1fr; }
    .take audio { grid-column: 2; width: 100%; }
    .take .numbers, .take .energy, .take .concern { grid-column: 2; }
    .take .energy { overflow: hidden; }
  }
  footer { position: fixed; left: 0; right: 0; bottom: 0; background: #1b1b18; color: #faf9f6; padding: 12px 20px; }
  footer code { display: block; white-space: pre-wrap; word-break: break-all; font-size: 13px; margin-top: 6px; color: #d8d5cb; } button { font: inherit; margin-left: 12px; }
</style>
<h1>Audio library — candidates</h1>
<p>Listen to each take and pick the one to keep. The numbers say whether a video can be cut to it; only you can say whether it sounds good. "energy" is one mark every four seconds.</p>
${sections}
<footer>
  <span id="count">Nothing picked yet.</span><button id="copy">Copy</button>
  <code id="picks"></code>
</footer>
<script>
  const update = () => {
    const picked = [], again = [];
    for (const input of document.querySelectorAll('input[type=radio]:checked')) (input.value ? picked : again).push(input.value ? input.name + '=' + input.value : input.name);
    document.getElementById('count').textContent = picked.length + ' picked, ' + again.length + ' to make again.';
    document.getElementById('picks').textContent = (picked.length ? '--pick ' + picked.join(',') : '') + (again.length ? '  --redo ' + again.join(',') : '');
  };
  document.addEventListener('change', update);
  document.getElementById('copy').addEventListener('click', () => navigator.clipboard.writeText(document.getElementById('picks').textContent));
</script>
`;
}

const args = process.argv.slice(2);
const source = args.find((arg, index) => !arg.startsWith('--') && !(args[index - 1] || '').startsWith('--'));
if (!source) fail('usage: node tools/audio-library/generate.mjs <source-dir> [--dry-run] [--only <id,id>] [--redo <id,id>] [--pick <id=take,…> | --keep-all]');

const manifest = JSON.parse(readFileSync(option(args, '--manifest', fileURLToPath(new URL('./library.json', import.meta.url))), 'utf8'));
const candidates = join(source, 'candidates');
const statePath = join(candidates, 'state.json');
mkdirSync(join(candidates, 'music'), { recursive: true });
mkdirSync(join(source, 'music'), { recursive: true });
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { music: {} };
const save = () => {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(join(candidates, 'review.html'), reviewPage(manifest, state, source));
};

const picks = list(option(args, '--pick'));
for (const pick of picks) {
  const [id, take] = pick.split('=');
  const chosen = state.music[id]?.takes?.find(candidate => candidate.take === take);
  if (!chosen) fail(`There is no take "${take}" of "${id}" to pick.`);
  const target = join(source, 'music', `${id}${extname(chosen.file)}`);
  copyFileSync(chosen.file, target);
  process.stdout.write(`picked ${id}-${take} -> ${target}\n`);
}

if (args.includes('--keep-all')) {
  for (const [id, made] of Object.entries(state.music)) {
    for (const take of made.status === 'ready' ? made.takes : []) {
      copyFileSync(take.file, join(source, 'music', `${id}-${take.take}${extname(take.file)}`));
      picks.push(`${id}=${take.take}`);
    }
  }
  process.stdout.write(`kept all ${picks.length} takes in ${join(source, 'music')}\n`);
}

const redo = new Set(list(option(args, '--redo')));
const only = new Set(list(option(args, '--only')));
const wanted = manifest.music.filter(entry => {
  if (redo.has(entry.id)) return true;
  if (only.size && !only.has(entry.id)) return false;
  const made = state.music[entry.id];
  if (made?.status === 'pending') return true; // already paid for: collect it
  if (made?.status === 'ready') return false;
  return !chosenFile(source, entry.id);
});
const toStart = wanted.filter(entry => redo.has(entry.id) || state.music[entry.id]?.status !== 'pending');

if (args.includes('--dry-run') || (picks.length && !redo.size && !only.size && !args.includes('--generate'))) {
  if (args.includes('--dry-run')) {
    process.stdout.write(
      `${toStart.length} to generate (${toStart.map(entry => entry.id).join(', ') || 'none'}), ${wanted.length - toStart.length} already started to collect.\n` +
        `At about $${PRICE_PER_GENERATION.toFixed(2)} a generation: $${(toStart.length * PRICE_PER_GENERATION).toFixed(2)}, for ${toStart.length * 2} takes.\n`
    );
  }
  save();
  process.exit(0);
}

if (wanted.length && !process.env.EVOLINK_API_KEY) fail('EVOLINK_API_KEY is not set.');
const model = option(args, '--model', 'suno-v5.5-beta');
const seconds = Number(option(args, '--seconds', 110));

async function make(entry) {
  let made = state.music[entry.id];
  if (redo.has(entry.id) || made?.status !== 'pending') {
    const task = await evolink('POST', '/v1/audios/generations', {
      model,
      custom_mode: true,
      instrumental: true,
      style: entry.prompt.slice(0, 1000),
      negative_tags: 'vocals, singing, choir, spoken word, vocal samples',
      title: entry.id,
      duration: seconds,
    });
    if (!task?.id) throw new Error(`no task id in the reply: ${JSON.stringify(task).slice(0, 200)}`);
    // Written before anything else can go wrong: this generation is now paid for.
    made = state.music[entry.id] = { taskId: task.id, model, status: 'pending', takes: [] };
    save();
    process.stdout.write(`${entry.id}: started (${task.id})\n`);
  }

  const every = Number(process.env.EVOLINK_POLL_SECONDS || 6);
  for (let waited = 0; waited < 900; waited += every) {
    const task = await evolink('GET', `/v1/tasks/${encodeURIComponent(made.taskId)}`);
    if (task.status === 'failed' || task.status === 'cancelled') {
      Object.assign(made, { status: 'failed', error: task.error?.message ?? 'the generation failed' });
      save();
      return process.stdout.write(`${entry.id}: failed — ${made.error}\n`);
    }
    if (task.status === 'completed') {
      const links = linksOf(task);
      if (!links.length) {
        Object.assign(made, { status: 'failed', error: `finished with no audio: ${JSON.stringify(task).slice(0, 300)}` });
        save();
        return process.stdout.write(`${entry.id}: ${made.error}\n`);
      }
      made.takes = [];
      for (const [index, link] of links.entries()) {
        const response = await fetch(link);
        if (!response.ok) throw new Error(`could not download a take of ${entry.id}: HTTP ${response.status}`);
        const draft = join(candidates, 'music', `${entry.id}-${TAKES[index]}.download`);
        writeFileSync(draft, Buffer.from(await response.arrayBuffer()));
        const file = join(candidates, 'music', `${entry.id}-${TAKES[index]}.${soundFormatOf(draft)}`);
        renameSync(draft, file);
        const measured = analyse(file);
        made.takes.push({
          take: TAKES[index],
          file,
          seconds: measured.seconds,
          bpm: measured.bpm,
          pulse: measured.pulse,
          lifts: measured.lifts,
          energy: measured.energy.filter((_, second) => second % 4 === 0),
        });
      }
      made.status = 'ready';
      save();
      for (const take of made.takes) {
        const concerns = concernsOf(take);
        process.stdout.write(
          `${entry.id}-${take.take}: ${Math.round(take.seconds)}s, ${take.bpm} BPM, beat ${take.pulse}, lifts ${take.lifts.map(lift => `${lift.at}s`).join(', ') || 'none'}${concerns.length ? `  [${concerns.join(', ')}]` : ''}\n`
        );
      }
      return undefined;
    }
    await wait(every);
  }
  process.stdout.write(`${entry.id}: still not finished after fifteen minutes; run this again to collect it (task ${made.taskId})\n`);
  return undefined;
}

const queue = [...wanted];
const workers = Array.from({ length: Math.max(1, Number(option(args, '--parallel', 3))) }, async () => {
  for (let entry = queue.shift(); entry; entry = queue.shift()) {
    try {
      await make(entry);
    } catch (error) {
      process.stdout.write(`${entry.id}: ${error.message}\n`);
    }
  }
});
await Promise.all(workers);
save();

const ready = Object.values(state.music).filter(made => made.status === 'ready').length;
process.stdout.write(`\n${ready} of ${manifest.music.length} tracks have takes to listen to: ${join(candidates, 'review.html')}\n`);
