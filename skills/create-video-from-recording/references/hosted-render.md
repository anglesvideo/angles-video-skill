# Hosted render of a screen recording with an Angles template

Use this only when the user asks for an Angles-hosted or template video, wants the browser editor, or the machine cannot render locally (no Node.js 18+, or packages and a headless browser cannot be installed). Otherwise write the video yourself as `SKILL.md` describes. Unlike the local path, this one uploads the recording, and an uploaded recording becomes a public URL.

On this path Angles plans the scenes from a summary you write, fits them to one of its templates, and renders in the cloud. It needs `ANGLES_API_KEY`, and each render costs 30 credits from the account's balance. You do not design the scenes here; you choose among templates.

Use the bundled `scripts/angles.mjs` client for every Angles API operation. Do not construct ad hoc HTTP requests unless the client is unavailable.

This Skill is for a recording the user already has. To build a video from a repository or a product page instead, use the `create-launch-video` Skill.

## 1. Check access

Require Node.js 18 or newer and `ANGLES_API_KEY`. If the key is missing, stop and direct the user to the Angles Integrations page. Never print, log, or include the key in tool arguments beyond the client process environment.

Use `ANGLES_API_BASE_URL` only when the user is testing a non-production Angles deployment.

## 2. Watch the recording

Angles never sees this file. It writes every line of the script from the summary you produce here, so a capability you do not name cannot appear in the video — the footage will play under generic copy no matter how good it is. This step is the whole difference between a promo about the product and a promo about nothing in particular.

### How to watch it

You cannot play a video file directly, so turn it into things you can read. Work in a temporary directory outside the working directory, and delete it when you finish.

1. **Measure it.** Read duration, width, and height before anything else — they decide the template:

   ```bash
   ffprobe -v error -select_streams v:0 -show_entries stream=width,height:format=duration -of json <path>
   ```

2. **Pull frames where the picture changes**, then add a floor of one frame every few seconds so a slow stretch is not skipped:

   ```bash
   ffmpeg -v error -i <path> -vf "select='gt(scene,0.25)',scale=1280:-2" -vsync vfr <tmp>/change-%03d.jpg
   ffmpeg -v error -i <path> -vf "fps=1/3,scale=1280:-2" <tmp>/every3s-%03d.jpg
   ```

   For a recording longer than about a minute, use `fps=1/5`. Keep the frames legible — small text in a terminal or a settings page is exactly what the sensitive-content check below has to read.

3. **Look at every frame in order**, the way a viewer would meet them. Note the timestamp (frame number × interval) of each moment worth naming.
4. **Use the audio if there is one.** When the recording has narration and a transcription tool is available, transcribe it; the narrator usually names the capability the screen is showing. Do not upload audio anywhere to transcribe it.

If `ffmpeg` is not installed, say so and offer the install command for the user's platform. Do not install it yourself, and do not upload the recording to Angles or anywhere else to have it analysed — the frame check below has to happen before the file leaves the machine. If the user declines, ask them to describe what the recording shows, and still ask them to confirm it contains nothing sensitive.

Angles measures the recording again on upload — where the picture changes and where it stays still — and uses that to cut Screen Studio videos. That covers timing only. What the product does, and whether a frame is safe to publish, is yours to judge from the frames.

### What to write down

From the frames, write down:

- What the product lets someone **do** — concrete actions and outcomes, not a narration of cursor movements or a list of screens.
- The order the demo makes its point in, and where it lands.
- Any numbers, names, or claims visible on screen that are safe to repeat.
- The recording's **length**, which decides how much room the scenes have, and its **orientation**, which decides which templates can use it without cropping.
- Long stretches where nothing on screen changes (waiting for a build, a page loading). They decide whether to offer the concise edit in step 6.

### Check the frames before anything is uploaded

A recording carries whatever was on screen at the time, and an uploaded clip becomes a public URL. Look for:

- API keys, tokens, and anything in a `.env`, terminal, or devtools pane
- Real customer names, email addresses, and account identifiers
- Internal URLs, ticket numbers, and staging hostnames
- Billing and payment details
- Unrelated windows, tabs, bookmarks, and notification popups

If any appear, stop and tell the user what you found and roughly where, then ask them to trim or re-record. Do not upload the file, and do not repeat the exposed values in the summary or anywhere else.

### Produce the structured summary

- `productName`
- `productSummary`
- `targetAudience`
- `painPoint`
- `launchGoal`
- `notableFeatures` — the capabilities you saw, written as things a user can do. Treat it as required: a checklist scene with nothing concrete to list is downgraded to plain text and reported in `sceneWarnings`.
- `productUrl` — the product's public address, printed on the closing plate of several templates. The planner may not invent one, so without it those plates fall back to the brand name. Ask the user for it rather than reading it off a frame: an address caught in the recording may be a staging host or a signed-in deep link, and this one is printed on screen in a video they may publish.
- `aspectRatio`: `landscape` or `portrait`, matching the recording. A landscape capture placed in a portrait template is cropped or boxed, so follow the footage unless the user asks for a specific format.
- `preferredTemplateId`: include a colour suffix such as `screen_demo:signal` when the user chooses a palette.
- `backgroundMotif`: use one of the selected template's advertised decorative treatments; it is currently supported by `screen_demo`.

Ask one short question only when the product name, audience, or call to action cannot be inferred from the recording and the user's own words.

## 3. Choose a template that plays footage

List templates and pick one whose `media.acceptsClips` is true. Do not choose by name — templates are added regularly, and the `media` block is the field that answers whether an upload reaches the finished video:

```bash
node <skill-directory>/scripts/angles.mjs templates
```

- `media.acceptsClips` — uploaded footage appears in the render.
- `media.minimumClips` — the template refuses to render below this count. A template that requires a clip is built around footage and is usually the right pick here.
- `supportedAspects` — must include the orientation you took from the recording.

Do not read `imageSupport` or `videoSupport` for this. They describe scene slots for hand editing in the browser and answer a different question.

Recommend one and let the user confirm, unless they asked you to decide.

When `screen_studio` is in the list and passes the checks above, recommend it first. It is the template built for this job: the video's runtime follows the recording itself, cut at visual changes rather than stretched or trimmed to a fixed length, so the finished video shows the whole demo in the order it was recorded. Before recommending it, check two limits against what you noted in step 2:

- The recording plus a three-second close must fit in 90 seconds. A longer recording is refused rather than silently truncated. If you noted long still stretches, the concise edit in step 6 may bring it under; otherwise offer `screen_demo` or ask the user to trim.
- It is designed for landscape footage. For a portrait recording, confirm `supportedAspects` includes `portrait`, or recommend another footage template.

Fall back to `screen_demo` when `screen_studio` does not fit, or when the user wants a dark look or a background decoration.

Show the selected template's `colorVariants` and `backgroundMotifs` and ask for a colour and, when supported, a background decoration. Do not invent a motif name; use `none` for a clean background.

## 4. Generate concepts for that template

Write the structured context to a temporary JSON file outside the working directory, include `preferredTemplateId` and `aspectRatio`, then run:

```bash
node <skill-directory>/scripts/angles.mjs concepts --input <context.json>
```

Setting `preferredTemplateId` here is what makes the footage land in the plan. A scene plan is written for the template it was generated against, so a concept generated without it cannot be rendered with a footage template afterwards — the clip slots simply are not in the plan. If the user later wants a different template family, generate new concepts rather than reusing the `videoId`.

Present the returned concepts as a numbered list with each title, selling angle, and hook, and keep the chosen `videoId`. When `launchCopy` is present, show the short caption and the strongest platform post as part of the same asset.

## 5. Upload the recording

Save the output to a file in your temporary directory — the render needs what the upload measured, not only the URL:

```bash
node <skill-directory>/scripts/angles.mjs upload --file <path> > <tmp>/recording-upload.json
```

Upload only after the frame check in step 2, and only the file the user named.

Read the response before continuing:

- `transcoded: true` — Angles re-encoded the file to fit the render limits. Use the returned `url`.
- `warnings` — the clip is above the render limits and was not re-encoded. Report it rather than rendering past it.
- `width`, `height`, `fps` — confirm the orientation matches the template you chose.
- `recordingAnalysis` — where Angles found the picture changing and staying still. Absent means it could not measure; Screen Studio then plays the whole recording in evenly sized shots.
- An oversized file is refused locally with the 50MB limit and an `ffmpeg` command that gets it under. Offer the command; do not run it unless the user asks.

Pass the saved file, not the bare URL, as `--video-asset` from here on. Screen Studio refuses a clip that arrives without its measured duration.

## 6. Preview the render

Preview before every first render. It costs nothing, writes nothing, and can be repeated:

```bash
node <skill-directory>/scripts/angles.mjs preview \
  --video <video-id> \
  --template <template-id> \
  [--background-motif <motif>] \
  [--pacing <complete|concise>] \
  --video-asset <tmp>/recording-upload.json
```

For `screen_studio`, choose the pacing here:

- `complete` (the default) plays the whole recording in order.
- `concise` also removes still stretches of six seconds or more, keeping two seconds either side so the viewer sees what was being waited for and what happened next.

When `recordingAnalysis.pauses` lists any stretch, or you noted one in step 2, preview both and tell the user the two lengths — the sum of `scenes[].durationSeconds` — and what the concise edit leaves out. Let them choose. When there are no pauses the two edits are identical; do not offer the choice. `--pacing` is rejected by every other template.

- `canRender: false` — read `blockers` and fix them before spending anything.
- `unusedMedia` listing the recording — it would reach no scene. The render would succeed and the video would not contain the footage, which is the one outcome this Skill exists to avoid. Do not render; choose a template that has slots for it.
- `warnings` — scenes downgraded to a plain text layout. Report which ones and what they are missing.
- `scenes` — the shot list. Tell the user which scenes play their recording and which are typography.

## 7. Confirm and render

State that a render costs 30 credits from the account's balance, taken when it starts — every render, not only the first. If it fails before producing a video, Angles hands the credits back automatically. Require an explicit confirmation unless the user already said to render immediately and acknowledged the cost.

```bash
node <skill-directory>/scripts/angles.mjs render \
  --video <video-id> \
  --template <template-id> \
  [--background-motif <motif>] \
  [--pacing <complete|concise>] \
  --video-asset <tmp>/recording-upload.json \
  [--music <track-name|url|none>] \
  [--music-volume <0-1>] \
  --confirm
```

Pass the same asset and pacing the preview was run with. Media is part of the idempotency key, so re-rendering with a corrected recording is treated as a new render rather than a replay of the one it fixes.

Convert percentage volume to a decimal, for example 25% to `0.25`. Bundled track names are `Raising Me Higher`, `Motivating Mornings`, and `A Blue Day`. Footage-led templates often play the clip silent, so background music is worth offering.

## 8. Return the finished video

Query status periodically without starting another render:

```bash
node <skill-directory>/scripts/angles.mjs status --video <video-id>
```

- For `rendering`, report concise progress and continue checking at a reasonable interval.
- For `rendered`, return `videoUrl` and `downloadUrl` prominently.
- When `launchCopy` is present, include the platform-specific publish copy after the links.
- When `sceneWarnings` is present, say so before presenting the video. A `scene-content-contract-fallback` entry means that scene played as plain text instead of the layout it was written for.
- For `failed`, report the latest workflow error. Do not claim credits were spent unless the API explicitly reports it; a failed render's credits are handed back automatically.
- Always include `editUrl` as an optional path for detailed edits, not as a required step.

Read [api.md](api.md) only when troubleshooting inputs, status values, authentication, or API errors.
