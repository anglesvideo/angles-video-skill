#!/usr/bin/env node

/**
 * `npx angles-video <url>` — a product page in, a launch video out.
 *
 * The Skills in this repository hand the JSON steps to a coding agent, which
 * writes the brief and reads the results back. Nobody is doing that here, so
 * this command trades flags for a conversation: it reads the page, shows what
 * each angle would say, and renders only the one that is chosen.
 */

import { createInterface } from 'node:readline/promises';
import { readFile, readdir } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';
import { GATEWAY_STATUSES, request } from '../../src/client.mjs';

// Overridable so the test suite does not spend five seconds per poll.
const POLL_INTERVAL_MS = Number(process.env.ANGLES_POLL_INTERVAL_MS) || 5000;
/** Long enough for the slowest template; past this the render is the server's problem, not ours. */
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const SIGN_UP_URL = 'https://angles.video/login?returnUrl=/developer-api';
const PROJECTS_URL = 'https://angles.video/projects';

const ESC = '[';
const isTty = Boolean(stdout.isTTY);
const paint = (code, text) => (isTty ? `${ESC}${code}m${text}${ESC}0m` : text);
const style = {
  dim: text => paint('2', text),
  bold: text => paint('1', text),
  green: text => paint('32', text),
  red: text => paint('31', text),
  yellow: text => paint('33', text),
};

/** How many downgraded scenes to name before summarising the rest. */
const MAX_LISTED_WARNINGS = 5;

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags[name] = true;
      continue;
    }
    flags[name] = next;
    index += 1;
  }
  return { flags, positional };
}

function usage() {
  return [
    '',
    `  ${style.bold('angles-video')} — turn a product page into a launch video`,
    '',
    '  Usage:',
    '    npx angles-video <url>',
    '',
    '  Options:',
    '    --concept <1-3>      render this angle without asking',
    '    --all                render every angle (spends one video each)',
    '    --audience <who>     who the video is for, when the page is vague',
    '    --product-name <n>   override the name read off the page',
    '    --code <command>     the real command to show on screen',
    '    --steps <a,b,c>      the real steps of running it, in order',
    '    --no-code            do not read a command from ./README',
    '    --template <id>      generate against a specific template',
    '    --portrait           9:16 instead of landscape',
    '    --no-images          ignore screenshots found on the page',
    '    --json               print the finished video as JSON',
    '    --help               show this message',
    '',
    `  Needs ${style.bold('ANGLES_API_KEY')}. Create one at ${SIGN_UP_URL}`,
    '',
  ].join('\n');
}

