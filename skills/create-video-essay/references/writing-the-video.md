# Writing the video

You write this video yourself, in Remotion, for this product, and render it on the user's machine. Nothing here supplies a design. The starter workspace carries timing, voice, and frame-checking mechanics; every colour, typeface, layout, and picture is yours to decide after you have seen what there is to show.

That order is the method. A template is designed before it meets the product, so the only thing it can always fill is a headline and a paragraph. You are looking at the source, so you can draw the real thing: its numbers, its file tree, its command and what the command prints, its interface. **When a scene comes out as a headline over a paragraph, it is short of material, not of styling — go back and find a fact.**

Work through the steps in order. Each one produces a file the next one reads.

| Step | Produces |
| --- | --- |
| 1. Workspace | `video/` with the starter installed |
| 2. Facts | `src/epNN.facts.json` |
| 3. Script | `src/epNN.script.json` |
| 4. Voice and music | `src/epNN.audio.json`, one sound file per line, and the track the video is cut to |
| 5. Look | `src/look.tsx` — once per product, reused by every later video |
| 6. Scenes | `src/epNN.tsx` |
| 7. Check | frames in `out/frames/epNN/`, looked at and fixed |
| 8. Finish | `out/epNN.final.mp4` |

## 1. Workspace

Look for an existing workspace first: a directory holding `src/look.tsx` and `scripts/voice.mjs`, usually `video/` at the repository root. If there is one, this is the next video in a series — skip to step 2, number it after the last `epNN`, and do not redesign anything in `look.tsx`.

Otherwise create one. Tell the user where it will go (default `video/` in the repository; a directory they name when there is no repository), that it installs Remotion and downloads a headless browser on the first render — a few hundred megabytes, all inside that directory — and wait for a yes. Then:

```bash
cp -R <skill-directory>/assets/starter/. <workspace>/
cd <workspace> && npm install
```

Run every later command from the workspace directory. Use `npm`; the lockfile it writes is the one to keep. Check that `.gitignore` came across with the copy — without it, `node_modules/` and any recordings would land in the user's repository.

Say once, at setup, that Remotion is free for individuals and for companies of up to three people, and that a larger company needs a Remotion company licence. It is their licence to hold, not something this Skill provides.

The starter is mechanics only:

- `src/timeline.ts` — turns the measured voice into frames (`buildTimeline`), finds the frame a spoken phrase lands on (`phraseAt`), and two easing helpers (`enter`, `rise`).
- `scripts/voice.mjs` — voices the script and writes the timeline, cut to the music when there is any.
- `scripts/music.mjs` — finds a track's tempo, beats, and lifts, and gets a track from the Angles library.
- `scripts/sfx.mjs` — gets sound effects from the Angles library.
- `scripts/image.mjs` — makes a picture that cannot be drawn as code: an illustration, a setting, a cover.
- `scripts/stills.mjs` — renders single frames before there is a video: a few pictures to show early, or one scene to look at after changing it.
- `scripts/render.mjs` — renders the video in parts and joins them, so changing one scene costs one part.
- `scripts/frames.mjs` — pulls frames out of a video so you can look at them.
- `scripts/finish.mjs` — brings the render to publishing loudness.

The scripts use a system `ffmpeg` when there is one and the build inside Remotion otherwise, so nothing else needs installing.

## 2. Facts

Before writing a word, collect what is true about this product today and save it as `src/epNN.facts.json`, each entry with where it came from. This file is what the pictures are made of, and the only place a number in the video may come from.

Look for material a viewer can see, not adjectives:

- **Numbers you can count yourself** — files, commands, endpoints, supported formats, tests, releases, the date of the first commit. Count them with a command and record the command as the source. Never take a number from memory or from prose in the README without checking it.
- **The real surface** — the install line, the smallest working command and what it prints, a config file, an API response, the names in the file tree. Copy these exactly. A command you composed is a command that fails in front of the viewer's audience.
- **The interface** — screenshots the user gives you, or the product's own markup and styles in the source, which you can rebuild as a faithful fragment. Do not draw an interface the product does not have.
- **What changed** — for an update video: the commits, changelog entries, and releases since the last one, by date.
- **Public proof** — stars, downloads, named customers — only where the source states it and you can point at it.

