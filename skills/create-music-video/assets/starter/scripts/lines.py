#!/usr/bin/env python3
"""Says when each word of a song's lyrics is sung.

  .venv/bin/python scripts/lines.py --lyrics src/anthem.lyrics.txt --listen public/song/anthem-2.mp3 \
      --language en --words src/anthem.words.json --song src/anthem.song.json --out src/anthem.lines.json

  python3 scripts/lines.py --lyrics src/anthem.lyrics.txt --song src/anthem.song.json \
      --sections "verse 1=0.6, pre-chorus 1=12.4, chorus 1=19.7, verse 2=35.6" --out src/anthem.lines.json

There are two ways to it, and they write the same file.

The first listens. scripts/words.py writes down what it heard and when; that
is not yet the lyrics: it hears some words wrong, hears a stretch twice where
two stretches overlap, and, left alone with a chant, goes on repeating it long
after the singer has stopped. This lines the lyrics up with what was heard, in
order, and gives every word of every line a time.

A word that was heard takes the time it was heard at. A word that was not
takes its place between the words either side of it. With --listen, the
stretch around a line that was not found is listened to again, on its own and
with only its own words as the hint, which is usually enough; the song is
listened to from the start if --words is not there yet, and what is heard is
kept in it, so nothing is listened to twice. A line that is still not heard,
but is sung elsewhere in the song and was heard there, borrows that line's
timing, moved by whole bars: a second chorus is the first one again, later.

With --listen there is one more thing to go on: the sound. Where the band
stops and a line is sung with nothing under it, each word is put where its
sound starts, which is later than where the listener says: the listener gives
the breath before a word to the word. That line then times the same line
wherever else it is sung, a whole number of beats away.

What is left is said out loud, line by line, so that someone listens to
exactly those lines and no others. So is a line that was heard in two
choruses at two different places in the bar: one of the two is wrong.

The second way does not listen, for a machine the listener is not installed
on. --sections takes the second each section's singing starts, as a person
with the song open read them off the player, and spreads the section's lines
evenly from there to the next section, each on the nearest bar. Every word of
a line is given the line's own start: the video shows the line whole, and
nothing in it can arrive a word at a time.

Chinese is timed a character at a time, everything else a word at a time.
With --song (the measured song, from scripts/beats.py) the times are also
given in beats from the first measured beat, which is what a video cut to the
song counts in; without it nothing can be borrowed or compared across bars.

What was heard and is not in the lyrics (a shouted "hey", a crowd's "oh") is
kept too, under "extras". Nothing checks those: the listener also makes up a
"thank you" over an instrumental ending. Ask someone who can hear the song
before putting any of them on screen.
"""
import argparse
import json
import re
import statistics
import sys
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

CJK = re.compile(r'[぀-ヿ㐀-鿿가-힯]')
SAME_SUNG_WORD = 0.35  # seconds: the same word, heard this close together in two stretches, is one word
ROUNDS = 2  # how many times a stretch that is still missing a line is listened to again
HEARD, PARTLY, BORROWED, UNKNOWN, BY_SECTION = 'heard', 'partly', 'borrowed', 'unknown', 'by section'


def key(text):
    """A word as it is compared: no case, no punctuation."""
    return re.sub(r'[^0-9a-z぀-ヿ㐀-鿿가-힯]', '', unicodedata.normalize('NFKC', text).lower())


def units(text):
    """The pieces a line is timed in: each Chinese character, each other word."""
    out = []
    for word in text.split():
        if CJK.search(word):
            out += [char for char in word if key(char)]
        elif key(word):
            out.append(word)
    return out


def read_lyrics(path):
    lines, section, row, count = [], '', 0, {}
    for raw in Path(path).read_text().splitlines():
        raw = raw.strip()
        if not raw:
            continue
        if raw.startswith('['):
            name = re.sub(r'\s*\d+$', '', raw.strip('[]')).lower()
            count[name] = count.get(name, 0) + 1
            section, row = f'{name} {count[name]}', 0
            continue
        lines.append({'section': section, 'row': row, 'text': raw, 'units': units(raw), 'keys': [key(unit) for unit in units(raw)]})
        row += 1
    return lines


