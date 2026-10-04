#!/usr/bin/env node

/**
 * Copies the shared files into every Skill that ships them: the workflow for
 * writing a video, the starter workspace it is written in, and the client and
 * API reference for the hosted path.
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
    'scripts/frames.mjs',
    'scripts/finish.mjs',
  ].map(file => [`src/starter/${file}`, `assets/starter/${file}`]),
]);
export const SKILLS_SHIPPING_THE_CLIENT = [
  'create-launch-video',
  'create-video-from-recording',
  'create-presenter-video',
];

const repoUrl = new URL('../', import.meta.url);
const repoPath = path => fileURLToPath(new URL(path, repoUrl));

export function copyPathFor(skill, sharedPath) {
  return `skills/${skill}/${SHARED_FILES.get(sharedPath)}`;
}

async function sync() {
  const written = [];
  for (const sharedPath of SHARED_FILES.keys()) {
    const source = await readFile(repoPath(sharedPath), 'utf8');
    for (const skill of SKILLS_SHIPPING_THE_CLIENT) {
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
