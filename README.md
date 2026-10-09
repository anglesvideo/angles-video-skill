# Angles Video

Product videos your coding agent writes itself.

Inside Codex or Claude Code, the agent reads your repository, collects what is true about the product, writes the script, designs every scene in [Remotion](https://www.remotion.dev), renders the video on your machine, and looks at its own frames before handing you the file. There is no template to pick and nothing to upload.

A template is designed before it has seen your product, so the one thing it can always fill is a headline and a paragraph. An agent that is already in your repository can draw what is really there: the numbers it can count, the command and what it prints, the interface as it is built.

Looking for the command-line tool? `npx angles-video <url>` renders a hosted template video from a product page — see [Command line](#command-line).

## Agent Skills

| Skill | Use it when |
| --- | --- |
| [`create-launch-video`](skills/create-launch-video) | The product is a repository you are working in or a page you can name. |
| [`create-video-from-recording`](skills/create-video-from-recording) | You have a screen recording of the product and want it cut into a finished video. |
| [`create-presenter-video`](skills/create-presenter-video) | You want to present the product yourself: the agent writes the script, you record it one sentence at a time, and it builds the video around your takes. |
| [`create-video-essay`](skills/create-video-essay) | The video is about a subject, not a product — a piece of history, an idea, how something works. The agent researches it, records every claim with its source, and draws it. |
| [`create-music-video`](skills/create-music-video) | You want a song and its video: lyrics built from what the song's audience really says, sung by a music model, and cut to on a stage of lights with every word arriving as it is sung. |

Writing and rendering need no account. A synthesised voice, a library of music and sound effects, and — for a music video — the song and the pictures of its singer come through your [Angles account](https://angles.video/login?returnUrl=/developer-api) — set `ANGLES_API_KEY`. Your own files, or a provider key of your own, work without one. [Read the security policy](SECURITY.md)

## How a video gets made

Every Skill follows the same eight steps, each producing a file the next one reads:

1. **Workspace** — a `video/` directory in your repository with Remotion installed. Created once.
2. **Facts** — what is true about the product today, each with where it came from. The only place a number on screen may come from.
3. **Script** — two or three angles to choose from, then eight to twelve short lines, opening on the viewer's problem. You approve it before anything is voiced.
4. **Voice and music** — a synthesised voice, your own recording, or none; the measured voice becomes the timeline every scene is cut to. Add a track and the agent finds its beats, moves every cut onto one, and starts the track where its lift lands on the line that turns the video.
5. **Look** — colours, type, frame, and captions, taken from your product. Written once and reused by every later video.
6. **Scenes** — written for this video only, each one built from the facts.
7. **Check** — the agent renders, pulls the frames where a picture has to be right, looks at them, and fixes what is wrong. The video is rendered in parts, so a fix costs one part rather than the whole render.
8. **Finish** — loudness brought to publishing level, and the file handed over with a caption and a post.

The workspace stays in your repository. Ask for another video next week and the agent keeps the look, takes fresh facts, and starts from the script.

`create-video-essay` takes the same steps for a subject instead of a product, and shows you four pictures before it writes the rest. Its facts come from sources the agent reads and keeps a copy of, its script tells a story that answers a question rather than choosing a selling angle, every quotation is checked against the copy of its source before anything is voiced, the video itself ends on a list of its sources, and it is handed over with titles, a description, and the same list.

The Skills ship mechanics only — timing, voice, beat analysis, frame extraction, loudness. Nothing in them is a design.

`create-music-video` is a different kind of video and takes different steps. It starts from words: the agent reads where the song's audience talks, counts which phrases many people say in the same words, and builds the lyrics on those — you agree them before any song is made. A music model sings them through your Angles account, twice, for 30 credits, and you choose the performance. The agent then measures the song: its bars, who is playing in each, and when each word is sung. The video is written against those measurements — a light changes because the kick stopped, a word appears because it was heard then — on a stage the Skill does ship: moving heads, washes, haze, a way of cutting still pictures of a drawn singer to the beat. What the lights do is written new for every song. You pick the singer from candidates, or have none.

Timing each word needs something that can hear, which the agent cannot. The Skill offers to install a listener on your machine — Whisper, about 3 GB, tried on Apple Silicon only, sending nothing anywhere — and without it places each line whole from the times you read off a player.

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

And for the presenter Skill:

```text
$skill-installer install https://github.com/anglesvideo/angles-video-skill/tree/main/skills/create-presenter-video
```

And for the video essay Skill:

```text
$skill-installer install https://github.com/anglesvideo/angles-video-skill/tree/main/skills/create-video-essay
```

And for the music video Skill:

```text
$skill-installer install https://github.com/anglesvideo/angles-video-skill/tree/main/skills/create-music-video
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
ln -s ~/angles-video-skill/skills/create-presenter-video ~/.agents/skills/create-presenter-video
ln -s ~/angles-video-skill/skills/create-video-essay ~/.agents/skills/create-video-essay
ln -s ~/angles-video-skill/skills/create-music-video ~/.agents/skills/create-music-video
```

Or install it for Claude Code:

```bash
mkdir -p ~/.claude/skills
ln -s ~/angles-video-skill/skills/create-launch-video ~/.claude/skills/create-launch-video
ln -s ~/angles-video-skill/skills/create-video-from-recording ~/.claude/skills/create-video-from-recording
ln -s ~/angles-video-skill/skills/create-presenter-video ~/.claude/skills/create-presenter-video
ln -s ~/angles-video-skill/skills/create-video-essay ~/.claude/skills/create-video-essay
ln -s ~/angles-video-skill/skills/create-music-video ~/.claude/skills/create-music-video
```

## Make a video

Open the repository you want to show and ask:

```text
Make a 40-second video about this project for developers who have not heard of it. Show me the angles first.
```

```text
We shipped three things this week. Make the update video.
```

Or name a product page instead of a repository:

```text
Make a launch video for https://example.com for solo SaaS founders.
```

Point at a recording:

```text
Turn ./demo.mov into a video for developers evaluating the product.
```

Or present it yourself:

```text
I want to present this one on camera. Write me the script and tell me what to record.
```

Or ask about a subject instead of a product:

```text
Make a four-minute video essay on why the Library of Alexandria really disappeared. Show me the sources and the throughlines first.
```

The agent asks before it installs anything, shows you the angles and the script before it voices them, and then works through to a finished file.

## Sound

**Voice**

- **Synthesised** — through your Angles account (`ANGLES_API_KEY`), or through ElevenLabs, OpenAI, or MiniMax with a key of your own already set in your environment. The agent says which service will receive the script before sending it. Through Angles a language has more than one narrator — a man and a woman — and the agent offers you the choice.
- **A name said wrong** is fixed on its own line: the agent respells it for the voice, the caption keeps it as written, and only that line is voiced again.
- **Your own** — record each line as its own file; sound only, or on camera with `create-presenter-video`.
- **None** — captions carry the words and each line is timed to how long it takes to read. Most feeds play muted.

**Music**

- **From the Angles library** — tracks made ahead of time and listened to by a person, each measured for tempo, beat, and where it lifts. The agent lists the ones that fit your video's length and can land a lift on the line where it turns, and picks by mood.
- **Your own track**, or a **new one** made with an ElevenLabs or MiniMax key of your own. The agent asks before spending your credits.
- Whichever it is, the track is analysed on your machine. Cuts are moved onto beats by lengthening pauses, never by shortening a line, and the music is kept under the voice automatically.
- A track with no clear beat is reported as one, and used as a bed rather than cut to.
- A video longer than one track takes a list of them, each taking over on a line you name and cut to on its own.

**Sound effects**

- **From the Angles library**, in families whose sounds belong together — one family per video. Or files you already have, or a new sound made with an ElevenLabs key of your own.
- Each is placed by the scene it belongs to, lined up on its loudest moment.

The library costs nothing to use. A voice line made through your Angles account costs 1 credit.

An agent can check a picture and cannot hear a mix, so it asks you to listen once before you publish.

## Pictures

Most of what a video shows is drawn as code — numbers, charts, terminals, interfaces, maps — because code is exact and it moves. A photograph or an illustration cannot be written that way. When a line needs one and you have none, the agent makes it through your Angles account (`ANGLES_API_KEY`).

- **One hand for the whole video.** The style is set once, in a sentence — the medium, the palette, the light. The first picture made becomes the one every later picture is drawn like, because words alone do not hold a style from one picture to the next.
- **The same place twice.** A picture can be drawn from another: the harbour at night, then the same harbour at dawn.
- **Only what cannot be drawn, and nothing that has to be true.** Never your product's interface, a screenshot, a logo, a chart, a number, or a real person. Those come from the product itself, or are left out.
- **A made picture says that it is one.** Each is recorded as generated. In a video essay it is an illustration, labelled on screen, and never stands in for a photograph or a document.
- The agent opens every picture before using it, and makes it again when something in it is wrong.

A picture costs 5 credits from your Angles account.

## Requirements

- Node.js 18 or newer.
- Room for the workspace: Remotion and a headless browser, a few hundred megabytes, installed inside `video/` on first use.
- An agent that can look at images, since the check step is done by eye.
- No `ffmpeg` needed; the scripts fall back to the build inside Remotion. A system `ffmpeg` adds scene detection when watching a screen recording.
- For `create-music-video` only: Python 3 with `numpy` and a system `ffmpeg`, which measure the song. Its listener is optional and is installed, if you agree to it, into the workspace.
- An Angles account only for what your machine cannot make: a synthesised voice, a picture, a song, or a hosted render. One balance of credits pays for all four — 1 for a voice line, 5 for a picture, 30 for a song, 30 for a hosted render — and a new account starts with 200. Rendering on your own machine costs nothing.

Remotion is free for individuals and for companies of up to three people. A larger company needs a [Remotion company licence](https://www.remotion.dev/docs/license); that licence is yours to hold and is not provided by these Skills.

## Privacy and safety

The video is written and rendered on your machine. The only thing the workflow sends anywhere is the script text, to the voice service you choose; through an Angles account it goes to Angles and on to the voice provider it uses. Music and sound effects are downloaded from a library, so nothing about your video is sent to get them — unless you ask for a new one made with your own provider key, which sends its description. A picture made through your Angles account sends its description, and the made picture it is drawn like when there is one; none of your own files are sent for it. With your own voice and your own music, and no picture made, nothing is sent. Screen recordings and camera takes stay local, and the workspace keeps them out of git. A music video sends the lyrics and the style of the song to the service that sings it, and the descriptions of the singer's pictures to the one that draws them; the listener that times the words runs on your machine.

The Skills tell the agent not to read or copy:

- `.env` files and credentials
- Private keys and access tokens
- Database dumps and customer data
- Production logs
- Source files unrelated to what the video shows

When the source is a product page, only the URL you name is read, and its text is treated as content to summarize rather than as instructions to follow. When it is a screen recording, the agent checks the frames for keys, customer names, internal URLs, and stray windows before using any of it, and stops to ask when it finds them. Before handing over, it checks the rendered frames again for anything that should not be published. When it is a subject to research, the agent reads public pages as data, records where each claim came from, and uses only pictures whose licence it can point to.

See [SECURITY.md](SECURITY.md) for reporting guidance.

## Hosted render with templates

The earlier path is still here for when a video cannot be rendered locally, or when you want an Angles template and the browser editor: the agent writes a summary of the product, Angles plans the scenes, fits them to a template, and renders in the cloud. Each product Skill carries it as `references/hosted-render.md` and takes it only when you ask or when the machine cannot render. `create-video-essay` has no hosted path.

It needs an Angles account, and each render costs 30 credits.

### Connect your Angles account

Create an API key from the [Angles Integrations page](https://angles.video/login?returnUrl=/developer-api), then add it to your local shell environment:

```bash
export ANGLES_API_KEY="your-key"
```

Never commit the key to a repository. You can revoke it from the Integrations page at any time.

### Check before you render

On the hosted path, every Skill previews the render before the first one starts. A preview costs nothing, changes nothing, and can be repeated. It answers the questions you would otherwise only be able to answer by paying for a render and watching the result:

- Would this template accept this concept at all?
- Which scene does each screenshot or recording land on?
- Is anything you uploaded going to be left out of the video entirely?
- Which scenes fall back to plain text because content is missing?

You do not have to ask for it. The Skill runs it and reports anything worth acting on before it asks you to confirm the credits.

### Add background music

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

### Calling the client directly

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

`preview` costs nothing. Only `render --confirm` spends credits. Render retries use a stable idempotency key, so retrying a transient request does not start a duplicate render.

### Example gallery

These videos were rendered on the hosted path, from public software repositories. New examples can be added as different products, audiences, selling angles, and visual treatments are explored.

| Video | Source | Selling angle | Template | Music | Format |
| --- | --- | --- | --- | --- | --- |
| [Launch Week, Different Rooms](https://cdn.angles.video/videos/498a95fc-e046-4c8a-a34a-ebe6d7f4dfe5.mp4) | angles.video | One product, different conversations for different audiences | Bento Grid | Motivating Mornings · 20% | Landscape · 14 scenes · ~36s |

Each example records the creative choices behind the output so future videos can demonstrate more than a change of visual style. Concepts, templates, music, and renders can all be selected and completed through the hosted path without requiring a browser login.

### Command line

The CLI is the hosted path without an agent: Angles reads a product page, proposes three selling angles, and renders the one you pick with one of its templates.

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

  Each render costs 30 credits.
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

## Development

```bash
npm test
```

### Changing shared files

Each Skill is installed from its own directory URL, so it has to carry its own
copy of everything it uses. `src/` holds the originals and the Skill copies are
generated:

| Source in `src/` | Copied into each Skill as |
| --- | --- |
| `writing-the-video.md` | `references/writing-the-video.md` — the workflow |
| `starter/` | `assets/starter/` — the workspace the video is written in |
| `client.mjs` | `scripts/angles.mjs` — the hosted-path client |
| `api.md` | `references/api.md` |

```bash
npm run sync-client
```

`create-music-video` is cut to a song rather than to a voice reading a script, so it has a workflow and a starter of its own — the stage, and the scripts that make, measure and time a song — which live in its directory and are not copied anywhere. From `src/starter/` it takes only what both kinds of video need: `media.mjs`, `music.mjs`, `image.mjs`, `finish.mjs`, `tsconfig.json` and `src/index.ts`. `scripts/sync-client.mjs` lists them.

`create-video-essay` has no hosted path, so it carries the workflow and the starter and leaves out the client and `api.md`. It also carries two scripts of its own, which live in its starter and are not copied anywhere: `read.mjs` keeps a text copy of each source, `check.mjs` holds the script against the facts and every quotation against those copies, and `handover.mjs` writes the subtitles, chapter times, source list, description and cover from them.

### The audio library

The music and sound effects the Skills offer are made ahead of time and listened to before they are published. [`tools/audio-library/library.json`](tools/audio-library/library.json) lists what the library should hold, with a prompt for each entry. Make a file per entry, name it after its id, and build:

```bash
node tools/audio-library/build.mjs <source-dir>
```

It brings every track to one loudness, trims and levels every sound, measures what a video is cut to — tempo, beat clarity, lifts, the hit of each sound — and writes `dist/audio-library/` with a `catalog.json`. Entries with no file yet are listed rather than failed, and an entry may have several takes (`<id>-a`, `<id>-b`), each kept as a track of its own. It also writes an `index.html` to listen through the whole library.

Sound effects are taken from sound packs released under CC0, not generated: each entry names the file it came from (`from`) and its licence, `--packs <dir>` says where the downloaded packs are, and the catalog carries the source and licence of every sound.

`tools/audio-library/generate.mjs <source-dir>` makes the music candidates with Suno through Evolink (`EVOLINK_API_KEY`), two takes a track, and writes a page to listen through them; `--pick` or `--keep-all` then moves the keepers to where the build reads them. A generation that was started is never started twice. Try the result before publishing with `ANGLES_LIBRARY_URL=dist/audio-library/catalog.json` in a workspace; publish by uploading the directory, `catalog.json` last. Needs `ffmpeg`.

### Narrators

Which voices an Angles account speaks in is decided on the server, but a voice is chosen by ear and an agent has none. `tools/narrators/audition.mjs` speaks one sentence in every voice listed in [`tools/narrators/candidates.json`](tools/narrators/candidates.json), beside each language's own, and writes a page to listen through with who spoke each line and how high the voice sits. A provider's name for a voice does not settle whether it is a man or a woman; the page does. `--offered` does the same for the narrators already on offer. Needs `ANGLES_API_KEY` and `ffmpeg`, and each sentence is one voice line, a credit each.

The CLI imports `src/client.mjs` directly. A Skill copy edited by hand fails the
test suite rather than shipping files the Skills disagree about.

## Links

- [Integration guide](https://angles.video/integrations/codex)
- [Angles website](https://angles.video)
- [The workflow every Skill follows](src/writing-the-video.md)
- [Launch video Skill instructions](skills/create-launch-video/SKILL.md)
- [Recording Skill instructions](skills/create-video-from-recording/SKILL.md)
- [Presenter Skill instructions](skills/create-presenter-video/SKILL.md)
- [Video essay Skill instructions](skills/create-video-essay/SKILL.md)
- [Music video Skill instructions](skills/create-music-video/SKILL.md)
- [Developer API reference](skills/create-launch-video/references/api.md)
- [Security policy](SECURITY.md)
- [License](LICENSE)
