#!/usr/bin/env node
// Voices a video's script — one sound file per line — and writes the measured
// timeline every picture is cut to.
//
//   node scripts/voice.mjs src/ep01.script.json
//   node scripts/voice.mjs src/ep01.script.json --redo l03,l07
//   node scripts/voice.mjs --providers
//
// The script names where the voice comes from:
//
//   "voice": { "provider": "angles", "language": "en" }
//       synthesised through the user's Angles account (ANGLES_API_KEY), one
//       request per line, into public/voice/<video>/<line>.mp3
//   "voice": { "provider": "elevenlabs" | "openai" | "minimax", "id": "<voice>", "model": "<model>" }
//       the same, with a provider key of the user's own
//   "voice": { "provider": "recorded" }
//       files the person recorded, at public/takes/<video>/<line>.<ext> —
//       sound only, or a camera take with picture and sound in one file
//   "voice": { "provider": "none" }
//       no sound; each line is given the time it takes to read its caption
//
// Timing is data, not code: `pause` on a line is the silence before it, `gap`
// is the default pause, `tail` is the hold after the last line. Change them
// and run this again — lines that have not changed are measured, not re-made.
//
// Name a track and the video is cut to it:
//
//   "music": { "src": "music/track.mp3" }
//       every cut after the first is moved, by lengthening the pause before
//       it, onto a beat of the track; so is the end of the video
//   "music": { "src": "music/track.mp3", "lift": "l06" }
//       also starts the track at the point that puts its biggest lift on the
//       cut into line l06 ("liftAt": <seconds> names a different lift)
//   "offset": <seconds> starts the track part-way in; "snap": false leaves
//   the cuts where the pauses put them
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { angles, durationOf, streamsOf } from './media.mjs';
import { CLEAR_PULSE, analyse } from './music.mjs';

const PROVIDERS = {
  angles: {
    key: 'ANGLES_API_KEY',
    // Left out, Angles uses its default voice for the script's language.
    voice: null,
    model: null,
    async speak(text, { id, language }) {
      const reply = await angles('POST', '/audio/voice', {
        text,
        ...(id ? { voice: id } : {}),
        ...(language ? { language } : {}),
      });
      const bytes = Buffer.from(reply?.audio ?? '', 'base64');
      if (!bytes.length) throw new Error('Angles returned no audio');
      // Angles falls back to a second voice provider when its first fails;
      // `speaker` is how a line spoken by the wrong one gets noticed.
      return { bytes, speaker: reply.provider };
    },
  },
  elevenlabs: {
    key: 'ELEVENLABS_API_KEY',
    voice: 'JBFqnCBsd6RMkjVDRZzb',
    model: 'eleven_multilingual_v2',
    async speak(text, { id, model }, key) {
      const base = process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io';
      const response = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: model }),
      });
      return audioBody(response);
    },
  },
  openai: {
    key: 'OPENAI_API_KEY',
    voice: 'alloy',
    model: 'gpt-4o-mini-tts',
    async speak(text, { id, model, instructions }, key) {
      const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      const response = await fetch(`${base}/audio/speech`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          voice: id,
          input: text,
          response_format: 'mp3',
          ...(instructions ? { instructions } : {}),
        }),
      });
      return audioBody(response);
    },
  },
  minimax: {
    key: 'MINIMAX_API_KEY',
    voice: 'English_magnetic_voiced_man',
    model: 'speech-02-hd',
    async speak(text, { id, model }, key) {
      const base = process.env.MINIMAX_BASE_URL || 'https://api.minimax.io';
      const response = await fetch(`${base}/v1/t2a_v2`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          text,
          stream: false,
          voice_setting: { voice_id: id, speed: 1, vol: 1, pitch: 0 },
          audio_setting: { sample_rate: 44100, bitrate: 128000, format: 'mp3', channel: 1 },
        }),
      });
      const body = await response.json().catch(() => null);
      if (body?.base_resp?.status_code !== 0 || !body?.data?.audio) {
        throw new Error(body?.base_resp?.status_msg || `HTTP ${response.status}`);
      }
      return Buffer.from(body.data.audio, 'hex');
    },
  },
};