/** `before_after` reads as a column of code; `Before/After` reads as an angle. */
function lensLabel(lens) {
  if (!lens) return 'Angle';
  if (lens === 'before_after') return 'Before/After';
  return lens
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Whether this template puts uploaded screenshots in the finished video. */
function usesImages(template) {
  return Boolean(template?.media?.acceptsImages);
}

/** Shells whose first line is a command someone runs, not a program to read. */
const SHELL_LANGUAGES = new Set(['bash', 'sh', 'shell', 'console', 'zsh', 'terminal', '']);
const MAX_CODE_SAMPLE = 600;
/**
 * What the code sample is written in. It is always a command someone runs —
 * typed after --code, or the first line of a shell block — and left unsaid,
 * Angles labels the terminal it is drawn in as JavaScript.
 */
const COMMAND_LANGUAGE = 'bash';

/**
 * The product's real command, read from the README next to where this runs.
 *
 * Developer templates draw a terminal and Angles will not invent what goes in
 * it, so without a real command those scenes render a visible placeholder. The
 * README's first shell block is where a working invocation almost always is.
 *
 * Only a fenced block counts. Prose that looks like a command is usually a
 * description of one, and a command that does not run is worse in a video than
 * the placeholder, which at least says it needs filling in.
 */
async function readCommandFromReadme(directory) {
  let entries;
  try {
    entries = await readdir(directory);
  } catch {
    return null;
  }
  const name = entries.find(entry => /^readme(\.md|\.markdown|\.txt)?$/i.test(entry));
  if (!name) return null;

  let text;
  try {
    text = await readFile(`${directory}/${name}`, 'utf8');
  } catch {
    return null;
  }

  for (const match of text.matchAll(/^```([\w-]*)\r?\n([\s\S]*?)^```/gm)) {
    const language = match[1].toLowerCase();
    if (!SHELL_LANGUAGES.has(language)) continue;
    const line = match[2]
      .split('\n')
      .map(entry => entry.trim())
      .find(entry => entry && !entry.startsWith('#') && !entry.startsWith('//'));
    // A leading "$" is prompt decoration in a transcript, not part of the command.
    const command = line?.replace(/^\$\s*/, '');
    if (command && command.length <= MAX_CODE_SAMPLE) {
      return { command, source: name };
    }
  }
  return null;
}

function truncate(text, limit) {
  const value = (text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

function say(line = '') {
  stdout.write(`${line}\n`);
}

/**
 * The concept list, aligned so the angles can be compared down a column rather
 * than read as three paragraphs. Width is measured on the unstyled text: the
 * colour codes are zero-width on screen but not to `padEnd`.
 */
function printConcepts(concepts, screenshotCount = 0) {
  const rows = concepts.map((concept, index) => {
    const template = concept.recommendedTemplates?.[0];
    return {
      number: index + 1,
      lens: lensLabel(concept.creativeLens),
      hook: `"${truncate(concept.hook || concept.sellingAngle, 46)}"`,
      // Saying a template will use the screenshots is the only thing that makes
      // "8 screenshots found" actionable: most templates draw their own visuals
      // and ignore uploads entirely.
      template:
        template?.name +
        (screenshotCount && usesImages(template) ? ` · uses ${screenshotCount}` : ''),
    };
  });
  const lensWidth = Math.max(...rows.map(row => row.lens.length));
  const hookWidth = Math.max(...rows.map(row => row.hook.length));

  say();
  say(`  ${style.bold(`${concepts.length} angle${concepts.length === 1 ? '' : 's'}:`)}`);
  for (const row of rows) {
    say(
      `  ${row.number}) ${row.lens.padEnd(lensWidth)} — ` +
        `${row.hook.padEnd(hookWidth)}  ${style.dim(row.template)}`
    );
  }
}

async function askForConcept(concepts) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      const answer = (
        await rl.question(
          `\n  ${style.dim('Rendering spends 1 video from your allowance.')}\n` +
            `  Pick one (1-${concepts.length}), 'a' for all ${concepts.length}, or 'q' to quit: `
        )
      )
        .trim()
        .toLowerCase();

      if (answer === 'q' || answer === '') return [];
      if (answer === 'a') return concepts;
      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= concepts.length) {
        return [concepts[index - 1]];
      }
      say(style.red(`  Not an option: ${answer}`));
    }
  } finally {
    rl.close();
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Renders are dispatched and then run in the background, so the response to a
 * render says "rendering", not "rendered". Polling is what turns that into a
 * file the caller can open.
 */
async function waitForRender(videoId, onTick) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const video = await request(`/videos/${encodeURIComponent(videoId)}`);
    if (video.status !== 'rendering') return video;
    onTick?.();
  }
  throw new Error(
    `The render is still running after ${POLL_TIMEOUT_MS / 60000} minutes. ` +
      `It has not been lost — check it at ${PROJECTS_URL}.`
  );
}

