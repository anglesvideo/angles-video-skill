---
name: create-video-from-recording
description: Turn a screen recording of a product into a finished promo video that you write and render yourself. Use when a user points at a screen capture, screencast, demo recording, or product walkthrough file and asks to turn it into a video, promo, ad, social clip, or launch asset. Watch the recording locally, check its frames for anything that should not be published, write a script around what it actually shows, then design the video in Remotion — cutting, framing, zooming, and labelling the footage to match each spoken line — render it on the user's machine, check the result, and return a finished mp4. The recording never leaves the machine and no template is involved. Falls back to an Angles-hosted template render only when asked or when local rendering is impossible.
---

# Turn a screen recording into a video

You watch the recording, write the script around what it shows, and build the video yourself in Remotion on the user's machine. The footage is cut to the words: each line plays the stretch of the recording that shows what it says, framed and zoomed so a viewer can read it.

The workflow is in [references/writing-the-video.md](references/writing-the-video.md). **Read it in full before you write anything**, then follow its eight steps in order. This file covers what a recording changes.

This Skill is for a recording the user already has. To build a video from a repository or a product page, use `create-launch-video`.

## 1. Check the machine and set up

Local rendering needs Node.js 18 or newer, and the user's agreement to install npm packages and a headless browser into a workspace directory. Writing and rendering need no account; a synthesised voice, the music and sound-effect library, and pictures that cannot be drawn as code come through the user's Angles account, and the recording is not uploaded anywhere.

Take the hosted path in [references/hosted-render.md](references/hosted-render.md) instead only when the user asks for an Angles-hosted or template video, or when the machine cannot do the above. That path uploads the recording, so say so before taking it.

Set up the workspace now — step 1 of the workflow — because its scripts are what you watch the recording with.

## 2. Watch the recording

Everything the video says comes from what you see here. A capability you do not notice cannot appear in the script, and the footage would then play under generic words no matter how good it is.

You cannot play a video file, so turn it into frames you can read. From the workspace:

```bash
node scripts/frames.mjs <path-to-recording> --every 3 --out out/frames/recording
```

The first line it prints is the recording's width, height, and length. Use `--every 5` for a recording over a minute, and `--at <seconds>` to look closer at a moment. When a system `ffmpeg` is installed, also pull the frames where the picture changes:

```bash
ffmpeg -v error -i <path-to-recording> -vf "select='gt(scene,0.25)',scale=1280:-2" -vsync vfr out/frames/recording/change-%03d.jpg
```

Look at every frame in order, the way a viewer would meet them, and note the time of each moment worth naming. If the recording has narration and a transcription tool is available locally, transcribe it; do not send the audio anywhere to do so.

### Check the frames before going further

A recording carries whatever was on screen at the time, and this video is made to be published. Look for:

- API keys, tokens, and anything in a `.env`, terminal, or devtools pane
- Real customer names, email addresses, and account identifiers
- Internal URLs, ticket numbers, and staging hostnames
- Billing and payment details
- Unrelated windows, tabs, bookmarks, and notification popups

If any appear, stop and tell the user what you found and roughly when, without repeating the exposed values. Then agree what to do: leave that stretch out, crop it out of the frame, or re-record. Whatever you agree, confirm it in the rendered frames at the check step — a crop that is a few pixels short still publishes the secret.

### Write down what it shows

In the facts file, alongside anything else you gather, record:

- `recording`: its path, width, height, and length.
- `moments`: each thing the product is seen doing, with the seconds it starts and ends and where on the screen it happens — what the user *does* and what they *get*, not a narration of cursor movements.
- `waits`: stretches where nothing changes — a build running, a page loading. These get cut or sped up.
- Numbers, names, and results visible on screen that are safe to repeat.

Ask the user for the product's public address rather than reading it off a frame: an address caught in a recording may be a staging host or a signed-in deep link.

## 3. Bring the footage into the workspace

Make a working copy in `public/footage/`, which is ignored by git. Re-encode when the recording is larger than 1920 pixels on its long edge, faster than 30 frames a second, or not H.264 — a 4K, 60fps capture renders many times slower for no visible gain:

```bash
ffmpeg -i <path-to-recording> -vf "scale=1920:-2" -r 30 -c:v libx264 -crf 18 -pix_fmt yuv420p -an public/footage/demo.mp4
```

Use `npx remotion ffmpeg` in place of `ffmpeg` when none is installed. `-an` drops the recording's sound, since the video gets its own voice. If the user wants the recording's own narration kept instead, that is a different video — the pictures follow the recording's timing, not a new script — so ask before assuming it.

## 4. Write the script to the footage

Follow steps 3 and 4 of the workflow, with one constraint: every line about the product must have a moment in `moments` that shows it. Keep the order the demo makes its point in. Lines that open on the problem and close on the address have no footage, and are designed like any other scene.

## 5. Design the scenes around the footage

Follow steps 5 and 6 of the workflow. For each line that has a moment:

- **Play that stretch, and only that stretch.** `<OffthreadVideo src={staticFile('footage/demo.mp4')} trimBefore={Math.round(start * FPS)} muted />` inside the beat's sequence.
- **Fit the stretch to the line.** Set `playbackRate` to the stretch's length divided by the beat's length, and keep it between about 0.8 and 2.5 so motion still reads as real. If the stretch is much longer than the line, cut the wait out of the middle rather than speeding everything up; if it is shorter, hold on the result with `<Freeze>` rather than slowing down.
- **Frame it so it can be read.** A full desktop shrunk into a phone-sized frame shows nothing. Scale and move the footage so the part of the screen where the action happens fills the frame, using the positions you noted — in the recording's own pixels, not the pixels of the scaled frames you looked at. Move between framings with the voice.
- **Label what matters.** A callout that names the thing being clicked, placed from the same coordinates, arriving on the word that names it.
- **Give it a setting** — a window, a device, a margin — that belongs to the look, so footage scenes and drawn scenes read as one video.

## 6. Check, finish, and hand over

Follow steps 7 and 8 of the workflow. On top of its checklist, look for:

- Interface text in the footage that is too small to read at the size you showed it.
- A cut that lands in the middle of an action, or a click whose result is not on screen before the beat ends.
- Anything from the sensitive list above, in every frame that shows footage.

Return the path to `out/epNN.final.mp4` with its length and resolution, say which stretches of the recording were used and which were left out, and include a short caption and one post.
