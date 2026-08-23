/**
 * Installs the AI helper tool files (the `svg-animations` and
 * `vector-graphics` skills and the Animation Mode instructions) from the
 * tracked `ai-helper/` folder into the dot-folder(s) an AI tool reads. Those
 * dot-folders are commonly gitignored, so a fresh clone materializes them
 * with this script.
 *
 * Usage:
 *   node scripts/install-ai-helper.mjs                 # install to .claude
 *   node scripts/install-ai-helper.mjs --to claude --to github
 *   node scripts/install-ai-helper.mjs --to .cursor    # any tool dot-folder
 *   node scripts/install-ai-helper.mjs --list          # show known targets
 *
 * On clone (postinstall mode): `--on-clone` installs only when the
 * NAPKIN_AI_HELPER environment variable names one or more targets, so a
 * plain `npm install` stays a no-op:
 *   NAPKIN_AI_HELPER=claude,github npm install
 *
 * This script only moves files. Turning Animation Mode itself on or off is
 * `npm run animation-mode -- --install | --uninstall`, which calls into the
 * helpers exported here.
 */

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sourceDir = join(root, 'ai-helper');

/** Shorthand names for common AI tool folders; anything else is used as-is. */
const KNOWN_TARGETS = {
  claude: '.claude',
  github: '.github',
  copilot: '.github',
  codex: '.codex',
  gemini: '.gemini',
};

/** Resolves a target name to its dot-folder (leading dot added if missing). */
export function targetDir(name) {
  const key = name.replace(/^\./, '').toLowerCase();
  if (KNOWN_TARGETS[key]) return KNOWN_TARGETS[key];
  return name.startsWith('.') ? name : `.${name}`;
}

export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Skills copied into every target, installed side by side so the cross-links
 * between them (`../vector-graphics/...`) resolve after install as they do in
 * the repository.
 */
export const SKILLS = ['svg-animations', 'vector-graphics'];

/** The instructions file copied alongside the skills. */
export const INSTRUCTIONS = 'animation-mode.instructions.md';

/** Copies the skills and instructions into one tool folder, replacing stale copies. */
export async function installTo(dir) {
  const base = join(root, dir);
  const instrDest = join(base, 'instructions', INSTRUCTIONS);

  for (const skill of SKILLS) {
    const skillDest = join(base, 'skills', skill);
    await rm(skillDest, { recursive: true, force: true });
    await mkdir(dirname(skillDest), { recursive: true });
    await cp(join(sourceDir, 'skills', skill), skillDest, { recursive: true });
  }

  await mkdir(dirname(instrDest), { recursive: true });
  await cp(join(sourceDir, 'instructions', INSTRUCTIONS), instrDest);

  console.log(`ai-helper: installed ${SKILLS.length} skills + instructions to ${dir}/`);
}

/**
 * Removes only what {@link installTo} put there: the two skills and the
 * instructions file. Anything else the user keeps in that dot-folder (their
 * own skills, settings, commands) is left alone, which is what lets Animation
 * Mode be removed without disturbing the AI tool it was installed for.
 */
export async function uninstallFrom(dir) {
  const base = join(root, dir);
  for (const skill of SKILLS) {
    await rm(join(base, 'skills', skill), { recursive: true, force: true });
  }
  await rm(join(base, 'instructions', INSTRUCTIONS), { force: true });
  console.log(`ai-helper: removed the skills + instructions from ${dir}/`);
}

async function run() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    console.log('Known targets: claude (.claude), github/copilot (.github),');
    console.log('codex (.codex), gemini (.gemini).');
    console.log('Any other name installs to a dot-folder of that name (e.g. --to cursor).');
    return;
  }

  let targets = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--to' && args[i + 1]) targets.push(args[++i]);
  }

  if (args.includes('--on-clone')) {
    const fromEnv = (process.env.NAPKIN_AI_HELPER ?? '').trim();
    if (!fromEnv) return; // plain npm install: nothing requested, nothing done
    targets = fromEnv.split(',').map((t) => t.trim()).filter(Boolean);
  }

  if (targets.length === 0) targets = ['claude'];

  if (!(await exists(sourceDir))) {
    console.error(`ai-helper: source folder not found at ${sourceDir}`);
    process.exit(1);
  }

  for (const dir of new Set(targets.map(targetDir))) {
    await installTo(dir);
  }
}

/** Only run the CLI when this file is the entry point, not when imported. */
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const selfPath = resolve(fileURLToPath(import.meta.url));
const sameFile =
  process.platform === 'win32'
    ? invokedPath.toLowerCase() === selfPath.toLowerCase()
    : invokedPath === selfPath;
if (sameFile) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