Do not read or copy `.env*`, credentials, private keys, customer data, database dumps, or production logs, and keep internal hostnames out of anything that will be on screen. Run a command to capture its output only when it is read-only and the user has agreed; otherwise copy the output shown in the docs.

Never invent a metric, a testimonial, a customer, a logo, or a benchmark. If the facts are thin, say so and ask the user for a screenshot or a number rather than filling the gap.

## 3. Script

The script is a list of short spoken lines. Each line becomes one beat of the video.

```json
{
  "title": "…",
  "voice": { "provider": "none" },
  "gap": 0.35,
  "tail": 2,
  "lines": [
    { "id": "l01", "text": "…", "pause": 0.5 },
    { "id": "l02", "text": "…" }
  ]
}
```

Unless the user already told you what the video should say, offer two or three angles first — one line each, each resting on a different fact from step 2 — and let them choose. Deciding what to say is the part they most want help with.

Then write the lines:

- **Open on the viewer's problem, not on the product.** The product arrives as the answer.
- **One idea per line**, and only ideas you can show. If you cannot picture what is on screen while a line is spoken, the line is not finished — or step 2 is not.
- **Eight to twelve lines, 30 to 60 seconds.** A line longer than about 25 words should be two.
- **Write for the ear.** Spell numbers the way they are said. Every number spoken must be in the facts file, and must be the number shown.
- **End on where to go** — the product's public address, as a person would say it. Never a staging or internal host.
- Do not put the name of this Skill, of Angles, or of any tool used to make the video into it. It is the user's video.

Show the user the script and let them change it before anything is voiced. Wording changed later costs a re-voice and usually a re-timing.

## 4. Voice and music

Ask the user how the video should sound. Check what is available first:

```bash
node scripts/voice.mjs --providers
```

- **A synthesised voice through their Angles account** — `"provider": "angles"`, when `ANGLES_API_KEY` is set. Add `"language"` for a script that is not in English. A language has more than one narrator: `node scripts/voice.mjs --voices <language>` lists them, and `"id"` names the one to use. Offer the user the choice — a man or a woman is the first thing a listener notices. Voice lines count against the account's daily limit, not its video allowance.
- **A synthesised voice with a key of their own** — `elevenlabs`, `openai`, or `minimax`, when that key is already set in the environment. `voice.id` and `voice.model` choose the voice; leave them out for the provider's default.
- **Their own voice** — `"provider": "recorded"`. They record each line as its own file, named after the line id, into `public/takes/epNN/` (for example `l03.m4a`). Sound only is fine. To appear on camera as well, use the `create-presenter-video` Skill.
- **No voice** — `"provider": "none"`. Each line is timed to how long its caption takes to read. Most social feeds play muted, so this is a real option, not a fallback; pair it with music.

Before sending anything, say which service will receive the script text. Do not go looking for keys in `.env` files, and never print one. Offer to try another voice if the first is wrong for the product.

Set the choice in the script and run:

```bash
node scripts/voice.mjs src/epNN.script.json
```

It writes `src/epNN.audio.json`: every line with its measured length and the moment its voice starts. That file is the timeline — the scenes are cut to it, so the pictures can never drift from the sound.

Pacing lives in the script: `pause` on a line is the silence before it, `gap` the default, `tail` the hold after the last line. Give a beat room before a line that turns the argument, and at least two seconds of `tail` for the closing frame. Change a number, run the command again: unchanged lines are measured again, not paid for again. Use `--redo l03,l07` to re-voice lines whose delivery was off.

