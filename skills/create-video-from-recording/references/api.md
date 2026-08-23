# Angles Skill API reference

Use `https://api.angles.video/api/developer/v1` by default. Override it with `ANGLES_API_BASE_URL` only for an authorized staging or local environment.

Authenticate with `Authorization: Bearer $ANGLES_API_KEY`. Never place the key in repository files, prompts, logs, URLs, or command output.

## Commands and endpoints

| Client command | Endpoint                  | Purpose                                                                                                            |
| -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `concepts`     | `POST /concepts`          | Create three selectable selling-angle concepts from a structured product summary. Accepts `aspectRatio`, `preferredTemplateId`, and `backgroundMotif`. |
| `templates`    | `GET /templates`          | List template metadata, colour variants, background motifs, and optional preview URLs.                                                                  |
| `upload`       | `POST /assets`            | Upload one local image or video and return a public HTTPS URL to pass to `preview` and `render`.                   |
| `preview`      | `POST /videos/:id/render/preview` | Report what a render would do — blockers, downgraded scenes, and the asset bound to each scene — without rendering, writing, or spending an allowance. |
| `render`       | `POST /videos/:id/render` | Confirm a template/color variant, optionally set a background motif or music, and start an asynchronous render. Requires `Idempotency-Key`. |
| `status`       | `GET /videos/:id`         | Read `planned`, `rendering`, `rendered`, or `failed` state and final links.                                        |

`aspectRatio` and `preferredTemplateId` are the ways to control orientation and template. Orientation stated in prose is not read as an instruction, and a template chosen after generation cannot be applied to a scene plan written for a different one. A `preferredTemplateId` may include a colour suffix such as `screen_demo:signal`. A `preferredTemplateId` that cannot render the requested `aspectRatio` returns `400` naming both, before anything is generated or charged.

`backgroundMotif` is currently supported only by `screen_demo`. Available values are `none`, `corner_glow`, `side_light`, `orbit_ring`, `grid_field`, and `split_gradient`. Use `backgroundMotifs` from `GET /templates` as the source of truth.

Each template carries a `media` block answering whether uploads reach the finished video: `acceptsClips`, `acceptsImages`, `minimumClips`, and `minimumImages`. It is derived from the routing the renderer runs, so it is the field to filter on. The neighbouring `imageSupport` and `videoSupport` describe scene slots for hand editing in the browser and answer a different question — several templates publish image slots but route no uploaded image at render time.

`status` responses may include `sceneWarnings`: an array of `{ code, message, sceneIndex }` describing what the renderer had to change to fit the template. `scene-content-contract-fallback` means a scene was downgraded to a plain text layout because its required content was missing, which is the usual reason an uploaded image or clip does not appear in the finished video. `scene-content-contract-missing` names the specific `layoutPayload` field that was absent. The field is omitted when the plan needed no changes.

`concepts` and `status` responses may include `launchCopy`, a publishing pack derived from the selected video's title, hook, selling angle, caption, CTA, and product context. It includes a short caption, LinkedIn, X, TikTok, and YouTube Shorts copy, pinned-comment text, thumbnail text options, hashtags, optional hook alternatives, and `source` (`ai` or `fallback`). Use it directly when presenting the final launch asset.

## Render options

The render body accepts `templateId`, `confirmed`, and these optional fields:

- `backgroundMusicUrl`: an HTTPS audio URL, or `null` to remove existing music.
- `backgroundMusicVolume`: a number from `0` (silent) to `1` (full volume).
- `backgroundMotif`: one of the values listed above. This changes the decorative layer while preserving the generated non-colour style pack.

- `productImages`: array of public HTTPS image URLs.
- `productVideos`: array of `{ "url": "https://...mp4" }`.

The bundled client exposes them as `--music <track-name|url|none>`, `--music-volume <0-1>`, `--image-asset <https-url>`, and `--video-asset <https-url>`. Named tracks are `Raising Me Higher`, `Motivating Mornings`, and `A Blue Day`. Repeat the asset flags once per file.

A render owns the media kinds it names: sending `productVideos` replaces the project's clips rather than adding to them, so a retry that corrects a bad upload leaves nothing of the original behind. Naming neither kind leaves both untouched.

`preview` accepts the same body without `confirmed` and returns `canRender`, `blockers`, `warnings`, `unusedMedia`, and a `scenes` list carrying each scene's `sceneTemplate`, `assetUrl`, and `assetSource` (`uploaded_clip`, `uploaded_image`, or `generated`). `unusedMedia` lists URLs this request sent that no scene would show — the render would still succeed, just without them.

## Uploads

`upload --file <path>` sends one file as multipart. Accepted extensions are `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.mp4`, `.mov`, and `.webm`, up to 50MB; both limits are checked locally before any bytes are sent, and an oversized file is refused with an `ffmpeg` command that brings it under the ceiling.

The response carries `url`, `key`, `type`, and — when the file could be probed — `durationSeconds`, `width`, `height`, and `fps`. A clip above the render limits (long edge over 1920px or frame rate over 30fps) is re-encoded server-side and comes back with `transcoded: true` describing the copy; use that `url`. Where the transcoder is unavailable the response carries `warnings` instead, and the clip is usable but may exhaust memory during the render.

## Common errors

- `401`: The API key is missing, invalid, expired, or revoked.
- `403`: The key lacks the required capability.
- `400`: Input, template, confirmation, or idempotency data is invalid.
- `429` with `VIDEO_QUOTA_EXCEEDED`: The account has no remaining video allowance.
- `503`: Rendering capacity is temporarily full; retry status or render later with the same idempotency key.
- `502`, `504`, `520`, `522`, `524`: A gateway timed out and the response is an error page, not an Angles reply. The client adds a `hint` explaining what it costs to retry. The request may still be completing on the server: only `render` spends a video allowance and a repeat with the same idempotency key counts as a retry, so retrying is safe for quota, but a repeated `concepts` can leave a duplicate project to delete later.

Do not automatically retry `400`, `401`, `403`, or quota errors. Retry transient server errors with the same idempotency key.

The client prints the rejected fields, not the exception name: a `400` reports every failing field, such as `productSummary should not be empty; property aspectRatio should not exist`, and repeats the raw response under `details`. Read that list before changing the request — a rejected field name is usually either a required field left out or a field Angles does not accept.
