# Angles Video Skill

Turn the software repository you are working in into a launch-ready Angles video from Codex or Claude Code.

The Skill reads product-facing repository context locally, sends only a structured product summary to Angles, presents three selling angles and template choices, and starts rendering only after confirmation.

## Install

Clone the repository:

```bash
git clone --depth 1 https://github.com/shuicici/angles-video-skill.git ~/angles-video-skill
```

Install it for Codex:

```bash
mkdir -p ~/.codex/skills
ln -s ~/angles-video-skill/skills/create-launch-video ~/.codex/skills/create-launch-video
```

Or install it for Claude Code:

```bash
mkdir -p ~/.claude/skills
ln -s ~/angles-video-skill/skills/create-launch-video ~/.claude/skills/create-launch-video
```

Create an API key from the Angles Integrations page and configure it in your shell:

```bash
export ANGLES_API_KEY="your-key"
```

Then ask:

```text
Analyze this repository and create a 30-second product launch video. Show me three angles and recommended templates before rendering.
```

## Privacy

The bundled client does not scan the repository. The coding agent prepares a structured product summary and the client submits that summary to Angles. The Skill explicitly excludes environment files, credentials, private keys, database dumps, customer data, and unrelated source code.

## Requirements and testing

- Node.js 18 or newer
- An Angles API key

Run the client tests with:

```bash
node --test tests/client.test.mjs
```
