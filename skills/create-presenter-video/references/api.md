# Angles Skill API reference

Use `https://api.angles.video/api/developer/v1` by default. Override it with `ANGLES_API_BASE_URL` only for an authorized staging or local environment.

Authenticate with `Authorization: Bearer $ANGLES_API_KEY`. Never place the key in repository files, prompts, logs, URLs, or command output.

## Commands and endpoints

| Client command | Endpoint                  | Purpose                                                                                                            |
| -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `concepts`     | `POST /concepts`          | Create three selectable selling-angle concepts from a structured product summary. Accepts `aspectRatio`, `preferredTemplateId`, `backgroundMotif`, and the real-material fields `productUrl`, `codeSample`, `codeLanguage`, `runSteps`. |
| `from-url`     | `POST /concepts/from-url` | Read a public product page and create the same three concepts from it. Accepts `url` plus optional `productName`, `targetAudience`, `launchGoal`, and the same generation options as `concepts`. |
| `templates`    | `GET /templates`          | List template metadata, colour variants, background motifs, and optional preview URLs.                                                                  |
| `upload`       | `POST /assets`            | Upload one local image or video and return a public HTTPS URL to pass to `preview` and `render`.                   |
| `script`       | `POST /videos/:id/script` / `GET /videos/:id/script` | Draft the per-scene script a presenter reads (POST, with `templateId`), or read where the draft and the recording stand (GET). |
| `script-text`  | `PATCH /videos/:id/scenes/:index/text` | Reword one sentence before it is recorded. |
| `take`         | `PUT /videos/:id/scenes/:index/take` | Upload one recorded sentence — picture and sound in one file — onto its scene. |
| `preview`      | `POST /videos/:id/render/preview` | Report what a render would do — blockers, downgraded scenes, and the asset bound to each scene — without rendering, writing, or spending an allowance. |
| `render`       | `POST /videos/:id/render` | Confirm a template/color variant, optionally set a background motif or music, and start an asynchronous render. Requires `Idempotency-Key`. |
| `status`       | `GET /videos/:id`         | Read `planned`, `rendering`, `rendered`, or `failed` state and final links.                                        |

`from-url` is for a product that can only be named by its address. Angles reads the page with the same importer the browser uses, writes the brief from it, and returns the concepts plus a `source` block carrying the `url`, the `productName` it settled on, the `targetAudience` it read, and any `productImages` it found on the page. Those screenshots are reported, not attached: pass the ones worth using to `render` as `productImages`. Fields sent in the request win over anything the page said, so an audience the caller knows is not overruled by vague marketing copy. A page that renders its content entirely in JavaScript is refused with `PAGE_UNREADABLE` rather than guessed at — describe the product with `concepts` instead.

Developer templates draw a terminal, a code window, and a list of run steps, and the planner is forbidden from writing what goes in them — a command invented for a video is a command that does not run. Supply `codeSample` (up to 600 characters, optionally with `codeLanguage`) and `runSteps` (up to 6, in order) and they are printed verbatim. Leave them out and those scenes fall back to visible placeholders — `// Add your real example`, `[DRAFT] Run the workflow` — which is the right prompt for someone editing in the browser and the wrong thing to publish straight from an API. `concepts` and `from-url` both accept them; a landing page never carries a working command, so on the URL path the caller's copy is the only source of one. Send only what is true: a sample that does not run is worse than the placeholder, which at least says it needs filling in.

`productUrl` is where the finished video sends its viewer. Several templates close on a full-frame destination — the one shot in a launch video that exists to be read and typed — and no stage is allowed to invent one: the planner may not write facts, and a repository URL is a different place to send someone. Send the product's public address and it is printed the way a person reads it aloud, without the scheme or a trailing slash. Leave it out and those plates fall back to the brand name, which is true but is not somewhere to go. `from-url` sets it from the page it read, so it is only worth sending on `concepts`.

