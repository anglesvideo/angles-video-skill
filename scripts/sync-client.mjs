#!/usr/bin/env node

/**
 * Copies the shared client and API reference into every Skill that ships them.
 *
 * Each Skill is installed from its own directory URL, so it has to carry these
 * files rather than import a shared copy — which is why the duplicates exist at
 * all. Everything in `src/` is the source they are copied from; the test suite
 * fails if a copy drifts, so editing a copy by hand is caught, not shipped.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Source file in `src/` → the path it is copied to inside each Skill. */
export const SHARED_FILES = new Map([
  ['src/client.mjs', 'scripts/angles.mjs'],
  ['src/api.md', 'references/api.md'],
]);
export const SKILLS_SHIPPING_THE_CLIENT = ['create-launch-video', 'create-video-from-recording'];

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