def tidy(words):
    """What was heard, a unit at a time, with what the listener made up taken out."""
    heard = []
    for word in words:
        pieces = units(word['word'])
        if not pieces:
            continue
        span = (word['to'] - word['from']) / len(pieces)
        for i, piece in enumerate(pieces):
            heard.append({'key': key(piece), 'text': piece, 'from': word['from'] + i * span, 'to': word['from'] + (i + 1) * span, 'sure': word.get('sure', 0), 'window': word.get('window', '')})

    # Where two stretches cover the same moment, the one that has it nearer
    # its middle heard it better: the listener is at its worst at either end.
    spans = {window: tuple(float(v) for v in window.split('-')) for window in {h['window'] for h in heard} if window}
    for h in heard:
        if h['window'] not in spans:
            continue
        depth = lambda span: min(h['from'] - span[0], span[1] - h['from'])
        if any(depth(span) > depth(spans[h['window']]) for window, span in spans.items() if window != h['window']):
            h['sure'] *= 0.5

    # Several words given the very same instant were never heard one after another.
    piled = set()
    for i in range(len(heard)):
        j = i
        while j + 1 < len(heard) and heard[j + 1]['window'] == heard[i]['window'] and abs(heard[j + 1]['from'] - heard[i]['from']) < 0.03:
            j += 1
        if j - i >= 2:
            piled.update(range(i, j + 1))
    heard = [h for i, h in enumerate(heard) if i not in piled]

    # The same word over and over is the listener stuck, not the singer: the
    # first few may be real, the times of the rest are not.
    kept, run = [], 0
    for i, h in enumerate(heard):
        run = run + 1 if i and h['key'] == heard[i - 1]['key'] and h['window'] == heard[i - 1]['window'] else 1
        if run <= 4:
            kept.append(h)

    # Two stretches overlap, and both hear what is sung there.
    kept.sort(key=lambda h: h['from'])
    once = []
    for h in kept:
        twin = next((o for o in reversed(once[-12:]) if o['key'] == h['key'] and o['window'] != h['window'] and abs(o['from'] - h['from']) < SAME_SUNG_WORD), None)
        if twin is None:
            once.append(h)
        elif h['sure'] > twin['sure']:
            once[once.index(twin)] = h
    return once


def alike(a, b):
    if a == b:
        return 1.0
    if CJK.search(a) or CJK.search(b) or min(len(a), len(b)) < 3:
        return 0.0
    return 0.6 if SequenceMatcher(None, a, b).ratio() >= 0.75 else 0.0