`aspectRatio` and `preferredTemplateId` are the ways to control orientation and template. Orientation stated in prose is not read as an instruction, and a template chosen after generation cannot be applied to a scene plan written for a different one. A `preferredTemplateId` may include a colour suffix such as `screen_demo:signal`. A `preferredTemplateId` that cannot render the requested `aspectRatio` returns `400` naming both, before anything is generated or charged.

`backgroundMotif` is currently supported only by `screen_demo`. Available values are `none`, `corner_glow`, `side_light`, `orbit_ring`, `grid_field`, and `split_gradient`. Use `backgroundMotifs` from `GET /templates` as the source of truth.

Each template carries a `media` block answering whether uploads reach the finished video: `acceptsClips`, `acceptsImages`, `minimumClips`, and `minimumImages`. It is derived from the routing the renderer runs, so it is the field to filter on. The neighbouring `imageSupport` and `videoSupport` describe scene slots for hand editing in the browser and answer a different question — several templates publish image slots but route no uploaded image at render time.

`status` responses may include `sceneWarnings`: an array of `{ code, message, sceneIndex }` describing what the renderer had to change to fit the template. `scene-content-contract-fallback` means a scene was downgraded to a plain text layout because its required content was missing, which is the usual reason an uploaded image or clip does not appear in the finished video. `scene-content-contract-missing` names the specific `layoutPayload` field that was absent. The field is omitted when the plan needed no changes.

`concepts` and `status` responses may include `launchCopy`, a publishing pack derived from the selected video's title, hook, selling angle, caption, CTA, and product context. It includes a short caption, LinkedIn, X, TikTok, and YouTube Shorts copy, pinned-comment text, thumbnail text options, hashtags, optional hook alternatives, and `source` (`ai` or `fallback`). Use it directly when presenting the final launch asset.

## Audio for videos you render yourself

These endpoints serve the local path, where the agent writes and renders the video on the user's machine. They supply the one part of such a video that cannot be written as code. The workspace scripts call them — `scripts/voice.mjs` with the `angles` provider, and the `library` and `use` commands of `scripts/music.mjs` and `scripts/sfx.mjs` — so there is no client command for them.

| Endpoint | Purpose |
| --- | --- |
| `GET /audio/voices` | The voices a line can be spoken in, as `{ language, label, voice, description, default }`. Every supported language has one of its own (`default: true`) and may have other narrators. |
| `POST /audio/voice` | Speak one line. Body `{ text, voice?, language? }`, `text` up to 400 characters. `voice` is a name from `GET /audio/voices`; left out, the language's own speaks. Returns `{ audio, format, voice, provider, characters }` with `audio` base64-encoded. |
| `GET /audio/library` | The music and sound effects on offer: `{ version, updatedAt, music: [...], sfx: [...] }`. |

A voice has to be made for the words, so it is generated: one request is one line, because the caller measures each file to build its timeline and re-voices a single line when its wording changes. A `voice` shaped like the listed names that is not one of them returns `400` with `AUDIO_VOICE_UNKNOWN` and the names that are on offer, rather than being spoken in some other voice. `provider` names which voice provider spoke the line. Angles falls back to a second provider when its first fails, and a video whose voice changes part-way sounds broken — a line whose `provider` differs from the others should be voiced again. Voice lines do not spend a video allowance; an account has a daily limit instead, and going over it returns `429` with `AUDIO_DAILY_LIMIT_REACHED` and the numbers.

Music and sound effects are not generated per request. They come from a library made ahead of time and listened to by a person, so a track costs nothing and cannot come back sounding wrong. Each entry carries what is needed to choose it without downloading it:

- `music[]`: `id`, `mood`, `description`, `url`, `seconds`, `bpm`, `pulse` (0–1, how clear the beat is), `lifts` (`[{ at, rise }]`, the moments the track gets clearly louder) and `energy` (0–1, one value every four seconds).
- `sfx[]`: `id`, `family`, `kind`, `description`, `url`, `seconds`, and `hit` — how far into the sound its loudest moment is.

Every `url` is a plain download; fetch it without the API key. `503` means the library could not be read.

## Pictures for videos you render yourself

