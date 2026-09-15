# Angles Video

Turn a product page, a software repository, or a screen-recorded demo into a launch-ready Angles video.

## Command line

One URL in, three selling angles out. Pick the one worth rendering:

```bash
npx angles-video https://yourproduct.com
```

```text
  Reading yourproduct.com… ✓
  MyApp — Freelancers who invoice clients
  2 screenshots found on the page

  3 angles:
  1) Before/After — "Stop chasing invoices for weeks"        Bento Grid
  2) Use Case     — "Send your first invoice in 60 seconds"  Screen Demo
  3) Clarity      — "Invoicing, minus the spreadsheet"       Dynamic

  Rendering spends 1 video from your allowance.
  Pick one (1-3), 'a' for all 3, or 'q' to quit:
```

Angles reads the page, writes the brief from it, and reuses any screenshots it
finds. Nothing renders until an angle is chosen — and in a pipe or a CI job,
where no one can answer, nothing renders at all unless `--concept` or `--all`
names one.

Templates that draw a terminal need a command that actually runs, and Angles
will not invent one — an invented command is a command that fails in front of
your audience. Run this from your project and the first shell block in the
README is used, printed before anything is generated so it is never a surprise;
`--code` overrides it and `--no-code` turns it off. Without a command those
scenes render a visible `[DRAFT]` placeholder, and the CLI says which ones did.

| Option | |
| --- | --- |
| `--concept <1-3>` | render this angle without asking |
| `--all` | render every angle (spends one video each) |
| `--audience <who>` | who the video is for, when the page is vague |
| `--product-name <name>` | override the name read off the page |
| `--code <command>` | the real command to show on screen (defaults to the first shell block in `./README`) |
| `--steps <a,b,c>` | the real steps of running it, in order |
| `--no-code` | do not read a command from `./README` |
| `--template <id>` | generate against a specific template |
| `--portrait` | 9:16 instead of landscape |
| `--no-images` | ignore screenshots found on the page |
| `--json` | print the finished video as JSON |

