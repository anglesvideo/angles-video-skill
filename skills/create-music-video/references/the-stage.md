# The stage

What the starter gives a song, and how a song's file is put together. Read it before writing `src/<song>.tsx`.

- [What is in the workspace](#what-is-in-the-workspace)
- [A song's file](#a-songs-file)
- [Counting in beats](#counting-in-beats)
- [The lights](#the-lights)
- [The singer's pictures](#the-singers-pictures)
- [The words](#the-words)
- [What else there is](#what-else-there-is)

## What is in the workspace

The stage is the same for every song. None of it knows about a song: each piece is told, frame by frame, what to do, and what tells it is the song's own file.

| File | What it is |
| --- | --- |
| `src/song.ts` | Reads a measured song: where the music is at a frame, and how loud each part of it is. |
| `src/rig.tsx` | The stage and everything that lights it: moving heads, washes, haze, lasers, sparks, paper, a blinder. Colours and small helpers. |
| `src/shots.tsx` | A singer who is still pictures, made to move by cutting: framings, cuts, and where a point of a picture has ended up on screen. |
| `src/type.tsx` | Words: a line of display type, a phrase that arrives as it is sung, a verse line along the bottom. |
| `src/singer.tsx` | Things drawn on a singer and pinned there: a voice at the microphone, a halo, rings round the eyes. |
| `src/readout.tsx` | A strip of meters along the front of the stage, and a frame of readings round the picture. |
| `src/Root.tsx` | One `<Composition>` per song, whose `id` is the song's name. |

You write, for each song, `src/<song>.tsx`; and for each singer, `src/<singer>.ts`. The stage files are yours to change when a song needs something they cannot do — a new fixture, a different way for a cut to arrive — but change them for every song at once, not for one.

## A song's file

This is a whole one, short. It compiles and renders as it stands, given the measurements and a singer's file. A real song's is five or six times as long and has the same six parts in the same order.

```tsx
// "Our Anthem" — the whole song.
//
// `p` below is always "beats since the first bar started"; every fourth beat
// starts a bar. The words and the beat each is sung on are read from
// anthem.lines.json; nothing here retimes them.
import React from 'react';
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from 'remotion';
import lyrics from './anthem.lines.json';
import data from './anthem.song.json';
import { MARKS, Pic, made } from './dev';
import { Beam, Beams, Blinder, BLUE, Grain, Haze, ICE, INK, RGB, W, WHITE, Wash, aim, frac, hit, lerp, rgba, span } from './rig';
import { Cut, EmptyStage, Shot, cut, shotList } from './shots';
import { Voice } from './singer';
import { readSong } from './song';
import { Line, Sub, Sung, write } from './type';

const { beatAt, kick, body, lead, length } = readSong(data);
export const ANTHEM_FPS = data.fps;
export const ANTHEM_FRAMES = length;

// -- The song, in beats from its first bar ----------------------------------------
// Read off the table scripts/beats.py prints: what changes at each of these.
const bar = (n: number) => 4 * (n - 1);
const S = {
  verse: bar(1), //  a guitar and the voice, no drums
  build: bar(9), //  the kick on every beat
  stop: bar(14), //  the band stops: the hook, alone
  drop: bar(15), //  everyone in
  end: bar(25),
};

type Words = { section: string; text: string; units: string[]; at: number[]; until: number };
const LINES = lyrics.lines as unknown as Words[];
const TOLD = LINES.filter(line => line.section === 'verse 1' || line.section === 'pre-chorus 1');
const HOOK = LINES.find(line => line.section === 'chorus 1') as Words;
write(LINES.map(line => line.text).join(' '));

// -- Shots: a picture, a framing, the beat it lands on ------------------------------
const CUTS: Cut<Pic>[] = [
  cut(-2, 'desk', 1.03, [0.5, 0.5], BLUE, 0.3, { b: { zoom: 1.12, at: [0.5, 0.48] } }),
  cut(S.build, 'alone', 1.8, [0.5, 0.4], BLUE, 0.3, { b: { zoom: 1.03, at: [0.5, 0.5] }, how: 'flash' }),
  { from: S.stop, pic: null, a: { zoom: 1, at: [0.5, 0.5] }, tint: INK, tintLevel: 0 },
  cut(S.drop, 'fist', 1.03, [0.5, 0.5], WHITE, 0.3, { how: 'punch' }),
];
const stage = shotList(CUTS, made, MARKS);

// -- The lights: where each head points and how bright it is, section by section ----
const HEADS = 8;
function overhead(p: number, K: number): Beam[] {
  return Array.from({ length: HEADS }, (_, i) => {
    const x = 150 + (i * (W - 300)) / (HEADS - 1);
    const centre = aim(x, -30, W / 2, 620);
    const fan = lerp(-42, 42, i / (HEADS - 1));
    const pair = i === 3 || i === 4;
    let angle = centre;
    let level = 0;
    let color: RGB = ICE;
    if (p < S.build) {
      level = pair ? 0.3 : 0; // one pair, and nothing else
    } else if (p < S.stop) {
      angle = fan * 0.35;
      level = 0.3 + 0.4 * Math.exp(-frac(p) * 2.4); // every head, falling away after each beat
    } else if (p < S.drop) {
      level = 0; // the band has stopped
    } else {
      angle = fan + 7 * Math.sin(((p - S.drop) * Math.PI) / 2 + i * 0.6);
      color = i % 2 ? WHITE : ICE;
      level = 0.6 + 0.4 * K; // as bright as the kick
    }
    return { x, y: -30, angle, level, color, spread: 2.8, length: 1500 };
  });
}

export const Anthem: React.FC = () => {
  const frame = useCurrentFrame() - lead;
  const p = beatAt(frame);
  const K = kick(frame);
  const voice = Math.min(1, Math.max(0, (body(frame) - 0.3) * 1.7));
  const on = (from: number, to: number) => p >= from && p < to;
  const stopped = on(S.stop, S.drop);
  const shot = stage(p, frame);
  const mic = shot?.mark.mic ? shot.pin(shot.mark.mic) : null;

  return (
    <AbsoluteFill style={{ background: rgba(INK, 1) }}>
      <Audio src={staticFile('song/anthem-2.mp3')} />
      {!stopped && <EmptyStage />}
      {shot && (
        <Shot shot={shot} light={0.86 + (p >= S.drop ? 0.1 * K : 0)}>
          {mic && <Voice at={mic} size={0.012 * shot.scale} p={p} level={voice} />}
        </Shot>
      )}
      <Wash a={BLUE} b={ICE} level={stopped ? 0 : 0.14 + (p >= S.drop ? 0.2 * K : 0)} />
      <Haze frame={frame} tint={BLUE} level={stopped ? 0 : 0.6} />
      <Beams id="top" beams={overhead(p, K)} />

      {/* Told lines along the bottom: each is gone before the next arrives in its place. */}
      {TOLD.map((line, i) => {
        const until = Math.min(line.until + 0.3, (TOLD[i + 1]?.at[0] ?? Infinity) - 0.5);
        return on(line.at[0] - 0.5, until) ? <Sub key={line.at[0]} p={p} text={line.units} at={line.at} until={until} /> : null;
      })}

      {/* The hook, with nothing under it: every word lands when it is sung. */}
      {on(HOOK.at[0], S.drop) && (
        <Line y={540} size={190} glow={WHITE} split={5 + 20 * hit(p, HOOK.at[HOOK.at.length - 1], 5)}>
          <Sung text={HOOK.units.map(unit => unit.toUpperCase())} at={HOOK.at} p={p} />
        </Line>
      )}

      <Blinder level={0.8 * hit(p, S.drop, 4.5) * span(frame, -lead, 12 - lead)} />
      <Grain frame={frame} />
    </AbsoluteFill>
  );
};
```

The order things are drawn in is the order they sit in the room: the stage, the singer, the light thrown over both (wash, haze, beams), what is drawn over the picture (sparks, paper), the words, the readout, and last the blinder and the grain. Lights are drawn with `mixBlendMode: 'screen'`, so they add to what is under them; a singer drawn after the beams would stand in front of the light instead of in it.

Register the song in `src/Root.tsx` under its own name, and render a moment of it at once — `node scripts/look.mjs anthem 2` — before writing the rest. A file that does not render at twenty lines is easier to fix than one that does not at six hundred.

## Counting in beats

`readSong(data)` takes `src/<song>.song.json` and answers:

| | |
| --- | --- |
| `beatAt(frame)` | Where the music is, in beats from the first bar. Whole numbers are beats; every fourth, from 0, starts a bar. |
| `frameOf(beat)` | The frame a beat falls on — for things that are started by frame, like `Sparks`. |
| `kick(frame)`, `body(frame)`, `top(frame)` | How loud the kick and bass, the voice and chords, and the cymbals are, 0 to 1, each rising at once and falling away like a lamp. |
| `bands(frame)` | Twenty-four meters across the range of the ear, low to high. |
| `lead`, `length` | Frames of song before the first bar, and the length of the whole video. |

**The video starts where the song starts, which is before beat 0.** A song has a count-in, or the voice comes in early. So a song's component takes `useCurrentFrame() - lead` as its frame and never trims the audio; in its first moments `p` is below zero. Write the opening for that: a cut at `-2`, a fade in from `-lead`.

Write every time as a beat, never as a frame or a second. `bar(n)` — `4 * (n - 1)` — is the beat bar `n` starts on, counting bars from 1 as the table does. A word's time comes from `lines.json`, where `at` is already in beats.

Four helpers do most of the motion:

- `hit(p, from, rate)` — 1 at `from`, dying away after it; 0 before. A flash, a jolt, a word landing.
- `span(p, a, b)` — 0 before `a`, 1 after `b`. A fade, a build.
- `frac(p)` — how far through the beat. `Math.exp(-frac(p) * 2.4)` is a pulse on every beat.
- `ease(t)`, `lerp(a, b, t)`, `mix(colourA, colourB, t)`.

## The lights

A fixture is drawn from a list of beams, each `{ x, y, angle, level, color, spread, length }`. `angle` is degrees from straight down, leaning right; 180 points straight up. `aim(x, y, toX, toY)` is the angle that lands on a spot. Heads above the frame sit at `y: -30`; heads on the floor at `y: H + 30` with `angle: 180 - tilt`.

Write one function for each row of fixtures — the heads overhead, the footlights, the room's colour and haze — that takes `p` and the kick and returns what every lamp is doing, as a chain of `if (p < S.next)` in the order the song goes. The section names are the song's own. A look is a few lines; these are the ones that come up again and again:

```tsx
// One pair on the singer, and nothing else: the room is quiet.
level = pair ? 0.3 + 0.04 * Math.sin(p * 0.8) : 0;

// The kick lands once a bar: a pair of heads at the edge lands with it, left then right.
const n = Math.floor(p / 4);
level = (n % 2 ? [6, 7] : [0, 1]).includes(i) ? 0.8 * hit(p, n * 4, 1.3) : 0;

// A build over four bars: one more pair of heads every bar, from the middle outwards.
const open = Math.floor((p - S.build) / 4);
level = Math.abs(i - 3.5) <= open + 0.5 ? 0.3 + 0.4 * Math.exp(-frac(p) * 2.4) : 0;

// The bar before a stop: every head closing on the centre, flickering its way up.
const rise = span(p, S.roll, S.stop);
angle = lerp(fan * 0.35, centre, ease(rise));
level = (0.3 + 0.5 * rise) * (Math.floor(p * 4) % 2 === 0 ? 1 : 0.4);

// The drop: the fan springs open, overshoots, and sways.
const since = p - S.drop;
angle = lerp(centre, fan + 7 * Math.sin((since * Math.PI) / 2 + i * 0.6), 1 - Math.exp(-since * 3.2) * Math.cos(since * 5));

// Heads crossing, two bars to a swing.
angle = (i % 2 ? 1 : -1) * 34 * Math.sin(((p - S.cross) * Math.PI) / 2) + fan * 0.25;

// A new position on every beat.
const k = Math.floor(p - S.poses) % 4;
const poses = [() => 0, () => centre, (n: number) => (n < 4 ? 38 : -38), () => fan];
angle = lerp(poses[(k + 3) % 4](i), poses[k](i), ease(span(frac(p), 0, 0.2)));
```

- **Where the band stops, light a word, not the room.** In a stopped bar the heads are off except for a pair that comes up with each word — `hit(p, line.at[k], 1.5)` — a pair further out each time.
- **Follow the instrument that is playing.** `0.6 + 0.4 * K` is as bright as the kick. Where the drums have dropped out and only voices are left, use the voice instead. Where the ending is hits with holes between them, `0.14 + 0.86 * K` and nothing else.
- **Colour is a decision per section, and there are few of them.** Two or three colours a song, each meaning something: the cold of the verses, the colour of the chorus, one kept back for the moment the song turns. `rig.tsx` has `ICE`, `BLUE`, `CYAN`, `MAGENTA`, `VIOLET`, `GOLD`, `MINT`, `WHITE`; a song may add its own as `const RED: RGB = [255, 52, 70]`.
- **`Blinder` is every lamp at the audience.** Once at each drop, falling away within a beat: `0.8 * hit(p, S.drop, 4.5)`. Never held, never repeated inside a second.
- **A camera that is hit.** Wrap everything but the blinder in a `div` moved by a few pixels of `random(...)` scaled by `hit(p, S.drop, 3)`, and scaled by `1.012 + 0.014 * K` in the loud parts.

## The singer's pictures

`src/<singer>.ts` names the pictures and says where things are in each, as parts of the picture's width and height:

```ts
import pictures from './images.json';
import { Marks, Picture, Point } from './shots';

export type Pic = 'desk' | 'alone' | 'fist' | 'card';

export const MARKS: Record<Pic, Marks> = {
  desk: { subject: [0.5, 0.59], mic: [0.55, 0.3] },
  alone: { subject: [0.505, 0.52], mic: [0.532, 0.228] },
  fist: { subject: [0.47, 0.5], mic: [0.515, 0.31] },
  card: { subject: [0.5, 0.59], mic: [0.557, 0.384] },
};
/** The blank card held in `card`: its middle, and its width. */
export const CARD = { at: [0.505, 0.687] as Point, width: 0.077 };

const all = pictures as unknown as Record<string, Picture | undefined>;
/** Kept as `dev-<name>` by scripts/art.mjs. */
export const made = Object.fromEntries((Object.keys(MARKS) as Pic[]).flatMap(name => (all[`dev-${name}`] ? [[name, all[`dev-${name}`]]] : []))) as Partial<Record<Pic, Picture>>;
```

`subject` is the middle of the figure: the picture is drawn twice, and the part round the subject drifts a little apart from the background. `mic` is the end of the microphone. To find a point, lay a grid over the picture and read it off — `ffmpeg -i public/images/dev-fist.jpg -vf "scale=1000:-2,drawgrid=w=100:h=100:t=1:c=white@0.25" grid.jpg` puts a line every tenth of the width — then check it in a rendered frame, where a voice drawn a hand's width from the microphone is plain to see.

A cut names a picture, a framing and the beat it lands on:

```ts
cut(from, pic, zoom, at, tint, tintLevel, { b, how, roll, dim })
```

- `zoom` is how far in, from 1, where the picture just covers the frame. `at` is the point of the picture at the centre of the frame. At `zoom: 2` half the picture's width is on screen, so a face at `[0.5, 0.2]` framed at `2.6` shows from `0.31` to `0.69` across. The framing never shows past the picture's edge.
- `b` is the framing it has drifted to by the next cut. Left out, it pushes in a little. A `b` with a smaller zoom pulls back — a figure shrinking into an empty room.
- `how` is how it arrives: `'punch'` (a push in that settles), `'whip'` (from the side), `'flash'`, `'tear'` (a quarter of a beat of the picture coming apart). No `how` is a plain cut.
- `roll` leans the frame a few degrees. `dim: true` is a shape in the dark, for the bar before something happens.
- `{ from, pic: null, … }` is black.

`shotList(CUTS, made, MARKS)` gives a function of `(p, frame)` that returns the shot that is up, or `null` when the cut is black or its picture has not been made — so a video can be written, and its lights judged, before every picture exists. `shot.pin(point)` is where a point of the picture is on screen now; `shot.scale` is the picture's width in pixels, so `0.012 * shot.scale` is a size that stays right as the framing moves. Whatever is drawn on the singer goes inside `<Shot>`, so that it leans and whips with the cut.

- **One picture, several framings.** A full figure is also a waist-up and a close-up of the hands. Three cuts on one picture read as three shots, and the singer is certain to be the same person in each.
- **Cut on the word.** A cut at `line.at[2]` lands as the third word is sung, which no bar number will.
- **The quiet parts hold a shot for bars; the loud parts change it every bar or every beat.** That difference is most of what makes a chorus feel like one.
- **Say something with the same picture twice.** The arena empty in the first chorus and full in the last is two pictures and the whole story.

## The words

`lines.json` gives, for every line, its `units` — the words, or for Chinese the characters — and `at`, the beat each is sung on, with `until`, the beat the line is over. `how` says how that was come by: a line that is `"by section"` has one time for all its words, and will show whole whatever it is given to.

- `<Line y size …>` sets a line of display type, centred, at a height. `glow` is the colour of its light, `split` how far the red and blue of it are pulled apart (raise it with `hit` as a word lands), `scale`, `rotate`, `skew`, `outline` for hollow letters, `x` to slide it, `opacity`. `font` is a face of the song's own.
- `<Sung text at p />` inside a line makes each piece arrive when it is sung. `text` is a string, timed a character at a time, or a list of words, timed a word at a time. A word that has not been sung yet takes up its place and cannot be seen, so the line does not shuffle as it fills.
- `<Sub p text at until />` is a told line along the bottom: there, faintly, before it is sung, and filling in as it is.

`write(everything the video will show)` fetches the faces. The display face it sets is a Chinese one that also has Latin letters. For a song in another script, or one that wants a poster face, load one from `@remotion/google-fonts` in the song's file and pass it as `font`:

```tsx
import { loadFont } from '@remotion/google-fonts/Anton';
const POSTER = `${loadFont('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily}, sans-serif`;
<Line font={POSTER} …>
```

- **Measure a shouted line at the size it lands at.** A line that fits at rest runs off the frame when a landing scales it up by a fifth. Eighteen capitals of a condensed face fit 1920 pixels at about 190; give it room, or two rows.
- **A hook sung in a stopped bar is a poster built one word at a time**: each word alone in the dark as it is sung, the last one below the rest and larger, and the one that carries the meaning in the song's colour.
- **Two lines never share a place.** A told line is gone half a beat before the next one starts to arrive: `Math.min(line.until + 0.3, next.at[0] - 0.5)`.
- **What a crowd sings back** — the "oh oh oh" — is hollow type sliding behind everything, as bright as the voices are loud. Only when the user has heard it.
- **The first word of a phrase is the least sure time in the file.** Do not hang the biggest moment of the video on it; hang it on the last word of the hook, or on the bar.

## What else there is

- `Sparks` — a burst thrown up from a point, started by frame: `from={frameOf(S.drop)}`. One each side of the stage at a drop.
- `Burst` — speed lines out from a point, for an impact: `level={hit(p, word, 5)}`, with `inner` large enough to keep the type clear.
- `Confetti` — paper falling through the lights. For the last time round, and only then.
- `Lasers` — thin hard lines fanned from one point; bright with the cymbals, `0.35 + 0.65 * top(frame)`.
- `Meter` — the song's own spectrum as a strip of lamps along the front. `Hud` — a frame of readings: a clock, a name, a line of status that types itself out, the tempo and the bar. Its lines are `[beat, p => text]`; let them say what the lyric says in another voice, and nothing the song does not.
- `Voice`, pinned at the microphone, as loud as `body(frame)` says the singing is.

A fade in from black over the first dozen frames and out over the last three beats, a soft vignette, and `Grain` over everything — it breaks up the bands a dark gradient turns into once a platform compresses it.
