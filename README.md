# Angles Video Skill

Turn the software repository you are working in into a launch-ready Angles video without leaving Codex or Claude Code.

[See the integration guide](https://angles.video/integrations/codex) · [Create an Angles account](https://angles.video/login?returnUrl=/developer-api) · [Read the security policy](SECURITY.md)

![Angles repository launch-video template](https://angles.video/template-previews/github_video.png)

## What the Skill does

The Skill:

1. Reads the minimum product-facing repository context needed for a launch brief.
2. Sends a structured product summary—not raw repository files—to Angles.
3. Presents three distinct selling angles with hooks and recommended templates.
4. Waits for you to choose a concept and template.
5. Requires explicit confirmation before the first render reserves a video allowance.
6. Returns the finished video, download, and editor links.

## Install

### Codex with Skill Installer

Paste this into a Codex conversation:

```text
$skill-installer install https://github.com/shuicici/angles-video-skill/tree/main/skills/create-launch-video
```

Review the repository before installing any Skill that includes executable scripts. Start a new Codex conversation after installation if the Skill does not appear immediately.

### Manual installation

Clone the repository:

```bash
git clone --depth 1 https://github.com/shuicici/angles-video-skill.git ~/angles-video-skill
```

Install it for Codex:

```bash
mkdir -p ~/.agents/skills
ln -s ~/angles-video-skill/skills/create-launch-video ~/.agents/skills/create-launch-video
```

Or install it for Claude Code:

```bash
mkdir -p ~/.claude/skills
ln -s ~/angles-video-skill/skills/create-launch-video ~/.claude/skills/create-launch-video
```

## Connect your Angles account

Create an API key from the [Angles Integrations page](https://angles.video/login?returnUrl=/developer-api), then add it to your local shell environment:

```bash
export ANGLES_API_KEY="your-key"
```

Never commit the key to a repository. You can revoke it from the Integrations page at any time.

## Create a launch video

Open the software repository you want to promote and ask:

```text
Analyze this repository and create a 30-second product launch video. Show me three selling angles and recommended templates before rendering.
```

You can also request a more specific outcome:

```text
Create a vertical feature-announcement video from this repository for solo SaaS founders. Focus on the latest user-visible change and ask me before rendering.
```

The Skill will show the concepts first. A render starts only after you choose a direction and explicitly confirm the video allowance.

## Privacy and safety

The bundled client does not scan the repository. Your coding agent prepares the structured product summary locally and the client submits only that summary to Angles.

The Skill explicitly excludes:

- `.env` files and credentials
- Private keys and access tokens
- Database dumps and customer data
- Production logs
- Unrelated source files
- Raw repository uploads

Render retries use a stable idempotency key, so retrying a transient request does not silently start a duplicate render. See [SECURITY.md](SECURITY.md) for reporting guidance.

## Requirements and testing

- Node.js 18 or newer
- An Angles account and API key
- An available video allowance when you choose to render

Run the client tests:

```bash
node --test tests/client.test.mjs
```

## Links

- [Integration guide](https://angles.video/integrations/codex)
- [Angles website](https://angles.video)
- [Skill instructions](skills/create-launch-video/SKILL.md)
- [Developer API reference](skills/create-launch-video/references/api.md)
- [Security policy](SECURITY.md)
- [License](LICENSE)
