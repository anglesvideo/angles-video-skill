# Timing the words

`src/<song>.lines.json` says, for every line of the lyrics, when it is sung. `scripts/lines.py` writes it in one of two ways. This is what each does, how to read what it prints, and what neither can tell you.

## What the file holds

```json
{
  "lines": [
    { "section": "chorus 1", "text": "I will not promote", "units": ["I", "will", "not", "promote"],
      "how": "heard", "by": "its own sound",
      "seconds": [19.67, 20.11, 20.47, 20.83], "until_second": 21.24,
      "at": [51.84, 53.0, 54.0, 55.02], "until": 56.11 }
  ],
  "extras": [{ "text": "Oh -oh -oh -oh", "from": 21.24, "to": 22.96 }]
}
```

`units` are the pieces a line is timed in: words, or for Chinese, Japanese and Korean, characters. `at` is the beat each is sung on, counted from the first bar as the video counts; `seconds` is the same from the start of the song. `how` is how the line was come by, and `by`, when it is there, says the times were taken from the sound rather than from the listener. A section is named as the lyrics name it, numbered as it recurs: `verse 1`, `chorus 2`.

## With the listener

```bash
python3 -m venv .venv && .venv/bin/pip install mlx-whisper numpy
.venv/bin/python scripts/lines.py --lyrics src/<song>.lyrics.txt --listen public/song/<file> --language en \
    --words src/<song>.words.json --song src/<song>.song.json --out src/<song>.lines.json
```

The listener is Whisper, run on this machine through `mlx-whisper`, which is built for Apple Silicon. The environment is about a gigabyte and the model, fetched on the first run, about a gigabyte and a half. Nothing is sent anywhere. **It has only been run on Apple Silicon.** On another machine, say that it is untried there, and offer the second way.

`--language` is the language sung: `en`, `zh`, `ja`, `es`. What is heard is kept in `--words`, so running the command again listens to nothing it has already heard; delete that file to listen afresh.

The script listens to the song a stretch at a time, lines the lyrics up with what it heard, and — for any line it did not find — goes back and listens to just that stretch with just those words as the hint, twice if it has to. Then it prints every line:

```
 19.67– 21.24s  chorus 1      I will not promote   (timed from its own sound)
 25.52– 27.09s  chorus 1      I will not promote   (timed from the sound of chorus 1, line 1)
 27.06– 30.50s  chorus 1      Zero users, zero MRR
 63.36– 64.92s  chorus 2      I will not promote   ← only 75% of it heard
                 chorus 2      Keep going, keep building  ← NOT FOUND: it is somewhere in 62.0–66.1s
```

| It says | It means | Do |
| --- | --- | --- |
| nothing after the line | Every word was heard, in order. | Use it. |
| `(timed from its own sound)` | The band had stopped under this line, so each word was put where its sound starts. | Use it; these are the best times in the file. |
| `(timed from the sound of …)` | The same line, sung elsewhere with the band under it, given the rhythm of the one that was sung alone, a whole number of beats away. | Use it. |
| `← N of its words timed as in its other appearances` | The line is sung three times or more; where most agreed and one did not, the one was moved. | Use it. |
| `← only N% of it heard` | Most of the line was heard; the rest was placed between. | Use it for a told line. For a line set large, tell the user it is one to watch. |
| `← not heard; timed from …` | Not heard here, heard in another chorus, and moved by whole bars. | Use it, and tell the user. |
| `← sits N beats later in the bar than in …` | The same line was heard in two choruses at two places in the bar. One is wrong. | Ask the user which sounds right, or set both to the one that agrees with the bar table. |
| `← NOT FOUND: it is somewhere in …` | Not heard at all. The line has no times. | Ask the user for the second it starts, and place it yourself; or do not set it word by word. |
| `also heard` | Sung, or imagined, and not in the lyrics. | Nothing, until the user says they hear it too. |

### What the listener gets wrong

- **It starts every word a little early** — about a tenth to a fifth of a second — because it gives the breath before a word to the word. Along the bottom of the frame nobody sees that. In a line shouted a word at a time, it is the difference between a word landing on the beat and landing ahead of it. Where the band stops under such a line, the script times it from the sound instead, and carries that timing to the same line elsewhere. **A shouted line that is only ever sung over the band keeps the listener's times**, and cannot be checked from here: tell the user so, by name.
- **The first word of a phrase is its least sure.** A long wait before it is counted as part of it; the script pulls back the worst of these, and cannot tell a stretched word from one the singer really held.
- **A chant makes it repeat itself.** Left with "oh, oh, oh", it writes forty more. The script drops those, but it is why anything under `also heard` needs the user's ear.
- **It hears words over an instrumental ending** — "thank you", "we'll be right back". Nobody sang them.

### When a line will not be found

Listen to a narrower stretch by hand, then run `lines.py` again:

```bash
.venv/bin/python scripts/words.py public/song/<file> --lyrics src/<song>.lyrics.txt --language en \
    --windows "60-67" --out src/<song>.words.extra.json
```

If that hears it, the times are in that file to read. If not, the line is not clear enough to time by machine: ask the user for the second it starts.

## Without the listener

```bash
python3 scripts/lines.py --lyrics src/<song>.lyrics.txt --song src/<song>.song.json \
    --sections "verse 1=0.6, pre-chorus 1=12.4, chorus 1=19.7, verse 2=35.6, pre-chorus 2=47.3, chorus 2=57.6, outro 1=1:13.7" \
    --end 1:16.6 --out src/<song>.lines.json
```

Ask the user to play the song and read off, to the second, when the singing of each section starts — every section the lyrics have, in order — and, if the song goes on after the last line, when the singing ends (`--end`). Give them the list of sections to fill in. Times are seconds, or minutes and seconds as a player shows them.

Each section's lines are spread evenly from its start to the next section's, every line on the nearest bar. Tried against a song that had also been listened to, every line came out within a bar of where it was sung, most within half a second. That is right for a line that appears whole and wrong for anything finer:

- every word of a line has the line's own time, so `<Sung>` shows the line at once and `<Sub>` has nothing to fill in;
- a hook cannot land a word at a time. Set it whole, on the bar, and let the lights do the landing;
- a chorus with gaps in it — a line, two bars of crowd, a line — is spread as if it had none. If the user says a line is early or late, move that one by hand in the file.

Say in the handover that the words were placed by section and not heard.

## What neither can tell you

Whether the words on screen are in time with the voice. You have times and no ears. Before the video is finished, name for the user the moments that matter most — the stops, the hook, any line the report marked — and ask them to watch those with the sound on.