You cannot hear what was made. Where a product name or an acronym is said differently from how it is written, give that line a `"say"` — the same sentence respelled for the voice — and leave `text` as it should read on screen. Ask the user to listen for a word said wrong; correcting one is a `say` on that line and the command again.

### Music

Ask whether the video should have music, and where it comes from:

- **A track from the Angles library**, when `ANGLES_API_KEY` is set. Every track in it was made ahead of time, listened to by a person, and measured, so it costs nothing and cannot come back sounding wrong. List the tracks against this video:

  ```bash
  node scripts/music.mjs library --for src/epNN.audio.json --lift l06
  ```

  `--lift` names the line where the video turns: the product arriving, the answer, the reveal. The listing says which tracks are long enough and can put a lift on that line. Among those, choose by mood and tempo for this product and this script, tell the user which you chose and why, and take it with `node scripts/music.mjs use <id>`. Leave `--lift` out for a video with no turn; `--mood <word>` narrows the list.
- **A track the user has.** Copy it into `public/music/`. It has to be one they may publish with.
- **A new track**, when nothing in the library suits and the user has a provider key of their own: `node scripts/music.mjs make <name> "<what it should sound like>" --seconds <length>` (ElevenLabs, or `--provider minimax`). This spends their credits, so ask first. Ask for ten seconds more than the video, and describe the shape — "sparse piano for the first third, then drums come in and it opens up" — since the shape is what the video gets cut to. It is made without vocals: a singer fights the voice.
- **None.**

Read the track before you use it:

```bash
node scripts/music.mjs public/music/track.mp3
```

That prints its tempo, whether it has a beat clear enough to cut to, how its energy moves, and its **lifts** — the moments it gets clearly louder. Then name it in the script and run `scripts/voice.mjs` again:

```json
"music": { "src": "music/track.mp3", "lift": "l06" }
```

- Every cut after the first moves onto a beat of the track, by lengthening the pause before it — never by shortening a line. The video ends on a beat too.
- `lift` names the line where the video turns: the product arriving, the answer, the reveal. The track is started at the point that puts a lift on the cut into that line — the earliest lift the video can reach, so the track's own build-up comes before the turn. Choose that line on purpose; leave `lift` out when the track has no lift or the video has no turn.
- `"liftAt": <seconds>` picks a different lift, `"offset": <seconds>` starts the track at a point you choose, and `"snap": false` leaves the cuts where the pauses put them.

A video longer than its music takes a list of tracks, each naming the line it takes over on:

```json
"music": [
  { "src": "music/quiet.mp3" },
  { "src": "music/build.mp3", "from": "l09", "lift": "l12" }
]
```

Each is cut to on its own: the cuts under it sit on its beats, and `lift`, `offset`, and `snap` mean for it what they mean for a single track. One gives way to the next at the cut into the `from` line, which stays where its `pause` put it. To choose a track for one stretch, list the library against that stretch: `node scripts/music.mjs library --for src/epNN.audio.json --from l09 --to l16 --lift l12`.

A track with no clear beat still works as a bed under the voice. Do not time pictures to it.


## 5. Look

`src/look.tsx` is written once per product and reused by every video after it. It holds what stays the same from one video to the next: the frame size and rate (`W`, `H`, `FPS`), the palette, the typefaces, the chrome around the frame, and the caption. It holds no scene.

Take it from the product, not from a mood:

- **Colours and type** from the product's own site, stylesheet, logo, or README. Load fonts with `@remotion/google-fonts/<Family>`, naming the weights and subsets you use.
- **A frame the series can be recognised by** — a mark, a title line, a progress line — small, and at the edges.
- **Captions**: burn in the line being spoken. Give them a band of the frame that scenes keep clear, and skip the caption on a beat whose picture already spells out the words.
- **Size**: 1920×1080 for X, LinkedIn, and YouTube; 1080×1920 for Shorts, Reels, and TikTok. Ask if the user has not said where it is going.