The other thing a video written as code cannot supply: a photograph or an illustration. `scripts/image.mjs` in the workspace calls this, so there is no client command for it.

| Endpoint | Purpose |
| --- | --- |
| `POST /images` | Make one picture. Body `{ prompt, aspect?, references? }`: `prompt` up to 1500 characters, saying what the picture shows and how it is drawn; `aspect` one of `16:9` (the default), `9:16`, `1:1`, `4:3`, `3:4`; `references` up to three pictures to draw from. Returns `{ image, format, aspect, provider, model, remaining }` with `image` base64-encoded and `format` one of `jpg`, `png`, `webp`. |

One request is one picture, and it can take half a minute. The reply is the file itself rather than a link, so nothing a caller keeps can stop working. `model` names what drew it: record it, and that the picture was made, beside the file. Pictures do not spend a video allowance; an account has a daily limit instead. `remaining` is how many are left in the current 24 hours, and going over returns `429` with `IMAGE_DAILY_LIMIT_REACHED` and the numbers. `503` means the picture could not be made — the provider failed, or refused the prompt — and is not counted against the limit: reword the prompt or try again.

A reference is a picture to draw from, given as the `url` that `POST /assets` returned when it was uploaded; any other link returns `400` with `IMAGE_REFERENCE_NOT_UPLOADED`. What is taken from it is whatever the prompt says to take. Told to keep the style and draw a different scene, the new picture comes back in the same medium and palette with nothing of the reference in it — which words alone do not manage from one request to the next. Told to draw the same place again, it keeps the place and its things and changes what the prompt changes. `scripts/image.mjs` does both: `--style` holds every picture in a workspace to the first one made, and `--like` draws one picture from another.

## Presenter videos

A presenter video is voiced by a person on camera instead of the synthesised voice, with their picture in a round window over the scenes. The person reads the script one sentence at a time, and each sentence is one scene.

1. `POST /videos/:id/script` with `{ "templateId": "..." }` fixes the scene plan for that template and returns straight away. Poll `GET /videos/:id/script` until `status` is `ready`. The other values are `drafting`, `failed` (with `error`), and `not_started` — a draft interrupted by a server restart; POST again. The plan is written for one template: POST with another template before anything is recorded and it is redrafted; once a take exists that returns `409`.

   The response lists `scenes`, each with `index`, `text`, `needsTake` (false for scenes with nothing to say), `targetSeconds` (the estimate for the synthesised voice — a take need not match it), and `take` (`null`, or `{ id, durationSeconds, presenter }`). `remainingSceneIndexes` lists the spoken scenes still without a take.

2. `PATCH /videos/:id/scenes/:index/text` with `{ "text": "..." }` rewords a sentence. The scene keeps its picture; only the words change. A line is refused when it is too long for one scene, or when it ends mid-sentence — the renderer would carry its last words into the next scene, and the caption would no longer match what was said. A scene that already has a take returns `409` unless the body also sends `"discardTake": true`, which deletes the take.

3. `PUT /videos/:id/scenes/:index/take` uploads one sentence as multipart `file` (mp4, mov, or webm, up to 50MB and 30 seconds). The file must carry both picture and sound: Angles takes the voice and the picture from the same recording, which is what keeps the lips in sync, so an audio-only file is refused and there is no way to send the two separately. Send `presenter=off` to keep the voice without showing the window on that scene.

   A take is a recording of a person, so it is kept out of public reach: unlike uploaded screenshots and clips, it is stored where a request without a signature gets nothing, and the URLs Angles hands out for it expire. The finished video is an ordinary public file like any other render — what is protected is the raw recording, not the video the user chose to make from it. A recording above 1920px or 30fps is re-encoded and comes back with `transcoded: true`. Uploading again for the same scene replaces its take.

4. `preview` and `render` as usual, with the template the script was drafted for. Once any take exists, every spoken scene needs one — a voice that switches between a person and the machine sounds like a fault — and a missing take or a different template is a `blocker` in preview and a `400` from render, before any allowance is reserved. A render repeated with an idempotency key used before a scene was re-recorded returns `409`; the bundled client's `render --presenter` folds the take ids into the key so this does not happen.

