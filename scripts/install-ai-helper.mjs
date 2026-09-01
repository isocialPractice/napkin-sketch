/**
 * Installs the AI helper tool files (the `vector-animations` and
 * `vector-graphics` skills and the Animation Mode instructions) from the
 * tracked `ai-helper/` folder into the dot-folder(s) an AI tool reads. Those
 * dot-folders are commonly gitignored, so a fresh clone materializes them
 * with this script.
 *
 * Usage:
 *   node scripts/install-ai-helper.mjs                 # install to .claude
 *   node scripts/install-ai-helper.mjs --to claude --to github
 *   node scripts/install-ai-helper.mjs --to .cursor    # any tool dot-folder
 *   node scripts/install-ai-helper.mjs --to plugin     # check + print /plugin
 *   node scripts/install-ai-helper.mjs --list          # show known targets
 *
 * The `plugin` target is the odd one out, and it no longer copies anything:
 * `ai-helper/` *is* the plugin. It holds the manifest, the command, the
 * subagent, the skills, and the instructions, and the repository root holds
 * the marketplace that lists it. So the target checks that tree, syncs the
 * manifest version to `package.json`, and prints the two `/plugin` commands
 * that load it. See {@link installPlugin}.
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

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

/** The plugin's name, and the marketplace that lists it. */
export const PLUGIN_NAME = 'vectors';
export const PLUGIN_MARKETPLACE = 'napkin-sketch';

/**
 * The plugin root, relative to the repository root. `ai-helper/` is both the
 * source every dot-folder install copies from and the plugin itself, which is
 * what keeps a skill from existing twice in the tree.
 */
export const PLUGIN_DIR = 'ai-helper';

/** The repository-root manifest that lists the plugin for `/plugin marketplace add`. */
export const MARKETPLACE_MANIFEST = '.claude-plugin/marketplace.json';

/**
 * Folder an earlier release built a copy of the plugin into. Nothing writes
 * it any more, and a leftover copy would put both skills in the tree twice,
 * so the plugin target sweeps whatever that build left behind.
 */
export const LEGACY_PLUGIN_BUILD = 'plugins';

/**
 * Resolves a target name to its destination folder. Dot-folder targets get a
 * leading dot; `plugin` resolves to the plugin root instead, because a plugin
 * is a tree with a manifest rather than a dot-folder an AI tool scans.
 */
export function targetDir(name) {
  const key = name.replace(/^\./, '').toLowerCase();
  if (key === 'plugin' || key === 'plugins') return PLUGIN_DIR;
  if (KNOWN_TARGETS[key]) return KNOWN_TARGETS[key];
  return name.startsWith('.') ? name : `.${name}`;
}