Stay away from the look every generated video has — a dark gradient, a glow, a centred sans headline. If the product has no visual identity yet, choose one deliberately and tell the user what you chose, since they will live with it for the series.

Put the user's brand in the frame only as they write it, and nothing of Angles or of this Skill anywhere.

## 6. Scenes

`src/epNN.tsx` is written for this video only. Each beat gets a picture built from the facts file.

Start from this assembly and change it freely — a picture may hold across several lines, a beat may cut twice:

```tsx
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import audio from './ep01.audio.json';
import facts from './ep01.facts.json';
import { Beat, buildTimeline } from './timeline';
import { Caption, FPS, Frame } from './look';

const { beats, total } = buildTimeline(audio, FPS);
export const EP01_FRAMES = total;

const SCENES: Record<string, React.FC<{ beat: Beat }>> = { l01: Problem, l02: Count /* … */ };

export const Ep01: React.FC = () => (
  <Frame total={total}>
    {beats.map(beat => {
      const Scene = SCENES[beat.id];
      return (
        <Sequence key={beat.id} from={beat.from} durationInFrames={beat.frames}>
          <Scene beat={beat} />
          <Caption beat={beat} />
          {beat.kind === 'audio' && beat.src && (
            <Sequence from={beat.lead} layout="none">
              <Audio src={staticFile(beat.src)} />
            </Sequence>
          )}
        </Sequence>
      );
    })}
  </Frame>
);
```

Register it in `src/Root.tsx` with the id `epNN`.

What makes a scene worth watching:

- **Show the thing the line is about.** A count is the number, counting up, beside the list it counts. A command is a terminal with the real command typed and its real output. A change is before and after. A claim about speed is the two durations side by side.
- **Read every number from `facts`**, never type it into the scene. Derive percentages and totals in code from the same file, and format them once, so the screen cannot disagree with the source.
- **Land things on the word.** `phraseAt(beat, 'Forty-two')` is the frame the voice reaches that phrase; bring each element in a few frames before its word. It throws if the phrase is no longer in the line, so a reworded script cannot leave a picture mistimed.
- **Finish before the voice does.** Typing, counters, and bars must complete inside their beat. Size the animation to `beat.voice`, not to a fixed number of frames.
- **Start already drawn.** Frame 0 is the thumbnail, and the first thing a muted feed shows. The opening scene's picture is on screen from the first frame, not fading in over an empty background.
- **Something changes on screen at least every couple of seconds.**
- **Hold the closing frame**: the address, large, still, for the whole `tail`.

Remotion rules that are easy to break:

- Every animated value is computed from `useCurrentFrame()`. No CSS transitions or keyframes, no timers, no `Date.now()`, no `Math.random()` — use `random(seed)`.
- Inside a `<Sequence>`, the frame counts from that sequence's start.
- Clamp `interpolate` at both ends unless you mean it to run on.
- Files in `public/` are reached with `staticFile()`. Download remote images into `public/` rather than linking to them: an image that fails to load cancels the whole render.
- Footage plays with `<OffthreadVideo>`; `trimBefore` and `trimAfter` are in frames.
- Keep every `remotion` and `@remotion/*` package on the same version.

### Pictures you cannot draw

Most of what a video shows you can draw as code — a number, a chart, a terminal, an interface, a map — and should: it is exact, and it moves. A photograph or an illustration you cannot. When a line needs one and the user has none, make it, when `ANGLES_API_KEY` is set:

```bash
node scripts/image.mjs harbour "A harbour at night seen from the quay, boats low in the frame, flat gouache, teal and amber, no text"
node scripts/image.mjs cover "…" --aspect 9:16
```

It writes `public/images/harbour.jpg`, large enough to fill the frame and be pushed in on, and records it in `src/images.json` with its size and the words it was made from. The shapes are `16:9`, `9:16`, `1:1`, `4:3` and `3:4`. An account makes a limited number of pictures a day and every call says how many are left, so decide which lines need one before making any. The same name with the same words is not made twice; new words under the same name replace the picture.

