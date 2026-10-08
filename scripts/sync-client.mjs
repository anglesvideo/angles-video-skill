#!/usr/bin/env node

/**
 * Copies the shared files into every Skill that ships them: the workflow for
 * writing a video, the starter workspace it is written in, and — for the
 * Skills that have a hosted path — its client and API reference.
 *
 * Each Skill is installed from its own directory URL, so it has to carry these
 * files rather than import a shared copy — which is why the duplicates exist at
 * all. Everything in `src/` is the source they are copied from; the test suite
 * fails if a copy drifts, so editing a copy by hand is caught, not shipped.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Source file in `src/` → the path it is copied to inside each Skill. */
export const SHARED_FILES = new Map([
  ['src/client.mjs', 'scripts/angles.mjs'],
  ['src/api.md', 'references/api.md'],
  ['src/writing-the-video.md', 'references/writing-the-video.md'],
  ...[
    'package.json',
    'tsconfig.json',
    '.gitignore',
    'src/index.ts',
    'src/Root.tsx',
    'src/timeline.ts',
    'scripts/media.mjs',
    'scripts/voice.mjs',
    'scripts/music.mjs',
    'scripts/sfx.mjs',
    'scripts/image.mjs',
    'scripts/frames.mjs',
    'scripts/stills.mjs',
    'scripts/render.mjs',
    'scripts/finish.mjs',
  ].map(file => [`src/starter/${file}`, `assets/starter/${file}`]),
]);
export const SKILLS_SHIPPING_THE_CLIENT = [
  'create-launch-video',
  'create-video-from-recording',
  'create-presenter-video',
];
/**
 * Skills with no hosted path to fall back to. They carry the workflow and the
 * starter, and leave out the client and its API reference.
 */
export const SKILLS_WITHOUT_THE_CLIENT = ['create-video-essay'];
const HOSTED_PATH_FILES = ['src/client.mjs', 'src/api.md'];
/**
 * Skills that make a different kind of video and bring a starter of their own.
 * A music video is cut to a song, not to a voice reading a script, so it has no
 * use for the timeline or the workflow built on it. It takes from the shared
 * starter only the mechanics both kinds need, and nothing from the hosted path.
 */
export const SKILLS_WITH_THEIR_OWN_STARTER = {
  'create-music-video': ['tsconfig.json', 'src/index.ts', 'scripts/media.mjs', 'scripts/music.mjs', 'scripts/image.mjs', 'scripts/finish.mjs'].map(
    file => `src/starter/${file}`
  ),
};
/** Every Skill that carries copies of shared files. */
export const SKILLS = [...SKILLS_SHIPPING_THE_CLIENT, ...SKILLS_WITHOUT_THE_CLIENT, ...Object.keys(SKILLS_WITH_THEIR_OWN_STARTER)];

const repoUrl = new URL('../', import.meta.url);
const repoPath = path => fileURLToPath(new URL(path, repoUrl));

export function copyPathFor(skill, sharedPath) {
  return `skills/${skill}/${SHARED_FILES.get(sharedPath)}`;
}

/** The shared files a Skill carries. */
export function sharedFilesFor(skill) {
  if (skill in SKILLS_WITH_THEIR_OWN_STARTER) return SKILLS_WITH_THEIR_OWN_STARTER[skill];
  const all = [...SHARED_FILES.keys()];
  return SKILLS_WITHOUT_THE_CLIENT.includes(skill) ? all.filter(path => !HOSTED_PATH_FILES.includes(path)) : all;
}

async function sync() {
  const written = [];
  for (const skill of SKILLS) {
    for (const sharedPath of sharedFilesFor(skill)) {
      const source = await readFile(repoPath(sharedPath), 'utf8');
      const target = copyPathFor(skill, sharedPath);
      const current = await readFile(repoPath(target), 'utf8').catch(() => null);
      if (current === source) continue;
      await mkdir(dirname(repoPath(target)), { recursive: true });
      await writeFile(repoPath(target), source);
      written.push(target);
    }
  }
  process.stdout.write(
    written.length ? `Updated:\n${written.map(file => `  ${file}`).join('\n')}\n` : 'Already in sync.\n'
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  sync().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