const SOUND_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac'];
const TAKE_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv'];

async function audioBody(response) {
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`HTTP ${response.status} ${detail}`.trim());
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('the provider returned an empty file');
  return bytes;
}

/** Time to read a caption, for a line with no sound: about 155 words a minute. */
function readingSeconds(text) {
  const wide = /[぀-ヿ㐀-鿿가-힯]/g;
  const characters = (text.match(wide) || []).length;
  const words = text.replace(wide, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1.5, round(words / 2.6 + characters / 4.5 + 0.4));
}

const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * Lays the measured lines end to end. With a `grid` — the moments, in video
 * time, where the music has a beat — each cut after the first waits for the
 * next one, and so does the end of the video.
 */
function layOut(lines, { gap, tail, cutLead, grid }) {
  const nextOnGrid = moment => grid?.find(point => point >= moment - 0.04);
  let cursor = 0;
  const clips = lines.map(({ pause, ...clip }, index) => {
    let at = cursor + (pause ?? gap);
    if (index > 0) {
      const beat = nextOnGrid(at - cutLead);
      if (beat !== undefined) at = beat + cutLead;
    }
    at = round(at);
    cursor = at + clip.seconds;
    return { ...clip, at };
  });
  return { clips, totalSeconds: round(nextOnGrid(cursor + tail) ?? cursor + tail) };
}

/** Where cuts may land, in seconds of the track. */
function gridOf(analysis) {
  const beats = analysis.beats;
  // On a slow track a whole beat is a long wait; the half-beat still reads as in time.
  const halves = 60 / analysis.bpm > 0.6;
  const points = [];
  beats.forEach((beat, index) => {
    points.push(beat);
    if (halves && index + 1 < beats.length) points.push((beat + beats[index + 1]) / 2);
  });
  return points;
}

/** Fits the lines to the track the script names. */
function cutToMusic(script, lines, timing, notes) {
  const { src, lift, liftAt, snap } = script.music;
  const file = join('public', src);
  if (!existsSync(file)) fail(`No music at ${file}. "music.src" is a path under public/.`);
  const analysis = analyse(file);
  if (analysis.pulse < CLEAR_PULSE) {
    notes.push(`${src} has no clear beat (pulse ${analysis.pulse}). Cuts are still moved onto its grid, but will not feel timed to it.`);
  }
  const points = gridOf(analysis);
  const place = offset =>
    layOut(lines, {
      ...timing,
      grid: snap === false ? null : points.map(point => round(point - offset)).filter(point => point >= 0),
    });

  let offset = script.music.offset ?? 0;
  if (lift) {
    const index = lines.findIndex(line => line.id === lift);
    if (index < 0) fail(`"music.lift" names line "${lift}", which is not in the script.`);
    const target = liftAt ?? analysis.lifts[0]?.at;
    if (target === undefined) {
      notes.push(`${src} never gets clearly louder, so there is no lift to put on ${lift}. Run scripts/music.mjs on it to see its shape.`);
    } else {
      // Starting the track later slides its beats under the video. Begin on a
      // beat, so the first frame is on one too; from there, moving the start by
      // whole beats leaves the cuts where they are, and this settles in a pass or two.
      const cutOf = layout => (index === 0 ? 0 : layout.clips[index].at - timing.cutLead);
      const rough = target - cutOf(layOut(lines, { ...timing, grid: null }));
      offset = points.reduce((best, point) => (Math.abs(point - rough) < Math.abs(best - rough) ? point : best), points[0] ?? rough);
      if (rough < 0) offset = rough;
      for (let pass = 0; pass < 6 && offset >= 0; pass++) {
        const next = target - cutOf(place(offset));
        if (Math.abs(next - offset) < 0.02) break;
        offset = next;
      }
      if (offset < 0) {
        notes.push(`The lift at ${target}s of ${src} comes before the video reaches ${lift}. The track starts from its beginning instead; choose a later lift with "liftAt", or an earlier line.`);
        offset = script.music.offset ?? 0;
      }
    }
  }

  offset = round(Math.max(0, offset));
  const layout = place(offset);
  if (offset + layout.totalSeconds > analysis.seconds) {
    notes.push(`${src} ends ${round(offset + layout.totalSeconds - analysis.seconds, 1)}s before the video does. Start it earlier, loop it, or use a longer track.`);
  }
  return {
    ...layout,
    music: {
      src,
      offset,
      bpm: analysis.bpm,
      beats: analysis.beats.map(beat => round(beat - offset)).filter(beat => beat >= 0 && beat <= layout.totalSeconds),
    },
  };
}