- **Make what cannot be drawn, and nothing that has to be true.** An illustration of an idea, a setting behind a line, a cover. Never the product's interface, a screenshot, a logo, a chart, a number, or a person who exists: those come from the product and the facts file, or are left out. A made picture of the interface is a claim about the product, and it is false.
- **No words in the picture.** Say "no text" in the description, and set every word in type over it, where it is spelled right and matches the look.
- **One hand for the whole video.** Write one sentence for how every picture is drawn — the medium, the palette from the look, the light, what is left out — keep it in `look.tsx` beside the palette, and end every description with it. Pictures in two styles look like two videos.
- **Describe what is in the frame**, not what it means: the subject, where it sits, what is around it, the light. Say which part of the frame stays quiet, for the caption and whatever is set over it.
- **Open every picture before it goes into a scene.** They come back with a sixth finger, with lettering that says nothing, with the wrong object. Make it again with plainer words, or do without it.
- **Say it is a made picture wherever a viewer could take it for a real one.** The record carries `generated: true` so a scene can.

Use it as any picture in `public/`, and give it something to do — a slow push in, a crop that travels while the line is spoken:

```tsx
import images from './images.json';

<Img src={staticFile(images.harbour.src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
```

### Music in the video

Play the track once, at the top level of the video — outside every `<Sequence>` — from the point the timeline chose:

```tsx
const { beats, total, pulses } = buildTimeline(audio, FPS);

{audio.music && (
  <Audio src={staticFile(audio.music.src)} trimBefore={Math.round(audio.music.offset * FPS)} volume={duck(audio, FPS)} />
)}
```

`duck` keeps the music under the voice, lets it up in the gaps and over the closing frame, and fades it at both ends. Pass `{ under, open }` to change the two levels.

With a list of tracks, `buildTimeline` returns them as `beds`. Play each in its own sequence, still at the top level:

```tsx
const { beats, total, pulses, beds } = buildTimeline(audio, FPS);

{beds.map(bed => (
  <Sequence key={bed.from} from={bed.from} durationInFrames={bed.frames} layout="none">
    <Audio src={staticFile(bed.src)} trimBefore={bed.trimBefore} volume={bedVolume(audio, FPS, bed)} />
  </Sequence>
))}
```

`bedVolume` is `duck` for one track of several, with a second's fade where one hands over to the next.

In this workspace a **beat** is one spoken line; the beats of the music are **pulses**, in frames. The cuts already sit on them. Use them for whatever has no word to land on:

- `pulsesIn(beat, pulses)` — the pulses inside one line, counted from its start. Bring the rows of a list or the cells of a grid in on them, one each.
- `onPulse(frame, pulses)` — 1 on a pulse, falling to 0: a small accent that keeps time. Keep it small.

Words win over pulses. When the voice names a thing, the thing lands on the word.

### Sound effects

A few, quiet, and from one family. A sound belongs on something that lands — a stamp, a counter reaching its number, the cut into the reveal — and nowhere else. The same kind of event gets the same sound every time.

Take them from the Angles library, when `ANGLES_API_KEY` is set:

```bash
node scripts/sfx.mjs library
node scripts/sfx.mjs use soft-tick soft-pop soft-rise
```

The library is grouped in families whose sounds belong together. Pick one family for the video and stay in it — a paper tick beside a digital pop sounds like two videos. Sounds the user already has go straight into `public/sfx/`. For a sound the library does not have, `node scripts/sfx.mjs <name> "<what it sounds like>" --seconds <length>` makes one with the user's own ElevenLabs key; that spends their credits, so ask first.

Every sound is recorded in `src/sfx.json` with its length and its `hit` — how far in its loudest moment is. A sound that builds — a rise, a whoosh in — has its hit near its end, so lining up the hit is what makes it arrive on the moment rather than start there.