function elapsed(startedAt) {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

async function renderConcept(concept, { productImages }) {
  const template = concept.recommendedTemplates?.[0];
  if (!template) {
    throw new Error(`No template was recommended for "${concept.title}".`);
  }

  const startedAt = Date.now();
  say();
  say(`  ${style.bold(lensLabel(concept.creativeLens))} ${style.dim(`· ${template.name}`)}`);
  stdout.write(`  Rendering… ${style.dim('(a minute or two)')}`);

  // Only templates that route uploads at render time may be sent images: the
  // rest reject the request outright. `media` is derived from that routing,
  // while `imageSupport` describes editor slots — several templates publish
  // slots they never fill from an upload, so filtering on it sends images to
  // a render that refuses them.
  const images = usesImages(template) ? productImages : [];

  try {
    await request(`/videos/${encodeURIComponent(concept.videoId)}/render`, {
      method: 'POST',
      // Stable for this video and template, so an interrupted run that is retried
      // is treated as the same render rather than charged a second time.
      headers: { 'Idempotency-Key': `cli-${concept.videoId}-${template.id}` },
      body: JSON.stringify({
        templateId: template.id,
        confirmed: true,
        ...(images.length ? { productImages: images } : {}),
      }),
    });
  } catch (error) {
    // A gateway timeout says the answer was lost, not that the render was. The
    // usual cause is a deploy restarting the server mid-request, and the render
    // is often already running. We hold the video id, so the state is one poll
    // away — giving up here would abandon a video the account may be paying for.
    if (!GATEWAY_STATUSES.has(error.status)) throw error;
    say();
    say(style.dim('  Angles did not answer in time; checking whether the render started…'));
  }

  const finished = await waitForRender(concept.videoId, () => {
    if (isTty) stdout.write('.');
  });
  say();

  if (finished.status === 'failed') {
    throw new Error(`The render failed. Open ${finished.editUrl} to see why.`);
  }
  // Still unstarted: the request never landed, so nothing was spent and the
  // same command is safe to run again.
  if (finished.status !== 'rendered' || !finished.videoUrl) {
    throw new Error(
      `The render never started (${concept.videoId} is "${finished.status}"). ` +
        `Nothing was spent — run the same command again. ${finished.editUrl}`
    );
  }
  say(`  ${style.green('✓')} ${finished.videoUrl} ${style.dim(elapsed(startedAt))}`);
  printSceneWarnings(finished.sceneWarnings);
  return finished;
}

/**
 * What the renderer had to change to fit the template.
 *
 * A downgraded scene is the difference between a video that shows the planned
 * content and one that quietly replaces it with placeholder text — and the
 * placeholder is visible in the finished file, so reporting a render as done
 * without saying this hands over a video whose defects only show on playback.
 */
function printSceneWarnings(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) return;

  const count = warnings.length;
  say(
    `  ${style.yellow('⚠')} ${count} scene${count === 1 ? '' : 's'} did not get what the ` +
      `template needed — the video may show placeholder text.`
  );
  for (const warning of warnings.slice(0, MAX_LISTED_WARNINGS)) {
    const where =
      typeof warning.sceneIndex === 'number' ? `scene ${warning.sceneIndex + 1}` : 'plan';
    say(style.dim(`      ${where}: ${warning.message}`));
  }
  if (count > MAX_LISTED_WARNINGS) {
    say(style.dim(`      …and ${count - MAX_LISTED_WARNINGS} more`));
  }
}

/**
 * What the CLI can tell Angles about the product's real surface.
 *
 * `--code` wins because it was typed for this video. Otherwise the README in
 * the working directory is read, which is right where someone running this
 * inside their own project keeps the command they would hand a new user.
 * Whatever is found is printed before anything is generated: it goes on screen
 * in the video, so it should not arrive as a surprise.
 */
