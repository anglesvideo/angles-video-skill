# Distribution kit

Use this document when publishing the Angles Video Skill outside the repository. Keep claims tied to the current public workflow and link to the integration guide for installation.

## GitHub repository metadata

**Description**

> Turn a software repository into three selling angles and a launch-ready Angles video from Codex or Claude Code.

**Homepage**

> https://angles.video/integrations/codex

**Topics**

```text
agent-skill
codex-skill
claude-code
ai-video
product-launch
saas-marketing
developer-tools
```

## GitHub Release

- Tag: `v0.1.0`
- Title: `Angles Video Skill v0.1.0 — repository to launch video`
- Notes: [`release-v0.1.0.md`](release-v0.1.0.md)

After authenticating GitHub CLI, the repository owner can apply the metadata and create the release with:

```bash
gh repo edit shuicici/angles-video-skill \
  --description "Turn a software repository into three selling angles and a launch-ready Angles video from Codex or Claude Code." \
  --homepage "https://angles.video/integrations/codex" \
  --add-topic agent-skill \
  --add-topic codex-skill \
  --add-topic claude-code \
  --add-topic ai-video \
  --add-topic product-launch \
  --add-topic saas-marketing \
  --add-topic developer-tools

gh release create v0.1.0 \
  --repo shuicici/angles-video-skill \
  --title "Angles Video Skill v0.1.0 — repository to launch video" \
  --notes-file docs/release-v0.1.0.md
```

## Short social post

> Your product is already described somewhere in the repository. The hard part is deciding what to say about it.
>
> I built an open-source Agent Skill that lets Codex or Claude Code read safe product-facing context, propose three different selling angles, recommend video templates, and render the direction you choose with Angles.
>
> It does not upload raw repository files, and it asks before using a video allowance.
>
> GitHub: https://github.com/shuicici/angles-video-skill
> Guide: https://angles.video/integrations/codex

## LinkedIn post

> Building the product and explaining the product are different jobs.
>
> When a founder finishes a feature, most of the useful launch context already exists across the README, public docs, package description, and changelog. The missing step is turning that context into a message people care about.
>
> We have released the Angles Video Skill for Codex and Claude Code. It keeps the workflow inside the repository:
>
> 1. Read a small amount of safe, product-facing context.
> 2. Generate three genuinely different selling angles.
> 3. Review the hooks and recommended templates.
> 4. Choose one direction.
> 5. Confirm before rendering the launch video.
>
> Raw repository files are not uploaded to Angles. The coding agent prepares a structured product summary locally, and the Skill explicitly excludes environment files, credentials, private keys, customer data, database dumps, and production logs.
>
> The Skill is open source: https://github.com/shuicici/angles-video-skill
>
> Installation and workflow guide: https://angles.video/integrations/codex

## Reddit or community post

**Title**

> I made an open-source Codex Skill that turns a repository into three launch-video concepts

**Body**

> I kept running into the same problem after shipping a feature: the repository contains enough product context, but turning it into a clear launch message still starts from a blank page.
>
> I built a small Agent Skill for Codex and Claude Code. It reads only product-facing context such as the README, public docs, package description, and changelog; prepares a structured product summary locally; and returns three different selling angles with hooks and recommended video templates.
>
> Nothing renders until the user chooses a concept and explicitly confirms the video allowance. The client also uses a stable idempotency key for retries.
>
> The Skill and client are public here: https://github.com/shuicici/angles-video-skill
>
> The install guide and privacy boundary are here: https://angles.video/integrations/codex
>
> I would especially value feedback on the install flow and whether the three-angle review step is useful before rendering.

## Show HN draft

**Title**

> Show HN: An Agent Skill that turns a software repository into launch-video concepts

**Body**

> Angles Video Skill is an open-source Skill for Codex and Claude Code. It uses product-facing repository context to prepare three distinct selling-angle concepts, then lets the user choose a template and confirm before rendering a launch video through Angles.
>
> The client does not scan or upload raw repository files. The coding agent prepares a structured summary locally and excludes environment files, credentials, private keys, database dumps, customer data, production logs, and unrelated source files.
>
> GitHub: https://github.com/shuicici/angles-video-skill
>
> Guide: https://angles.video/integrations/codex
>
> The main thing I am testing is whether reviewing multiple messages inside the coding workflow is more useful than jumping directly from repository context to one generated video.

## Directory submissions

Prepare one focused pull request or submission for each relevant directory. Start with:

- Awesome Agent Skills: https://github.com/junminhong/awesome-agent-skills
- Other directories that accept open Agent Skills and link directly to the source repository

Use the repository description above, categorize it under Creative & Media or Business & Marketing, and disclose that rendering requires an Angles account and available allowance.

## Launch measurement

Use tagged links for each distribution channel and monitor:

- Integration-guide visits
- GitHub outbound clicks
- API keys created from the integration page
- Successful concept requests
- First render confirmations
- Installation or authentication issues reported in GitHub Issues

Do not evaluate a channel only by impressions or repository stars. The primary activation event is a successful concept request; the value event is a confirmed finished render.