/** True when a resolved target is the plugin rather than a dot-folder. */
export function isPluginTarget(dir) {
  return dir === PLUGIN_DIR;
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
export const SKILLS = ['vector-animations', 'vector-graphics'];

/**
 * Skill folder names this script used to install. An install predating a
 * rename leaves the old folder behind, and the AI tool would then load both
 * copies of the same skill, so every install and uninstall sweeps these too.
 */
export const LEGACY_SKILLS = ['svg-animations'];

/** The instructions file copied alongside the skills. */
export const INSTRUCTIONS = 'animation-mode.instructions.md';

/** Copies the skills and instructions into one tool folder, replacing stale copies. */
export async function installTo(dir) {
  if (isPluginTarget(dir)) return installPlugin();

  const base = join(root, dir);
  const instrDest = join(base, 'instructions', INSTRUCTIONS);

  for (const skill of LEGACY_SKILLS) {
    await rm(join(base, 'skills', skill), { recursive: true, force: true });
  }

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

/** The package version, used as the plugin's version. */
async function packageVersion() {
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Every file the plugin needs to load: the marketplace entry at the
 * repository root, the manifest, the command, the subagent, the instructions,
 * and one `SKILL.md` per skill. These are checked rather than generated -
 * they are tracked source, so a missing one is a mistake to report, not a
 * file to write over somebody's work.
 */
export function pluginFiles() {
  return [
    MARKETPLACE_MANIFEST,
    `${PLUGIN_DIR}/.claude-plugin/plugin.json`,
    `${PLUGIN_DIR}/commands/animation-mode.md`,
    `${PLUGIN_DIR}/agents/animation-frame.md`,
    `${PLUGIN_DIR}/instructions/${INSTRUCTIONS}`,
    ...SKILLS.map((skill) => `${PLUGIN_DIR}/skills/${skill}/SKILL.md`),
  ];
}

/** Which of {@link pluginFiles} are not on disk. */
export async function missingPluginFiles() {
  const missing = [];
  for (const rel of pluginFiles()) {
    if (!(await exists(join(root, rel)))) missing.push(rel);
  }
  return missing;
}

/**
 * Points the plugin manifest at the package's version. The manifest is
 * tracked source, so this rewrites one field and only when it has drifted: a
 * release bumps `package.json`, and the plugin should not be claiming the
 * version before it.
 */
export async function syncPluginVersion() {
  const version = await packageVersion();
  const path = join(root, PLUGIN_DIR, '.claude-plugin', 'plugin.json');
  const manifest = JSON.parse(await readFile(path, 'utf-8'));
  if (manifest.version === version) return { version, changed: false };
  manifest.version = version;
  await writeJson(path, manifest);
  return { version, changed: true };
}

/**
 * Removes the copy of the plugin an earlier release built under `plugins/`,
 * and the folder itself once nothing is left in it - a second plugin somebody
 * added by hand is not this script's to delete. Returns true when there was
 * something to remove.
 */
export async function sweepLegacyPluginBuild() {
  const buildRoot = join(root, LEGACY_PLUGIN_BUILD);
  if (!(await exists(buildRoot))) return false;

  let removed = false;
  for (const rel of [PLUGIN_NAME, '.claude-plugin']) {
    const path = join(buildRoot, rel);
    if (await exists(path)) {
      await rm(path, { recursive: true, force: true });
      removed = true;
    }
  }
  try {
    const left = await readdir(buildRoot);
    if (left.length === 0) await rm(buildRoot, { recursive: true, force: true });
  } catch {
    // Already gone, which is the outcome either way.
  }
  return removed;
}

/**
 * Readies the `vectors` plugin, which is `ai-helper/` itself.
 *
 * There is nothing to copy: the folder already holds what a plugin is made
 * of, and the repository root holds the marketplace that lists it.
 *
 *     .claude-plugin/marketplace.json   lists vectors, source ./ai-helper
 *     ai-helper/
 *       .claude-plugin/plugin.json      the plugin manifest
 *       commands/animation-mode.md      /vectors:animation-mode
 *       agents/animation-frame.md       the frame-drawing subagent
 *       skills/<skill>/                 one folder per skill
 *       instructions/                   the helper contract
 *
 * So this checks the tree is whole, syncs the manifest version, sweeps the
 * build folder an older release generated, and prints the two commands that
 * actually load the plugin - building it was never the step that did.
 */
export async function installPlugin() {
  const missing = await missingPluginFiles();
  if (missing.length > 0) {
    throw new Error(
      `ai-helper: the ${PLUGIN_NAME} plugin is incomplete. Missing:\n  ${missing.join('\n  ')}`
    );
  }

  const { version, changed } = await syncPluginVersion();
  if (changed) console.log(`ai-helper: set the ${PLUGIN_NAME} manifest version to ${version}.`);
  if (await sweepLegacyPluginBuild()) {
    console.log(`ai-helper: removed the retired ${LEGACY_PLUGIN_BUILD}/ build of the plugin.`);
  }

  console.log(`ai-helper: the ${PLUGIN_NAME} plugin (v${version}) is ready in ${PLUGIN_DIR}/.`);
  console.log('ai-helper: it is not loaded until you add it. In Claude Code run');
  console.log('ai-helper:   /plugin marketplace add .');
  console.log(`ai-helper:   /plugin install ${PLUGIN_NAME}@${PLUGIN_MARKETPLACE}`);
  console.log(
    'ai-helper: or, without a clone, /plugin marketplace add isocialPractice/napkin-sketch'
  );
}

/** Writes one JSON file with a trailing newline. */
async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

/**
 * Removes only what {@link installTo} put there: the two skills (plus any
 * folder left by an earlier name) and the instructions file. Anything else the
 * user keeps in that dot-folder (their own skills, settings, commands) is left
 * alone, which is what lets Animation Mode be removed without disturbing the
 * AI tool it was installed for. The plugin target removes nothing, because
 * what it installed was tracked source; see {@link uninstallPlugin}.
 */
export async function uninstallFrom(dir) {
  if (isPluginTarget(dir)) return uninstallPlugin();

  const base = join(root, dir);
  for (const skill of [...SKILLS, ...LEGACY_SKILLS]) {
    await rm(join(base, 'skills', skill), { recursive: true, force: true });
  }
  await rm(join(base, 'instructions', INSTRUCTIONS), { force: true });
  console.log(`ai-helper: removed the skills + instructions from ${dir}/`);
}

/**
 * Unloads the plugin, which is something only the AI tool can do: the files
 * are tracked source the repository needs either way, so deleting them is
 * never the right answer. This prints the two commands that drop it and
 * sweeps the folder an older release built a copy into.
 */
export async function uninstallPlugin() {
  if (await sweepLegacyPluginBuild()) {
    console.log(`ai-helper: removed the retired ${LEGACY_PLUGIN_BUILD}/ build of the plugin.`);
  }
  console.log(`ai-helper: ${PLUGIN_DIR}/ is tracked source, so nothing was deleted.`);
  console.log('ai-helper: to unload the plugin, in Claude Code run');
  console.log(`ai-helper:   /plugin uninstall ${PLUGIN_NAME}@${PLUGIN_MARKETPLACE}`);
  console.log(`ai-helper:   /plugin marketplace remove ${PLUGIN_MARKETPLACE}`);
}

async function run() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    console.log('Known targets: claude (.claude), github/copilot (.github),');
    console.log('codex (.codex), gemini (.gemini).');
    console.log('Any other name installs to a dot-folder of that name (e.g. --to cursor).');
    console.log(
      `plugin checks the ${PLUGIN_NAME} plugin in ${PLUGIN_DIR}/ and prints the /plugin ` +
        'commands that load it, instead of copying into a dot-folder.'
    );
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