async function resolveMaterial(flags) {
  const steps =
    typeof flags.steps === 'string'
      ? flags.steps
          .split(',')
          .map(step => step.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];

  if (typeof flags.code === 'string' && flags.code.trim()) {
    return {
      fields: {
        codeSample: flags.code.trim(),
        codeLanguage: COMMAND_LANGUAGE,
        ...(steps.length ? { runSteps: steps } : {}),
      },
    };
  }
  if (flags['no-code']) {
    return { fields: steps.length ? { runSteps: steps } : {} };
  }

  const found = await readCommandFromReadme(process.cwd());
  if (!found) {
    return { fields: steps.length ? { runSteps: steps } : {} };
  }
  return {
    found,
    fields: {
      codeSample: found.command,
      codeLanguage: COMMAND_LANGUAGE,
      ...(steps.length ? { runSteps: steps } : {}),
    },
  };
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (flags.help || positional.length === 0) {
    say(usage());
    process.exitCode = flags.help ? 0 : 1;
    return;
  }

  if (!process.env.ANGLES_API_KEY?.trim()) {
    throw new Error(
      `ANGLES_API_KEY is not set. Create a key at ${SIGN_UP_URL}, then:\n\n` +
        '    export ANGLES_API_KEY=angles_sk_…'
    );
  }

  const input = positional[0];
  let url;
  try {
    url = new URL(input.includes('://') ? input : `https://${input}`);
  } catch {
    throw new Error(`"${input}" is not a URL.`);
  }

  // A landing page never carries a working command, and the templates that draw
  // a terminal will not invent one — so this is the only chance to supply it.
  const material = await resolveMaterial(flags);

  say();
  stdout.write(`  Reading ${style.bold(url.hostname)}… `);
  const result = await request('/concepts/from-url', {
    method: 'POST',
    body: JSON.stringify({
      url: url.toString(),
      ...(typeof flags.audience === 'string' ? { targetAudience: flags.audience } : {}),
      ...(typeof flags['product-name'] === 'string' ? { productName: flags['product-name'] } : {}),
      ...(typeof flags.template === 'string' ? { preferredTemplateId: flags.template } : {}),
      ...(flags.portrait ? { aspectRatio: 'portrait' } : {}),
      ...material.fields,
    }),
  });

  const { concepts, source } = result;
  say(style.green('✓'));
  say(
    `  ${style.bold(source.productName)} ${style.dim(`— ${truncate(source.targetAudience, 56)}`)}`
  );
  if (material.found) {
    say(
      style.dim(
        `  Using this command from ${material.found.source}: ${truncate(material.found.command, 52)}`
      )
    );
  }

  const screenshotCount = flags['no-images'] ? 0 : source.productImages.length;
  if (screenshotCount) {
    const usable = concepts.some(concept => usesImages(concept.recommendedTemplates?.[0]));
    say(
      style.dim(
        `  ${screenshotCount} screenshot${screenshotCount === 1 ? '' : 's'} found on the page` +
          (usable ? '' : ' — none of these templates use uploads')
      )
    );
  }

  printConcepts(concepts, screenshotCount);

  let chosen;
  if (flags.all) {
    chosen = concepts;
  } else if (flags.concept !== undefined) {
    const index = Number(flags.concept);
    if (!Number.isInteger(index) || index < 1 || index > concepts.length) {
      throw new Error(`--concept must be a number from 1 to ${concepts.length}.`);
    }
    chosen = [concepts[index - 1]];
  } else if (!stdin.isTTY) {
    // A pipe or a CI job cannot answer a prompt, and a render spends real money.
    // Naming the angle is what makes that spend deliberate rather than default.
    say();
    say(
      `  Not a terminal, so nothing was rendered. Re-run with ` +
        `${style.bold('--concept <1-3>')} or ${style.bold('--all')}.`
    );
    say(style.dim(`  The concepts are saved: ${result.editUrl}`));
    return;
  } else {
    chosen = await askForConcept(concepts);
  }

  if (chosen.length === 0) {
    say(`\n  Nothing rendered. The concepts are saved: ${result.editUrl}`);
    return;
  }

  const productImages = flags['no-images'] ? [] : source.productImages;
  const finished = [];
  for (const concept of chosen) {
    finished.push(await renderConcept(concept, { productImages }));
  }

  if (flags.json) {
    say();
    say(JSON.stringify(finished.length === 1 ? finished[0] : finished, null, 2));
  } else {
    say();
    say(style.dim(`  Edit or re-render: ${result.editUrl}`));
  }
}

main().catch(error => {
  say();
  say(`  ${style.red('✗')} ${error.message}`);
  if (error.hint) say(`\n  ${style.dim(error.hint)}`);
  say();
  process.exitCode = 1;
});