The window sits in the lower right by default. Moving it, or turning it off for particular scenes after the fact, is done in the browser editor from `editUrl`.

## Render options

The render body accepts `templateId`, `confirmed`, and these optional fields:

- `backgroundMusicUrl`: an HTTPS audio URL, or `null` to remove existing music.
- `backgroundMusicVolume`: a number from `0` (silent) to `1` (full volume).
- `backgroundMotif`: one of the values listed above. This changes the decorative layer while preserving the generated non-colour style pack.

- `productImages`: array of public HTTPS image URLs.
- `productVideos`: array of `{ "url": "https://...mp4" }`, optionally with the `durationSeconds`, `width`, `height`, and `recordingAnalysis` the upload returned. Screen Studio requires `durationSeconds` and uses `recordingAnalysis` to cut; without them it refuses the clip.
- `recordingPacing`: Screen Studio only. `complete` (the default for a first render) plays the whole recording; `concise` also removes visually static stretches of six seconds or more, keeping two seconds on each side. Omitting it keeps the edit the video already has. Any other template rejects the field.

The bundled client exposes them as `--music <track-name|url|none>`, `--music-volume <0-1>`, `--image-asset <https-url>`, `--video-asset <https-url|upload.json>`, and `--pacing <complete|concise>`. Pass `--video-asset` the file you saved the `upload` output to (`upload --file clip.mp4 > clip.json`) so the measured fields travel with the URL. Named tracks are `Raising Me Higher`, `Motivating Mornings`, and `A Blue Day`. Repeat the asset flags once per file.

A render owns the media kinds it names: sending `productVideos` replaces the project's clips rather than adding to them, so a retry that corrects a bad upload leaves nothing of the original behind. Naming neither kind leaves both untouched.

`preview` accepts the same body without `confirmed` and returns `canRender`, `blockers`, `warnings`, `unusedMedia`, and a `scenes` list carrying each scene's `sceneTemplate`, `assetUrl`, and `assetSource` (`uploaded_clip`, `uploaded_image`, or `generated`). `unusedMedia` lists URLs this request sent that no scene would show — the render would still succeed, just without them.

## Uploads

`upload --file <path>` sends one file as multipart. Accepted extensions are `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.mp4`, `.mov`, and `.webm`, up to 50MB; both limits are checked locally before any bytes are sent, and an oversized file is refused with an `ffmpeg` command that brings it under the ceiling.

The response carries `url`, `key`, `type`, and — when the file could be probed — `durationSeconds`, `width`, `height`, and `fps`. A video also carries `recordingAnalysis` when Angles could measure where the picture changes and where it stays still. A clip above the render limits (long edge over 1920px or frame rate over 30fps) is re-encoded server-side and comes back with `transcoded: true` describing the copy; use that `url`. Where the transcoder is unavailable the response carries `warnings` instead, and the clip is usable but may exhaust memory during the render.

## Common errors

- `401`: The API key is missing, invalid, expired, or revoked.
- `403`: The key lacks the required capability.
- `400`: Input, template, confirmation, or idempotency data is invalid.
- `429` with `VIDEO_QUOTA_EXCEEDED`: The account has no remaining video allowance.
- `503`: Rendering capacity is temporarily full; retry status or render later with the same idempotency key.
- `502`, `504`, `520`, `522`, `524`: A gateway timed out and the response is an error page, not an Angles reply. The client adds a `hint` explaining what it costs to retry. The request may still be completing on the server: only `render` spends a video allowance and a repeat with the same idempotency key counts as a retry, so retrying is safe for quota, but a repeated `concepts` can leave a duplicate project to delete later.

Do not automatically retry `400`, `401`, `403`, or quota errors. Retry transient server errors with the same idempotency key.

The client prints the rejected fields, not the exception name: a `400` reports every failing field, such as `productSummary should not be empty; property aspectRatio should not exist`, and repeats the raw response under `details`. Read that list before changing the request — a rejected field name is usually either a required field left out or a field Angles does not accept.