Needs `ANGLES_API_KEY` — [create one here](https://angles.video/login?returnUrl=/developer-api),
then `export ANGLES_API_KEY=angles_sk_…`.

## Agent Skills

Inside Codex or Claude Code, two Skills share the same client and let the agent
write the brief from the repository it is already working in:

| Skill | Use it when |
| --- | --- |
| [`create-launch-video`](skills/create-launch-video) | The product is a repository you are working in or a page you can name. |
| [`create-video-from-recording`](skills/create-video-from-recording) | You already have a screen recording of the product and want it in the video. |

[See the integration guide](https://angles.video/integrations/codex) · [Create an Angles account](https://angles.video/login?returnUrl=/developer-api) · [Read the security policy](SECURITY.md)

![Angles repository launch-video template](https://angles.video/template-previews/github_video.png)

## What the Skills do

Both Skills:

1. Read the minimum product-facing context needed for a launch brief — from the repository, the page you name, or the recording you point at.
2. Send a structured product summary—not raw files, pages, or footage—to Angles.
3. Present distinct selling angles with hooks and recommended templates.
4. Wait for you to choose a concept, template, and optional background music.
5. Upload any screenshots or recording you want in the video.
6. Preview what the render will produce—which scene each upload lands on, and what would be left out—before any allowance is spent.
7. Require explicit confirmation before the first render reserves a video allowance.
8. Return the finished video, download, and editor links.

Your agent does the analysis. Reading a page or watching a recording happens locally, in the agent you are already using; Angles receives the summary it writes, never the source. A capability the agent does not name is one the script cannot mention, which is why `create-video-from-recording` watches the recording rather than merely uploading it.

## Example gallery

These videos were generated from public software repositories with `create-launch-video`. New examples can be added as different products, audiences, selling angles, and visual treatments are explored.

| Video | Source | Selling angle | Template | Music | Format |
| --- | --- | --- | --- | --- | --- |
| [Launch Week, Different Rooms](https://cdn.angles.video/videos/498a95fc-e046-4c8a-a34a-ebe6d7f4dfe5.mp4) | angles.video | One product, different conversations for different audiences | Bento Grid | Motivating Mornings · 20% | Landscape · 14 scenes · ~36s |

Each example records the creative choices behind the output so future videos can demonstrate more than a change of visual style. Concepts, templates, music, and renders can all be selected and completed through the Skill without requiring a browser login.

## Install

### Codex with Skill Installer

Paste this into a Codex conversation:

```text
$skill-installer install https://github.com/anglesvideo/angles-video-skill/tree/main/skills/create-launch-video
```

For the recording Skill, install the other directory the same way:

```text
$skill-installer install https://github.com/anglesvideo/angles-video-skill/tree/main/skills/create-video-from-recording
```

Review the repository before installing any Skill that includes executable scripts. Start a new Codex conversation after installation if the Skill does not appear immediately.

### Manual installation

Clone the repository:

```bash
git clone --depth 1 https://github.com/anglesvideo/angles-video-skill.git ~/angles-video-skill
```

Install it for Codex:

```bash
mkdir -p ~/.agents/skills
ln -s ~/angles-video-skill/skills/create-launch-video ~/.agents/skills/create-launch-video
ln -s ~/angles-video-skill/skills/create-video-from-recording ~/.agents/skills/create-video-from-recording
```

Or install it for Claude Code:

```bash
mkdir -p ~/.claude/skills
ln -s ~/angles-video-skill/skills/create-launch-video ~/.claude/skills/create-launch-video
ln -s ~/angles-video-skill/skills/create-video-from-recording ~/.claude/skills/create-video-from-recording
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

Or name a product page instead of a repository:

```text
Create a launch video for https://example.com for solo SaaS founders. Show me the angles before rendering.
```

The Skill will show the concepts first. A render starts only after you choose a direction and explicitly confirm the video allowance.

## Create a video from a screen recording

Point at the file and ask:

```text
Turn ./demo.mov into a promo video for developers evaluating the product.
```

The Skill watches the recording to write the script, tells you if any frame shows something that should not be published, picks a template that plays footage, and shows you which scenes your recording lands on before anything is rendered.

## Check before you render

Both Skills preview the render before the first one starts. A preview costs nothing, changes nothing, and can be repeated. It answers the questions you would otherwise only be able to answer by spending an allowance and watching the result:

- Would this template accept this concept at all?
- Which scene does each screenshot or recording land on?
- Is anything you uploaded going to be left out of the video entirely?
- Which scenes fall back to plain text because content is missing?

You do not have to ask for it. The Skill runs it and reports anything worth acting on before it asks you to confirm the allowance.

## Add background music

Include a music preference in your request or provide it after choosing a concept and template:

```text
Use the Aspiration template with A Blue Day at 25% volume. Ask me before rendering.
```

Bundled tracks:

- `Raising Me Higher` — uplifting corporate
- `Motivating Mornings` — bright and optimistic
- `A Blue Day` — smooth and cinematic

You can also provide a custom HTTPS audio URL or request `none`. Music volume can be written as a percentage or a decimal from `0` to `1`; the Skill converts percentages before calling the API.

An API key is sufficient to set the template, background music, volume, and start rendering. You do not need to sign in to the Angles web editor unless you want to make browser-based edits.

Advanced users can call the bundled client directly:

```bash
node skills/create-launch-video/scripts/angles.mjs upload --file ./demo.mp4
```

```bash
node skills/create-launch-video/scripts/angles.mjs preview \
  --video "your-video-id" \
  --template screen_demo \
  --video-asset "https://cdn.angles.video/..."
```

```bash
node skills/create-launch-video/scripts/angles.mjs render \
  --video "your-video-id" \
  --template frame_liquid_bg_hero \
  --music "A Blue Day" \
  --music-volume 0.25 \
  --confirm
```

`preview` spends no allowance. Only `render --confirm` does.

## Privacy and safety

The bundled client does not scan the repository, fetch the page, or read the recording. Your coding agent prepares the structured product summary locally and the client submits only that summary to Angles.

The Skill explicitly excludes:

- `.env` files and credentials
- Private keys and access tokens
- Database dumps and customer data
- Production logs
- Unrelated source files
- Raw repository uploads

When the source is a product page, only the URL you name is read, and its text is treated as content to summarize rather than as instructions to follow. When it is a screen recording, the agent checks the frames for keys, customer names, internal URLs, and stray windows before anything is uploaded, and stops to ask rather than uploading a recording that shows them.

Render retries use a stable idempotency key, so retrying a transient request does not silently start a duplicate render. See [SECURITY.md](SECURITY.md) for reporting guidance.

## Requirements and testing

- Node.js 18 or newer
- An Angles account and API key
- An available video allowance when you choose to render

Run the tests:

```bash
npm test
```

### Changing the client

Each Skill is installed from its own directory URL, so it has to ship the client
rather than import a shared one. `src/` holds the originals — `src/client.mjs`
and `src/api.md` — and the Skill copies are generated:

```bash
npm run sync-client
```

The CLI imports `src/client.mjs` directly. A Skill copy edited by hand fails the
test suite rather than shipping a client the CLI and the Skills disagree about.

## Links

- [Integration guide](https://angles.video/integrations/codex)
- [Angles website](https://angles.video)
- [Launch video Skill instructions](skills/create-launch-video/SKILL.md)
- [Recording Skill instructions](skills/create-video-from-recording/SKILL.md)
- [Developer API reference](skills/create-launch-video/references/api.md)
- [Security policy](SECURITY.md)
- [License](LICENSE)
