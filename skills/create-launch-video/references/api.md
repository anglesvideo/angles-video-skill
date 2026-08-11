# Angles Skill API reference

Use `https://api.angles.video/api/developer/v1` by default. Override it with `ANGLES_API_BASE_URL` only for an authorized staging or local environment.

Authenticate with `Authorization: Bearer $ANGLES_API_KEY`. Never place the key in repository files, prompts, logs, URLs, or command output.

## Commands and endpoints

| Client command | Endpoint                  | Purpose                                                                                                            |
| -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `concepts`     | `POST /concepts`          | Create three selectable selling-angle concepts from a structured product summary.                                  |
| `templates`    | `GET /templates`          | List template metadata and optional preview URLs.                                                                  |
| `render`       | `POST /videos/:id/render` | Confirm a template, optionally set background music, and start an asynchronous render. Requires `Idempotency-Key`. |
| `status`       | `GET /videos/:id`         | Read `planned`, `rendering`, `rendered`, or `failed` state and final links.                                        |

`concepts` and `status` responses may include `launchCopy`, a publishing pack derived from the selected video's title, hook, selling angle, caption, CTA, and product context. It includes a short caption, LinkedIn, X, TikTok, and YouTube Shorts copy, pinned-comment text, thumbnail text options, hashtags, optional hook alternatives, and `source` (`ai` or `fallback`). Use it directly when presenting the final launch asset.

## Render options

The render body accepts `templateId`, `confirmed`, and these optional fields:

- `backgroundMusicUrl`: an HTTPS audio URL, or `null` to remove existing music.
- `backgroundMusicVolume`: a number from `0` (silent) to `1` (full volume).

The bundled client exposes them as `--music <track-name|url|none>` and `--music-volume <0-1>`. Named tracks are `Raising Me Higher`, `Motivating Mornings`, and `A Blue Day`.

## Common errors

- `401`: The API key is missing, invalid, expired, or revoked.
- `403`: The key lacks the required capability.
- `400`: Input, template, confirmation, or idempotency data is invalid.
- `429` with `VIDEO_QUOTA_EXCEEDED`: The account has no remaining video allowance.
- `503`: Rendering capacity is temporarily full; retry status or render later with the same idempotency key.

Do not automatically retry `400`, `401`, `403`, or quota errors. Retry transient server errors with the same idempotency key.
