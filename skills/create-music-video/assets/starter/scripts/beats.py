#!/usr/bin/env python3
"""Measures a song for the video cut to it, and says who is playing in each bar.

  python3 scripts/beats.py public/song/anthem-2.mp3 --out src/anthem.song.json
  python3 scripts/beats.py public/song/anthem-2.mp3 --out src/anthem.song.json --double
  python3 scripts/beats.py --bars src/anthem.song.json

Beats come from scripts/music.mjs; this adds what a stage needs on top of
them: where each bar starts, and how loud the kick, the body and the top of the
mix are in every frame, so the lights follow the sound that is actually there
rather than a grid drawn over it.

The first beat of a bar is taken to be where the bass changes note most often.
A lift in loudness is no guide to it: a lift often arrives half a bar early, as
a pick-up into the section. The measured stretch starts on the first whole bar;
--from-beat starts it on a later one, for a video of part of a song.

A fast song with a heavy backbeat is sometimes counted at half its speed. The
tempo printed is the check: if the song was asked for at 160 and this says 80,
run it again with --double, which puts a beat between every two.

What it prints after measuring, and again with --bars, is the song a bar at a
time: the second it starts, and the kick, the voice's range and the cymbals on
each of its four beats, as bars of #. That table is what the lights are written
from. In a dense song the loudness hardly moves; what changes is who is
playing. A bar with no kick in it is the band stopping, and nothing in the
video matters more than landing on those.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

RATE = 22050
FPS = 30


def decode(path):
    import numpy as np

    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', path, '-ac', '2', '-ar', str(RATE), '-f', 's16le', '-'],
        check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.int16).reshape(-1, 2).astype(np.float32) / 32768


def spectrum(samples, size, hop):
    import numpy as np

    window = np.hanning(size)
    count = 1 + (len(samples) - size) // hop
    index = np.arange(size)[None, :] + hop * np.arange(count)[:, None]
    return np.abs(np.fft.rfft(samples[index] * window, axis=1)), (np.arange(count) * hop + size / 2) / RATE


def bar_phase(mid, beats):
    """Which of every four beats the bass most often changes note on."""
    import numpy as np

    magnitude, times = spectrum(mid, 4096, 512)
    freqs = np.fft.rfftfreq(4096, 1 / RATE)
    bass = (freqs >= 40) & (freqs < 260)
    pitch = (np.round(12 * np.log2(freqs[bass] / 440.0)) % 12).astype(int)
    chroma = np.stack([magnitude[:, bass][:, pitch == k].sum(axis=1) for k in range(12)], axis=1)
    notes = []
    for i in range(len(beats) - 1):
        inside = (times >= beats[i]) & (times < beats[i + 1])
        note = chroma[inside].mean(axis=0) if inside.any() else np.zeros(12)
        notes.append(note / (np.linalg.norm(note) + 1e-9))
    notes = np.array(notes)
    change = np.concatenate([[0], 1 - (notes[1:] * notes[:-1]).sum(axis=1)])
    return int(np.argmax([change[phase::4].mean() for phase in range(4)]))


def show_bars(song):
    """The song a bar at a time: when it starts, and what is playing on each of its beats."""
    beats, fps, start = song['beats'], song['fps'], song['start']

    def level(track, a, b):
        part = track[int(round(a)):max(int(round(a)) + 1, int(round(b)))]
        return sum(part) / len(part) if part else 0

    def four(track, i):
        return ' '.join(f"{'#' * round(8 * level(track, beats[i + k], beats[i + k + 1])):<8}" for k in range(4))

    print(f"{song['song']}: {song['bpm']} beats a minute, {len(beats) // 4} bars. Each column is a beat, each # an eighth of full.")
    print(f"{'bar':>4} {'from':>7}   {'kick':<35} {'voice and chords':<35} cymbals")
    for bar in range((len(beats) - 1) // 4):
        i = bar * 4
        seconds = start + beats[i] / fps
        print(f"{bar + 1:>4} {seconds:>6.2f}s   {four(song['kick'], i)}    {four(song['body'], i)}    {four(song['top'], i)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('song', nargs='?')
    parser.add_argument('--out')
    parser.add_argument('--from-beat', type=int, help='start on this beat instead of the first whole bar; it has to start a bar')
    parser.add_argument('--double', action='store_true', help='the song was counted at half its speed: put a beat between every two')
    parser.add_argument('--bars', metavar='SONG_JSON', help='print the bar-by-bar table of a song already measured')
    args = parser.parse_args()

    if args.bars:
        show_bars(json.loads(Path(args.bars).read_text()))
        return
    if not args.song or not args.out:
        sys.exit('usage: python3 scripts/beats.py <song file> --out src/<name>.song.json [--double] [--from-beat n]')

    try:
        import numpy as np
    except ImportError:
        sys.exit('Measuring a song needs numpy: python3 -m pip install numpy')

    analysis = json.loads(subprocess.run(
        ['node', str(Path(__file__).resolve().parent / 'music.mjs'), args.song, '--json'],
        check=True, capture_output=True, text=True).stdout)
    beats = np.array(analysis['beats'])
    bpm = float(analysis['bpm'])
    if args.double:
        beats = np.sort(np.concatenate([beats, (beats[1:] + beats[:-1]) / 2]))
        bpm *= 2
    samples = decode(args.song)
    mid = samples.mean(axis=1)
    phase = bar_phase(mid, beats)
    first = phase if args.from_beat is None else args.from_beat
    if (first - phase) % 4:
        sys.exit(f'Beat {first} is not the first of a bar; bars start on beats {phase} mod 4.')

    start = float(beats[first])
    seconds = float(analysis['seconds'])
    frames = int(np.ceil((seconds - start) * FPS))

    magnitude, times = spectrum(mid, 1024, 128)
    freqs = np.fft.rfftfreq(1024, 1 / RATE)

    def per_frame(lo, hi):
        chosen = (freqs >= lo) & (freqs < hi)
        if not chosen.any():
            # A band narrower than the analysis can resolve takes the nearest slice.
            chosen[np.argmin(np.abs(freqs - (lo + hi) / 2))] = True
        level = magnitude[:, chosen].sum(axis=1)
        out = np.zeros(frames)
        for frame in range(frames):
            inside = (times >= start + frame / FPS) & (times < start + (frame + 1) / FPS)
            out[frame] = level[inside].mean() if inside.any() else 0
        loud = np.percentile(out, 97)
        return np.clip(out / loud, 0, 1) if loud > 0 else out

    # 24 bands, evenly spaced by ear rather than by hertz, for a wall of meters.
    edges = np.geomspace(40, 10000, 25)
    bands = np.stack([per_frame(edges[k], edges[k + 1]) for k in range(24)], axis=1)

    out = {
        'song': Path(args.song).name,
        'fps': FPS,
        'start': round(start, 3),
        'frames': frames,
        'bpm': round(bpm, 2),
        # Frame of every beat from the first one on; fractions kept, a beat rarely lands on a frame.
        'beats': [round((float(beat) - start) * FPS, 2) for beat in beats[first:]],
        'kick': [round(float(v), 3) for v in per_frame(30, 130)],
        'body': [round(float(v), 3) for v in per_frame(300, 3000)],
        'top': [round(float(v), 3) for v in per_frame(6000, 11000)],
        'bands': [''.join(str(int(round(v * 9))) for v in row) for row in bands],
    }
    Path(args.out).write_text(json.dumps(out, separators=(',', ':')))
    print(f"Written to {args.out}: the first whole bar starts {start:.2f}s into the song, which is where beat 0 of the video's count is.\n")
    show_bars(out)


if __name__ == '__main__':
    main()
