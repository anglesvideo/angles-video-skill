---
name: create-launch-video
description: Turn the current software repository into an Angles product-launch video. Use when a user asks to make, generate, render, or draft a product video, launch video, feature announcement, demo video, or social video from the repository they are working in. Analyze safe product-facing repository context, create three selling-angle concepts, let the user choose an angle and template, explicitly confirm quota use, render through the Angles API, and return the final video link.
---

# Create an Angles launch video

Use the bundled `scripts/angles.mjs` client for every Angles API operation. Do not construct ad hoc HTTP requests unless the client is unavailable.

## 1. Check access

Require Node.js 18 or newer and `ANGLES_API_KEY`. If the key is missing, stop and direct the user to the Angles Integrations page. Never print, log, or include the key in tool arguments beyond the client process environment.

Use `ANGLES_API_BASE_URL` only when the user is testing a non-production Angles deployment.

## 2. Build safe product context

Read only the minimum product-facing context needed, normally:

- `README*`, product documentation, and public landing-page copy.
- Package manifests for product name and description.
- Changelog or recent user-visible changes when the user asks for a release video.
- A small number of relevant UI screenshots or public asset URLs when explicitly requested.

Do not read or submit `.env*`, credentials, private keys, database dumps, customer data, production logs, or unrelated source files. Do not upload raw repository files. Produce a structured summary with:

- `productName`
- `productSummary`
- `targetAudience`
- `painPoint`
- `launchGoal`
- `notableFeatures`
- `repositoryName` and public `repositoryUrl` when available

Ask one short question only when target audience or desired call to action cannot be inferred safely.

## 3. Generate concepts

Write the structured context to a temporary JSON file outside the repository, then run:

```bash
node <skill-directory>/scripts/angles.mjs concepts --input <context.json>
```

Present the returned concepts as a numbered list. Include each title, selling angle, hook, and recommended templates. Keep the `videoId` available for the next calls.

## 4. Get the user's choice

Ask the user to select one concept and one template. Recommend a default, but do not silently decide unless the user explicitly requests automatic selection. Also capture optional background-music preferences when provided. Accept a bundled track name, an HTTPS audio URL, or `none`; accept volume as either a percentage or a decimal from 0 to 1.

If more template detail is needed, run:

```bash
node <skill-directory>/scripts/angles.mjs templates --video <video-id>
```

Show available preview links when returned.

## 5. Confirm and render

Before rendering, state that Angles reserves one available video allowance when the first render starts. A successful first render consumes it; if that first render fails before producing a video, Angles releases the reservation automatically. Require an explicit confirmation unless the user already said to render immediately and acknowledged the cost.

Run:

```bash
node <skill-directory>/scripts/angles.mjs render \
  --video <video-id> \
  --template <template-id> \
  [--music <track-name|url|none>] \
  [--music-volume <0-1>] \
  --confirm
```

Convert percentage volume to a decimal, for example 25% to `0.25`. Bundled track names are `Raising Me Higher`, `Motivating Mornings`, and `A Blue Day`.

An API key is sufficient for template, music, volume, and rendering. Do not ask the user to log in merely to apply background music. Use `editUrl` only when the user explicitly wants browser-based editing or requests an editor-only feature.

The client derives a stable idempotency key by default. Reuse it for retries so a transient failure does not start a duplicate render.

## 6. Return the finished video

Query status periodically without starting another render:

```bash
node <skill-directory>/scripts/angles.mjs status --video <video-id>
```

- For `rendering`, report concise progress and continue checking at a reasonable interval.
- For `rendered`, return `videoUrl` and `downloadUrl` prominently.
- For `failed`, report the latest workflow error. Do not claim an allowance was consumed unless the API explicitly reports it; a failed first-render reservation should be released automatically. Offer one retry with the same idempotency key only after correcting deterministic configuration errors such as an unavailable renderer or timeout that is too short.
- Always include `editUrl` as an optional path for detailed edits, not as a required step.

Read [references/api.md](references/api.md) only when troubleshooting inputs, status values, authentication, or API errors.
