#!/usr/bin/env python3
"""Listens to a song and writes down when each word of it is sung.

  .venv/bin/python scripts/words.py public/song/anthem-2.mp3 --lyrics src/anthem.lyrics.txt --language en --out src/anthem.words.json

Runs Whisper on this machine (mlx-whisper, which is for Apple Silicon); the
song is not sent anywhere. The lyrics are given to it as a hint of what to
expect, which is most of what makes it hear sung words right. The first run
fetches the model, about a gigabyte and a half.

It is not installed with the workspace, because it is large and not every
machine can run it:

  python3 -m venv .venv && .venv/bin/pip install mlx-whisper numpy

Without it, scripts/lines.py --sections places the lyrics a line at a time
instead.

The song is listened to a stretch at a time (--windows, in seconds, overlapping
a little; left out, it is cut into stretches of 24 seconds). Given the whole of
it at once, the model hears a repeated chorus, starts repeating it itself, and
stops listening to what follows.

What comes out is what was heard, not the lyrics: every word with the second
it starts and ends on, and which stretch it was heard in. scripts/lines.py
lines that up with the lyrics, and uses listen() below to go back over the
stretches where a line was not found.
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

MODEL = 'mlx-community/whisper-large-v3-turbo'
STRETCH, OVERLAP = 24, 2


def seconds_of(song):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', song], check=True, capture_output=True, text=True).stdout)


def stretches(start, end):
    """A span of the song cut into stretches short enough to be heard in one go."""
    out = []
    while end - start > STRETCH + OVERLAP:
        out.append((start, start + STRETCH))
        start += STRETCH - OVERLAP
    return out + [(start, end)]


def hint_of(lyrics):
    # Section marks are for the singer, not for the listener.
    return ' '.join(line.strip() for line in lyrics.splitlines() if line.strip() and not line.strip().startswith('['))


def listen(song, hint, windows, language='zh', model=MODEL, literal=False):
    """
    What is heard in each (start, end) stretch of the song. `literal` hears a
    stretch once, exactly as it sounds; otherwise a stretch that comes back as
    one phrase over and over is thrown away and heard again less literally,
    until it is not. Literal is what a short stretch with a short hint wants.
    """
    try:
        import mlx_whisper
    except ImportError:
        sys.exit(
            'The listener is not installed in this Python. It is mlx-whisper, for Apple Silicon: '
            'python3 -m venv .venv && .venv/bin/pip install mlx-whisper numpy, then run this with .venv/bin/python. '
            'Without it, scripts/lines.py --sections places the lyrics a line at a time.'
        )

    words = []
    for start, end in windows:
        window = f'{start:g}-{end:g}'
        with tempfile.NamedTemporaryFile(suffix='.wav') as stretch:
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-to', str(end), '-i', song, '-ac', '1', '-ar', '16000', stretch.name], check=True)
            heard = mlx_whisper.transcribe(
                stretch.name,
                path_or_hf_repo=model,
                language=language,
                word_timestamps=True,
                initial_prompt=hint,
                condition_on_previous_text=False,
                temperature=0.0 if literal else (0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
                compression_ratio_threshold=1.9,
            )
        print(f"{start:g}–{end:g}s: {heard['text'].strip()[:200]}")
        for segment in heard['segments']:
            for word in segment.get('words', []):
                if word['word'].strip():
                    words.append({'word': word['word'].strip(), 'from': round(start + float(word['start']), 3), 'to': round(start + float(word['end']), 3), 'sure': round(float(word.get('probability', 0)), 2), 'window': window})
    return words


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('song')
    parser.add_argument('--lyrics', required=True, help='a text file with the words of the song, section marks and all')
    parser.add_argument('--out', required=True)
    parser.add_argument('--language', default='zh')
    parser.add_argument('--model', default=MODEL)
    parser.add_argument('--windows', help='stretches to listen to, in seconds: "0-24,22-42"')
    args = parser.parse_args()

    windows = [tuple(float(v) for v in window.split('-')) for window in args.windows.split(',')] if args.windows else stretches(0, seconds_of(args.song))
    words = listen(args.song, hint_of(Path(args.lyrics).read_text()), windows, args.language, args.model)
    Path(args.out).write_text(json.dumps({'song': Path(args.song).name, 'model': args.model, 'windows': ','.join(f'{a:g}-{b:g}' for a, b in windows), 'words': words}, ensure_ascii=False, indent=1))
    print(f"{len(words)} words heard; written to {args.out}")


if __name__ == '__main__':
    main()
