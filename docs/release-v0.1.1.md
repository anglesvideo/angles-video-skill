# Angles Video Skill v0.1.1 — background music through the API

This release adds background-music controls to the repository-to-launch-video workflow without requiring a separate Angles web login.

## Highlights

- Choose one of three bundled music tracks during the Skill conversation.
- Use a custom HTTPS audio URL or explicitly request no background music.
- Set music volume as a percentage or a decimal from `0` to `1`.
- Apply the template, music, volume, and render confirmation with the existing Angles API key.
- Include music settings in the stable idempotency key so retries cannot silently change the requested mix.

Bundled tracks are `Raising Me Higher`, `Motivating Mornings`, and `A Blue Day`.

## Example

```text
Use the Aspiration template with A Blue Day at 25% volume. Ask me before rendering.
```

The Skill converts `25%` to `0.25` and submits the music settings only after the user explicitly confirms the video allowance.

## Install

Paste this into a Codex conversation:

```text
$skill-installer install https://github.com/shuicici/angles-video-skill/tree/main/skills/create-launch-video
```

For a manual Codex installation, clone the repository and link the Skill into `~/.agents/skills`. Existing clones can update with `git pull --ff-only origin main`.

## Verification

- Six bundled-client tests cover authentication, confirmation, stable render retries, named music tracks, volume validation, and unknown-track rejection.
- Seven backend service tests cover music persistence, idempotency conflicts, accepted renders, failed-render recovery, and retry behavior.