function listProviders() {
  for (const [name, provider] of Object.entries(PROVIDERS)) {
    const present = process.env[provider.key] ? 'set' : 'not set';
    process.stdout.write(`${name.padEnd(11)} ${provider.key} is ${present}\n`);
  }
  process.stdout.write('recorded    the person records each line themselves\n');
  process.stdout.write('none        no voice; captions carry the words\n');
}

function findRecording(directory, id) {
  if (!existsSync(directory)) return null;
  const match = readdirSync(directory).find(file => {
    const extension = extname(file).toLowerCase();
    return (
      basename(file, extname(file)) === id &&
      (SOUND_EXTENSIONS.includes(extension) || TAKE_EXTENSIONS.includes(extension))
    );
  });
  return match ? join(directory, match) : null;
}

function readScript(scriptPath) {
  if (!existsSync(scriptPath)) fail(`No script at ${scriptPath}.`);
  const script = JSON.parse(readFileSync(scriptPath, 'utf8'));
  if (!Array.isArray(script.lines) || script.lines.length === 0) fail(`${scriptPath} has no "lines".`);
  const seen = new Set();
  for (const line of script.lines) {
    if (!line.id || typeof line.text !== 'string' || !line.text.trim()) {
      fail(`Every line needs an "id" and a "text": ${JSON.stringify(line)}`);
    }
    if (!/^[A-Za-z0-9_-]+$/.test(line.id)) fail(`Line id "${line.id}" becomes a file name; use letters, digits, - and _.`);
    if (seen.has(line.id)) fail(`Line id "${line.id}" is used twice.`);
    seen.add(line.id);
  }
  return script;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--providers')) return listProviders();

  const scriptPath = args.find(arg => !arg.startsWith('--'));
  if (!scriptPath || !scriptPath.endsWith('.script.json')) {
    fail('usage: node scripts/voice.mjs src/<video>.script.json [--redo <line,line> | --force]\n       node scripts/voice.mjs --providers');
  }
  const redoFlag = args.indexOf('--redo');
  const redo = new Set(redoFlag >= 0 ? (args[redoFlag + 1] || '').split(',').filter(Boolean) : []);
  const force = args.includes('--force');

  const script = readScript(scriptPath);
  const name = basename(scriptPath, '.script.json');
  const manifestPath = join(dirname(scriptPath), `${name}.audio.json`);
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  const previousClip = id => previous?.clips?.find(clip => clip.id === id);

  const providerName = script.voice?.provider;
  if (!providerName) {
    fail(
      `${scriptPath} does not say where the voice comes from. Set "voice": { "provider": … } to one of: ${[
        ...Object.keys(PROVIDERS),
        'recorded',
        'none',
      ].join(', ')}. Run with --providers to see which keys are set.`
    );
  }
  const provider = PROVIDERS[providerName];
  if (!provider && providerName !== 'recorded' && providerName !== 'none') {
    fail(`Unknown voice provider "${providerName}".`);
  }

  const voice = provider
    ? {
        id: script.voice.id || provider.voice,
        model: script.voice.model || provider.model,
        ...(script.voice.language ? { language: script.voice.language } : {}),
        ...(script.voice.instructions ? { instructions: script.voice.instructions } : {}),
      }
    : null;
  const sameVoice =
    previous?.provider === providerName && JSON.stringify(previous?.voice ?? null) === JSON.stringify(voice);
  const key = provider ? process.env[provider.key] : null;

  const notes = [];
  const measured = [];
  for (const line of script.lines) {
    const before = previousClip(line.id);
    let file = null;
    let kind = 'silent';
    let speaker = before?.speaker;

    if (provider) {
      const directory = join('public', 'voice', name);
      file = join(directory, `${line.id}.mp3`);
      const reusable =
        existsSync(file) && !force && !redo.has(line.id) && (!before || (before.text === line.text && sameVoice));
      if (!reusable) {
        if (!key) fail(`${provider.key} is not set, and ${line.id} has not been voiced yet.`);
        mkdirSync(directory, { recursive: true });
        try {
          const spoken = await provider.speak(line.text, voice, key);
          writeFileSync(file, Buffer.isBuffer(spoken) ? spoken : spoken.bytes);
          speaker = Buffer.isBuffer(spoken) ? undefined : spoken.speaker;
        } catch (error) {
          fail(`${providerName} could not voice ${line.id}: ${error.message}`);
        }
      }
      kind = 'audio';
    } else if (providerName === 'recorded') {
      file = findRecording(join('public', 'takes', name), line.id);
      if (!file) {
        notes.push(`${line.id} is not recorded yet — timed as a silent line for now.`);
      } else {
        const isTake = TAKE_EXTENSIONS.includes(extname(file).toLowerCase());
        const streams = streamsOf(file);
        if (!streams.includes('audio')) fail(`${file} has no sound. Record ${line.id} again with the microphone on.`);
        kind = isTake && streams.includes('video') ? 'video' : 'audio';
        if (before?.src && before.text !== line.text) {
          notes.push(`${line.id} was reworded after it was recorded — the recording still says the old line.`);
        }
      }
    }

    const seconds = file ? round(durationOf(file)) : readingSeconds(line.text);
    measured.push({
      id: line.id,
      text: line.text,
      src: file ? file.split(/[\\/]/).slice(1).join('/') : null,
      kind: file ? kind : 'silent',
      seconds,
      ...(provider && speaker ? { speaker } : {}),
      pause: line.pause,
    });
  }

  // One video, one voice: a line spoken by a fallback provider stands out.
  const speakers = [...new Set(measured.map(clip => clip.speaker).filter(Boolean))];
  if (speakers.length > 1) {
    const usual = speakers
      .map(name => ({ name, lines: measured.filter(clip => clip.speaker === name) }))
      .sort((a, b) => b.lines.length - a.lines.length);
    const odd = usual.slice(1).flatMap(group => group.lines.map(clip => clip.id));
    notes.push(
      `${odd.join(', ')} ${odd.length === 1 ? 'was' : 'were'} spoken by a different voice provider than the rest (${usual[0].name}). Voice ${odd.length === 1 ? 'it' : 'them'} again: --redo ${odd.join(',')}`
    );
  }

  // `cutLead` is how long before a line is spoken its picture takes over.
  const timing = { gap: script.gap ?? 0.35, tail: script.tail ?? 2, cutLead: script.cutLead ?? 0.2 };
  const { clips, totalSeconds, music = null } = script.music?.src
    ? cutToMusic(script, measured, timing, notes)
    : layOut(measured, { ...timing, grid: null });

  writeFileSync(
    manifestPath,
    `${JSON.stringify({ provider: providerName, voice, totalSeconds, cutLead: timing.cutLead, music, clips }, null, 2)}\n`
  );

  for (const clip of clips) {
    process.stdout.write(
      `${clip.id.padEnd(6)} @${clip.at.toFixed(2).padStart(6)}s  ${clip.seconds.toFixed(2).padStart(5)}s  ${clip.kind.padEnd(6)}  ${clip.text}\n`
    );
  }
  process.stdout.write(`total ${totalSeconds.toFixed(1)}s -> ${manifestPath}\n`);
  if (music) {
    process.stdout.write(
      `music ${music.src}: ${music.bpm} BPM, starts ${music.offset.toFixed(2)}s into the track, ${music.beats.length} beats under the video\n`
    );
  }
  for (const note of notes) process.stdout.write(`note: ${note}\n`);
}

main().catch(error => fail(error.message));