def line_up(sung, heard):
    """Pairs lyric units with heard units, in order, skipping what has no partner."""
    n, m = len(sung), len(heard)
    SKIP_SUNG, SKIP_HEARD = -1.0, -0.4
    score = [[0.0] * (m + 1) for _ in range(n + 1)]
    back = [[None] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        score[i][0], back[i][0] = i * SKIP_SUNG, (1, 0)
    for j in range(1, m + 1):
        score[0][j], back[0][j] = j * SKIP_HEARD, (0, 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            best, step = score[i - 1][j] + SKIP_SUNG, (1, 0)
            if score[i][j - 1] + SKIP_HEARD > best:
                best, step = score[i][j - 1] + SKIP_HEARD, (0, 1)
            trust = 0.6 + 0.4 * heard[j - 1]['sure']
            same = alike(sung[i - 1], heard[j - 1]['key'])
            if same and score[i - 1][j - 1] + 2 * same * trust > best:
                best, step = score[i - 1][j - 1] + 2 * same * trust, (1, 1)
            # "a.m." heard as "a" and "m"; "cannot" heard for "can not".
            if j >= 2 and sung[i - 1] == heard[j - 2]['key'] + heard[j - 1]['key'] and score[i - 1][j - 2] + 2 * trust > best:
                best, step = score[i - 1][j - 2] + 2 * trust, (1, 2)
            if i >= 2 and sung[i - 2] + sung[i - 1] == heard[j - 1]['key'] and score[i - 2][j - 1] + 3 * trust > best:
                best, step = score[i - 2][j - 1] + 3 * trust, (2, 1)
            score[i][j], back[i][j] = best, step
    pairs, used = {}, set()
    i, j = n, m
    while i or j:
        di, dj = back[i][j]
        if di and dj:
            first, last = heard[j - dj], heard[j - 1]
            for k in range(di):
                # Two lyric units heard as one word share its time between them.
                part = (last['to'] - first['from']) / di
                pairs[i - di + k] = {'from': first['from'] + k * part, 'to': first['from'] + (k + 1) * part, 'sure': min(first['sure'], last['sure'])}
            used.update(range(j - dj, j))
        i, j = i - di, j - dj
    return pairs, used


def sound_of(song):
    """How loud the song is where a voice is and where a bass is, a hundredth of a second at a time."""
    import subprocess

    import numpy as np

    rate, size, hop = 22050, 1024, 220
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', song, '-ac', '1', '-ar', str(rate), '-f', 's16le', '-'], check=True, capture_output=True).stdout
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
    index = np.arange(size)[None, :] + hop * np.arange(1 + (len(samples) - size) // hop)[:, None]
    spectrum = np.abs(np.fft.rfft(samples[index] * np.hanning(size), axis=1))
    freqs = np.fft.rfftfreq(size, 1 / rate)
    voice = spectrum[:, (freqs >= 300) & (freqs < 3000)].sum(axis=1)
    low = spectrum[:, (freqs >= 40) & (freqs < 200)].sum(axis=1)
    return {'np': np, 'step': hop / rate, 'first': size / 2 / rate, 'voice': np.convolve(voice, np.ones(3) / 3, mode='same'), 'low': low, 'band': float(np.percentile(low, 90))}


def onset(sound, start, end):
    """
    Where in a word's span its sound actually starts, if the voice is alone
    there: the first place the voice's range climbs out of a real gap. None if
    there is no such place, or if the band is playing under it, in which case
    a climb would as likely be a guitar as a voice.
    """
    np, voice, low = sound['np'], sound['voice'], sound['low']
    at = lambda seconds: int(round((seconds - sound['first']) / sound['step']))
    a, b = max(8, at(start - 0.04)), min(len(voice) - 14, at(end - 0.03))
    if b - a < 8:
        return None
    climbs = []
    for i in range(a, b):
        # A gap: the quietest moment for a little way either side.
        if voice[i] > voice[i - 4:i + 5].min():
            continue
        top = voice[i:i + 13].max()
        if voice[i] > 0.5 * top:
            continue
        half = i + int(np.argmax(voice[i:i + 13] >= (voice[i] + top) / 2))
        # Stopped means stopped: a quiet arrangement still has a pad or a
        # guitar in it, and their swells are not words.
        if low[max(0, half - 6):half + 20].mean() > 0.03 * sound['band']:
            continue
        climbs.append((top - voice[i], half))
    if not climbs:
        return None
    most = max(size for size, _ in climbs)
    return next(sound['first'] + half * sound['step'] for size, half in climbs if size >= 0.6 * most)


def time_lines(lines, heard, grid=None, sound=None):
    """Gives every line its times, and says how each was come by. Returns the heard units that were used."""
    bar = grid['bar'] if grid else None
    flat = [(n, u) for n, line in enumerate(lines) for u in range(len(line['units']))]
    pairs, used = line_up([lines[n]['keys'][u] for n, u in flat], heard)

    for line in lines:
        size = len(line['units'])
        line.update(at=[None] * size, to=[None] * size, sure=[0.0] * size, note='')
        for was in ('source', 'evened', 'alone', 'follows'):
            line.pop(was, None)
    for index, (n, u) in enumerate(flat):
        if index in pairs:
            lines[n]['at'][u], lines[n]['to'][u], lines[n]['sure'][u] = pairs[index]['from'], pairs[index]['to'], pairs[index]['sure']

    for line in lines:
        got = [u for u, at in enumerate(line['at']) if at is not None]
        line['found'] = len(got) / len(line['units'])
        line['how'] = HEARD if line['found'] >= 0.8 else PARTLY if line['found'] >= 0.6 else UNKNOWN
        if line['how'] == UNKNOWN:
            # A few stray matches are not a timing.
            line['at'] = [None] * len(line['units'])
            continue
        lengths = {u: line['to'][u] - line['at'][u] for u in got}
        for u in range(len(line['units'])):
            others = sorted(length for other, length in lengths.items() if other != u)
            usual = max(0.12, min(others[len(others) // 2] if others else 0.3, 0.6))
            if line['at'][u] is not None:
                # The listener starts the first word of a phrase where the last
                # phrase ended, and so gives it all of the wait in between. It
                # ends on time. A word held for most of a second is left alone:
                # singers do that. Either way, the start of a phrase's first
                # word is the least sure time here, by a few tenths of a second.
                after_a_gap = u == got[0] or u - 1 not in lengths
                if after_a_gap and lengths[u] > max(2 * usual, 1.0):
                    line['at'][u] = line['to'][u] - usual
                continue
            # A word that was not heard sits between the ones that were.
            before = max((g for g in got if g < u), default=None)
            after = min((g for g in got if g > u), default=None)
            if before is not None and after is not None:
                line['at'][u] = line['at'][before] + (line['at'][after] - line['at'][before]) * (u - before) / (after - before)
            elif before is not None:
                line['at'][u] = line['to'][before] + (u - before - 1) * usual
            else:
                line['at'][u] = line['at'][after] - (after - u) * usual
            line['to'][u] = line['at'][u] + usual

    # Where the band has stopped and the voice is alone, the sound itself says
    # when each word starts, and says it better than the listener does. The
    # listener gives the breath before a word to the word: in a line that is
    # shouted a word at a time, it starts every word early, by the same
    # fifth of a second. So the words that can be heard alone are put where
    # their sound starts, and the rest of their line is moved by as much.
    for line in lines:
        line['listened'] = list(line['at'])
        if not sound or line['how'] == UNKNOWN:
            continue
        moved = {}
        for u in range(len(line['units'])):
            start = onset(sound, line['at'][u], line['to'][u]) if line['sure'][u] > 0 else None
            if start is not None:
                moved[u] = start - line['at'][u]
        if len(moved) >= 2 and len(moved) * 2 >= len(line['units']):
            late = statistics.median(moved.values())
            line['at'] = [at + moved.get(u, late) for u, at in enumerate(line['at'])]
            line['alone'] = len(moved)

    if not bar:
        return used

    # A line that was timed from its own sound is the pattern for the same line
    # wherever else it is sung: a chant is the same chant with the band under
    # it, a whole number of beats later.
    followed = set()
    for keys in {tuple(line['keys']) for line in lines}:
        same = [line for line in lines if tuple(line['keys']) == keys and line['how'] in (HEARD, PARTLY)]
        model = next((line for line in same if line.get('alone')), None)
        if model is None:
            continue
        followed.add(keys)
        for line in same:
            if line.get('alone'):
                continue
            gaps = [grid['beat'](line['listened'][u]) - grid['beat'](model['listened'][u]) for u in range(len(keys))]
            beats = round(max(reversed(gaps), key=lambda gap: sum(abs(other - gap) < 0.4 for other in gaps)))
            move = lambda seconds: grid['seconds'](grid['beat'](seconds) + beats)
            line.update(at=[move(at) for at in model['at']], to=[move(to) for to in model['to']], follows=f"{model['section']}, line {model['row'] + 1}")

    # A line sung three times or more is sung the same way each time, give or
    # take one: a chant, a hook. Where half or more of its appearances agree on
    # when a word falls and the others are scattered, those were misheard, and
    # take their place from the ones that agree.
    near, far = bar / 11, bar / 8
    for keys in {tuple(line['keys']) for line in lines} - followed:
        same = [line for line in lines if tuple(line['keys']) == keys and line['how'] in (HEARD, PARTLY)]
        if len(same) < 3:
            continue
        first = same[0]
        # How much later each appearance is than the first: the shift most of its words agree on.
        shifts = []
        for line in same:
            gaps = [line['at'][u] - first['at'][u] for u in range(len(keys))]
            shifts.append(max(reversed(gaps), key=lambda gap: sum(abs(other - gap) < near for other in gaps)))
        for u in range(len(keys)):
            placed = [line['at'][u] - shift for line, shift in zip(same, shifts)]
            group = lambda values, at: [other for other in values if abs(other - at) < near]
            agreed = max((group(placed, at) for at in placed), key=len)
            rest = [at for at in placed if abs(at - statistics.median(agreed)) > far]
            rival = max((len(group(rest, at)) for at in rest), default=0)
            if len(agreed) < 2 or len(agreed) * 2 < len(same) or len(agreed) <= rival:
                # No majority. For the first word there is still something to
                # go on: it is only ever heard too early, never too late, so
                # the latest two that agree are the ones that were heard right.
                agreed = [at for at in placed if max(placed) - at < near]
                if u or len(agreed) < 2:
                    continue
            usual = statistics.median(agreed)
            for line, shift, at in zip(same, shifts, placed):
                if abs(at - usual) > far:
                    line['at'][u] = usual + shift
                    line['evened'] = line.get('evened', 0) + 1

    def twins(line):
        """The same words on the same row of another section of the same kind: the other choruses' copy of this line."""
        kind = line['section'].rsplit(' ', 1)[0]
        return [other for other in lines if other is not line and other['row'] == line['row'] and other['keys'] == line['keys'] and other['section'].rsplit(' ', 1)[0] == kind]

    def later(mine, theirs):
        """How much later one line is sung than the same line elsewhere. The first word says least, so the rest outvote it."""
        return statistics.median(mine['at'][u] - theirs['at'][u] for u in range(len(mine['units'])))

    def apart(line, other):
        """How far this section is from that one, read off the rows that were heard in both."""
        return [later(mine, theirs)
                for mine in lines if mine['section'] == line['section'] and mine['how'] in (HEARD, PARTLY)
                for theirs in lines if theirs['section'] == other['section'] and theirs['row'] == mine['row'] and theirs['keys'] == mine['keys'] and theirs['how'] in (HEARD, PARTLY)]

    # Heard in two places: the two should be a whole number of bars apart.
    for line in lines:
        for other in twins(line):
            gaps = apart(line, other)
            if line['how'] != HEARD or other['how'] != HEARD or len(gaps) < 2:
                continue
            off = later(line, other) - round(statistics.median(gaps) / bar) * bar
            if abs(off) > bar / 8 and not line['note']:
                line['note'] = f"sits {abs(off) / bar * 4:.1f} beats {'later' if off > 0 else 'earlier'} in the bar than in {other['section']}: one of the two is wrong"

    # Not heard here, heard there.
    for line in lines:
        if line['how'] != UNKNOWN:
            continue
        source = next((other for other in twins(line) if other['how'] == HEARD and apart(line, other)), None)
        if source is None:
            continue
        shift = round(statistics.median(apart(line, source)) / bar) * bar
        if shift:
            line.update(at=[at + shift for at in source['at']], to=[to + shift for to in source['to']], how=BORROWED, source=f"{source['section']}, line {source['row'] + 1}")
    return used


def seconds_of_mark(text):
    """A time as it is read off a player: 75.5, or 1:15.5."""
    minutes, _, rest = text.strip().rpartition(':')
    return (int(minutes) if minutes else 0) * 60 + float(rest)


def place_by_section(lines, marks, end, grid):
    """Spreads each section's lines from where its singing starts to where the next one's does."""
    names = list(dict.fromkeys(line['section'] for line in lines))
    starts = {}
    for mark in marks.split(','):
        name, _, when = mark.partition('=')
        if not when.strip():
            sys.exit(f'--sections takes "name=seconds" pairs; "{mark.strip()}" has no time.')
        starts[name.strip().lower()] = seconds_of_mark(when)
    unnamed = [name for name in names if name not in starts]
    unknown = [name for name in starts if name not in names]
    if unnamed or unknown:
        sys.exit(f"The lyrics have these sections, in order: {', '.join(names)}."
                 + (f" No start was given for: {', '.join(unnamed)}." if unnamed else '')
                 + (f" These are not in the lyrics: {', '.join(unknown)}." if unknown else ''))
    times = [starts[name] for name in names]
    if times != sorted(times):
        sys.exit('The sections start in a different order from the lyrics; check the times.')

    def on_a_bar(seconds):
        return grid['seconds'](round(grid['beat'](seconds) / 4) * 4) if grid else seconds

    for n, name in enumerate(names):
        sung = [line for line in lines if line['section'] == name]
        until = times[n + 1] if n + 1 < len(names) else max(end, times[n] + 1)
        marks_in = [times[n]] + [on_a_bar(times[n] + (until - times[n]) * k / len(sung)) for k in range(1, len(sung))] + [until]
        for k, line in enumerate(sung):
            size = len(line['units'])
            line.update(at=[marks_in[k]] * size, to=[marks_in[k + 1]] * size, sure=[0.0] * size, note='', found=0.0, how=BY_SECTION)


def missing(lines, end):
    """The stretches of the song in which a line still has to be found, each with the lines to listen for."""
    found = lambda line: line['how'] in (HEARD, PARTLY)
    out, n = [], 0
    while n < len(lines):
        if found(lines[n]):
            n += 1
            continue
        last = n
        while last + 1 < len(lines) and not found(lines[last + 1]):
            last += 1
        before = next((line['to'][-1] for line in reversed(lines[:n]) if found(line)), 0)
        after = next((line['at'][0] for line in lines[last + 1:] if found(line)), end)
        out.append((max(0, before - 1), min(end, after + 1), ' '.join(line['text'] for line in lines[n:last + 1])))
        n = last + 1
    return out


def write(lines, extras, args, beat, words_file):
    """Writes the lines as the video reads them, and says line by line how each was come by."""
    out = {'lyrics': Path(args.lyrics).name, 'words': words_file.name if words_file else None, 'lines': [], 'extras': extras}
    for line in lines:
        row = {'section': line['section'], 'text': line['text'], 'units': line['units'], 'how': line['how']}
        if line.get('source'):
            row['from'] = line['source']
        if line['note']:
            row['note'] = line['note']
        if line.get('evened'):
            row['evened'] = line['evened']
        if line.get('alone'):
            row['by'] = 'its own sound'
        if line.get('follows'):
            row['by'] = f"the sound of {line['follows']}"
        if line['how'] != UNKNOWN:
            row['seconds'] = [round(at, 2) for at in line['at']]
            row['until_second'] = round(line['to'][-1], 2)
            if beat:
                row['at'] = [round(beat(at), 2) for at in line['at']]
                row['until'] = round(beat(line['to'][-1]), 2)
        out['lines'].append(row)
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1))

    print()
    for n, (line, row) in enumerate(zip(lines, out['lines'])):
        if line['how'] == UNKNOWN:
            # Where to listen for it: after the last line that has a time, before the next that does.
            before = next((r['until_second'] for r in reversed(out['lines'][:n]) if 'seconds' in r), 0)
            after = next((f"{r['seconds'][0]:.1f}" for r in out['lines'][n + 1:] if 'seconds' in r), 'the end')
            when, note = ' ' * 15, f'NOT FOUND: it is somewhere in {before:.1f}–{after}s'
        else:
            when = f"{row['seconds'][0]:6.2f}–{row['until_second']:6.2f}s"
            note = {HEARD: '', BY_SECTION: '', PARTLY: f"only {round(line['found'] * 100)}% of it heard", BORROWED: f"not heard; timed from {line.get('source')}"}[line['how']]
        evened = f"{line['evened']} of its words timed as in its other appearances" if line.get('evened') else ''
        note = '; '.join(part for part in (note, evened, line['note']) if part)
        by = f"   (timed from {row['by']})" if 'by' in row else ''
        print(f"{when}  {line['section']:<13} {line['text']}{by}{'  ← ' + note if note else ''}")
    for extra in extras:
        print(f"{extra['from']:6.2f}–{extra['to']:6.2f}s  also heard    {extra['text']}")
    if any(line['how'] == BY_SECTION for line in lines):
        print(f"{len(lines)} lines placed by their sections, not heard: each will show whole, at about the right bar. Written to {args.out}")
        return
    tally = {how: sum(1 for line in lines if line['how'] == how) for how in (HEARD, PARTLY, BORROWED, UNKNOWN)}
    doubted = sum(1 for line in lines if line['note'])
    print(f"{len(lines)} lines: {tally[HEARD]} heard, {tally[PARTLY]} partly heard, {tally[BORROWED]} borrowed, {tally[UNKNOWN]} not found, {doubted} to check; written to {args.out}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--lyrics', required=True)
    parser.add_argument('--words', help='what was heard; written by scripts/words.py, or by this with --listen')
    parser.add_argument('--sections', help='instead of listening: where each section starts, "verse 1=0.6, chorus 1=19.7"')
    parser.add_argument('--end', help='with --sections: the second the last section stops being sung; the end of the song if left out')
    parser.add_argument('--song', help='the measured song from scripts/beats.py, to count in beats and compare across bars')
    parser.add_argument('--listen', help='the song itself, to listen (again) wherever a line is not found')
    parser.add_argument('--language', default='zh')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    lines = read_lyrics(args.lyrics)
    song = json.loads(Path(args.song).read_text()) if args.song else None
    if song:
        frames, fps, start = song['beats'], song['fps'], song['start']
        gap = (frames[-1] - frames[0]) / (len(frames) - 1)

        def beat(seconds):
            frame = (seconds - start) * fps
            if frame <= frames[0]:
                return (frame - frames[0]) / gap
            for i in range(1, len(frames)):
                if frame < frames[i]:
                    return i - 1 + (frame - frames[i - 1]) / (frames[i] - frames[i - 1])
            return len(frames) - 1 + (frame - frames[-1]) / gap

        def seconds_of(beats):
            i = min(len(frames) - 2, max(0, int(beats // 1)))
            return start + (frames[i] + (beats - i) * (frames[i + 1] - frames[i])) / fps

        grid = {'bar': 4 * gap / fps, 'beat': beat, 'seconds': seconds_of}
    else:
        grid = beat = None

    if args.sections:
        last = seconds_of_mark(args.end) if args.end else (song['start'] + song['frames'] / song['fps'] if song else 0)
        place_by_section(lines, args.sections, last, grid)
        write(lines, [], args, beat, None)
        return
    if not args.words:
        sys.exit('Give --words <file> to line the lyrics up with what is heard, or --sections to place them without listening.')

    words_file = Path(args.words)
    if args.listen:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from words import MODEL, hint_of, listen, seconds_of, stretches
        end = seconds_of(args.listen)
        if not words_file.exists():
            windows = stretches(0, end)
            first = listen(args.listen, hint_of(Path(args.lyrics).read_text()), windows, args.language)
            words_file.write_text(json.dumps({'song': Path(args.listen).name, 'model': MODEL, 'windows': ','.join(f'{a:g}-{b:g}' for a, b in windows), 'words': first}, ensure_ascii=False, indent=1))
    elif not words_file.exists():
        sys.exit(f'There is no {args.words}. Give --listen <the song> to have it listened to.')
    record = json.loads(words_file.read_text())

    sound = sound_of(args.listen) if args.listen else None
    heard = tidy(record['words'])
    used = time_lines(lines, heard, grid, sound)
    for _ in range(ROUNDS if args.listen else 0):
        tried = set(record['windows'].split(','))
        again = [(window, hint) for a, b, hint in missing(lines, end) for window in stretches(round(a, 1), round(b, 1)) if f'{window[0]:g}-{window[1]:g}' not in tried]
        if not again:
            break
        for window, hint in again:
            record['words'] += listen(args.listen, hint, [window], args.language, literal=True)
            record['windows'] += f',{window[0]:g}-{window[1]:g}'
        words_file.write_text(json.dumps(record, ensure_ascii=False, indent=1))
        heard = tidy(record['words'])
        used = time_lines(lines, heard, grid, sound)

    # What was heard besides the lyrics.
    extras, phrase = [], []
    for j, h in enumerate(heard + [None]):
        loose = h is not None and j not in used and h['sure'] >= 0.5
        if loose and (not phrase or h['from'] - phrase[-1]['to'] < 0.6):
            phrase.append(h)
            continue
        if phrase:
            extras.append({'text': ' '.join(p['text'] for p in phrase), 'from': round(phrase[0]['from'], 2), 'to': round(phrase[-1]['to'], 2)})
        phrase = [h] if loose else []
    write(lines, extras, args, beat, words_file)


if __name__ == '__main__':
    main()
