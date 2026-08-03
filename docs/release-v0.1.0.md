# Angles Video Skill v0.1.0

Turn the software repository you are working in into a launch-ready product video from Codex or Claude Code.

## Included in this release

- Safe, repository-aware product context collection
- Three selling-angle concepts before rendering
- Template recommendations and preview support
- Explicit confirmation before a video allowance is reserved
- Stable idempotency keys for safe render retries
- Finished video, download, and editor links
- Node.js client tests covering authentication, confirmation, and retry behavior

## Install with Codex

Paste this into a Codex conversation:

```text
$skill-installer install https://github.com/shuicici/angles-video-skill/tree/main/skills/create-launch-video
```

Then create an API key from the [Angles Integrations page](https://angles.video/login?returnUrl=/developer-api) and ask:

```text
Analyze this repository and create a 30-second product launch video. Show me three selling angles and recommended templates before rendering.
```

Read the [integration guide](https://angles.video/integrations/codex) for manual Codex and Claude Code installation, privacy boundaries, and the complete workflow.