Place a sound beside the picture it belongs to, from the same frame variable, started early by its `hit` so the two land together:

```tsx
import sfx from './sfx.json';

<Sequence from={stampAt - Math.round(sfx.stamp.hit * FPS)} layout="none">
  <Audio src={staticFile(sfx.stamp.src)} volume={0.5} />
</Sequence>
```

Keep effects under the voice — 0.3 to 0.6 — and out of the first few frames.

## 7. Check

A render is not finished until you have looked at it. Type-check, render, then pull the frames where a picture has to be right:

```bash
npx tsc --noEmit
node scripts/render.mjs epNN
node scripts/frames.mjs out/epNN.mp4 --beats src/epNN.audio.json
```

The type-check takes seconds and catches what would otherwise fail a minute into a render.

That renders the video in parts of about twenty seconds, then writes the opening frame, the middle and end of every line, and the closing frame. Open every one, in order; add `--sheet` to get them twelve to a page.

Do not wait for a whole render to look at one scene. `node scripts/stills.mjs epNN --lines l04,l07:mid` renders the frames where those lines have been said, straight from the scenes, and `--all --at mid --sheet` the middle of every line — where a picture that arrives late shows as an empty frame. And after a fix, `node scripts/render.mjs epNN --lines l04-l06` renders again only the parts those lines are in and joins them to the rest — seconds, where the whole video is minutes.

Look for these — each has shipped in a video that looked fine in the code:

- **An empty opening frame.** Everything in the first scene was animated in, so the thumbnail is a blank background.
- **Overlap and overflow.** Text running past the margin or behind the caption band; elements stacked on each other; a headline wrapping onto a line its box has no room for.
- **A number that is not the fact.** Rounding is the usual cause: 62.6% printed as 63 in one place and 62 in another, or a counter that stops one short. Compare each number on screen with the facts file.
- **A picture that is late.** In the middle frame of a line, is the thing being said already on screen? In the end frame, has every animation finished?
- **A scene that is only words.** A headline and a sentence on a background is the tell that the scene ran out of material. Find a fact and draw it.
- **Text too small to read on a phone.** On a 1920-wide frame, nothing a viewer must read below about 28px.
- **A made picture with something wrong in it** — a sixth finger, lettering that says nothing, an interface that was never the product's — or one a viewer would take for a photograph of the real thing.
- **Anything that should not be published** — a key in a terminal, a customer's name in a screenshot, an internal address.
- **The closing frame**: the right address, spelled the way the user gave it.

You can check the picture and you cannot check the sound. Before handing over, say so, and ask the user to listen once: for a name said wrong, music that fights the voice, or an effect that is too loud.

Fix what you find, render again, and look again at the frames you changed. If you cannot view images in this environment, say so and ask the user to look through `out/frames/` before going on.

## 8. Finish and hand over

```bash
node scripts/finish.mjs out/epNN.mp4
```

This writes `out/epNN.final.mp4` at publishing loudness and prints its size, length, and resolution.

Give the user:

- the path to the final file, with its length and resolution;
- what you checked, and anything you could not verify;
- which pictures were made rather than drawn from the facts, if any;
- a short caption and one post for the platform they named, written from the same angle and facts — the problem first, no pile of hashtags;
- how to change it: which file holds the words, which the pictures, and that asking for the next video reuses this look.

Offer to commit the workspace source. `node_modules/`, `out/`, recordings, and raw footage are already ignored.

## The next video

A workspace with a `look.tsx` is a series. For the next one:

- Keep the look. Add `epNN` files; touch `look.tsx` only to fix something that was wrong.
- If the user has not named a topic, read what shipped since the last video — commits, changelog, releases after its date — and offer two or three topics, each opening on the problem that change solves.
- Take fresh facts. Numbers from the last video's facts file are a month old.
- Use the same voice, the same family of sound effects, and music in the same mood, so the series sounds like one show.
