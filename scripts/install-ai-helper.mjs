/**
 * Installs the AI helper files from the tracked `ai-helper/` folder into the
 * dot-folder(s) an AI tool reads. Those dot-folders are commonly gitignored,
 * so a fresh clone materializes them with this script.
 *
 * `ai-helper/` is a container, not a plugin. Each helper owns a dedicated
 * folder beneath it and is described once in {@link HELPERS}, which is the
 * single place that knows what a helper is made of:
 *
 *     ai-helper/
 *       vectors/            Animation Mode: /vectors:animation-mode, the
 *                           animation-frame subagent, and two skills
 *       graphic-designer/   design language: /graphic-designer:design-language
 *                           and two skills
 *
 * Usage:
 *   node scripts/install-ai-helper.mjs                    # every helper -> .claude
 *   node scripts/install-ai-helper.mjs --to claude --to github
 *   node scripts/install-ai-helper.mjs --to .cursor       # any tool dot-folder
 *   node scripts/install-ai-helper.mjs --helper vectors   # narrow to one helper
 *   node scripts/install-ai-helper.mjs --to plugin        # check + print /plugin
 *   node scripts/install-ai-helper.mjs --list             # show targets + helpers
 *
 * The `plugin` target is the odd one out, and it copies nothing: a helper's
 * folder *is* its plugin. It holds the manifest, the command, any subagent, the
 * skills, and the instructions, and the repository root holds the marketplace
 * that lists them. So the target checks that tree, syncs the manifest version
 * to `package.json`, and prints the two `/plugin` commands that load it. See
 * {@link installPlugin}.
 *
 * On clone (postinstall mode): `--on-clone` installs only when the
 * NAPKIN_AI_HELPER environment variable names one or more targets, so a
 * plain `npm install` stays a no-op:
 *   NAPKIN_AI_HELPER=claude,github npm install
 *
 * This script only moves files. Turning Animation Mode itself on or off is
 * `npm run animation-mode -- --install | --uninstall`, which calls into the
 * helpers exported here and always names `vectors` explicitly, so Animation
 * Mode's install never reaches past its own plugin.
 */

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The folder the helper plugins live in. Must match `AI_HELPER_ROOT` in `src/core/ai-tool.ts`. */
export const AI_HELPER_ROOT = 'ai-helper';

/** The container folder on disk; the existence check a run makes before anything else. */
export const sourceDir = join(root, AI_HELPER_ROOT);

/**
 * Every helper, and what each one is made of.
 *
 * This is the registry the rest of the file derives from, and the list
 * `test/ai-helper.test.ts` checks against `src/core/ai-tool.ts`. The two
 * cannot import each other - one is ESM JavaScript run by npm, the other is
 * TypeScript bundled into the app - so a test holds them together instead.
 */
export const HELPERS = {
  vectors: {
    dir: `${AI_HELPER_ROOT}/vectors`,
    skills: ['vector-animations', 'vector-graphics'],
    instructions: ['animation-mode.instructions.md'],
    commands: ['animation-mode.md'],
    agents: ['animation-frame.md'],
  },
  'graphic-designer': {
    dir: `${AI_HELPER_ROOT}/graphic-designer`,
    skills: ['design-language', 'graphic-design-api'],
    instructions: ['design-language.instructions.md'],
    commands: ['design-language.md'],
    agents: [],
  },
};

/** Helper names, in the order they install. */
export const HELPER_NAMES = Object.keys(HELPERS);

/**
 * The helper `--to plugin` means when nothing narrows it.
 *
 * Animation Mode named that target before there was a second helper, and an
 * install recorded then still says so, so the unqualified spelling has to keep
 * meaning what it meant.
 */
export const DEFAULT_PLUGIN_HELPER = 'vectors';

/** Shorthand names for common AI tool folders; anything else is used as-is. */
const KNOWN_TARGETS = {
  claude: '.claude',
  github: '.github',
  copilot: '.github',
  codex: '.codex',
  gemini: '.gemini',
};

/** The Animation Mode plugin's name, and the marketplace that lists every helper. */
export const PLUGIN_NAME = 'vectors';
export const PLUGIN_MARKETPLACE = 'napkin-sketch';

/** The Animation Mode plugin's root, relative to the repository root. */
export const PLUGIN_DIR = HELPERS[DEFAULT_PLUGIN_HELPER].dir;

/** The repository-root manifest that lists the plugins for `/plugin marketplace add`. */
export const MARKETPLACE_MANIFEST = '.claude-plugin/marketplace.json';

/**
 * The plugin root before the helpers were split, when `ai-helper/` was the
 * `vectors` plugin itself. An install recorded then still names it, so it is
 * read as naming the plugin that moved out of it. Mirrors
 * `normalizeInstallTarget` in `src/core/animation-install.ts`.
 */
export const LEGACY_PLUGIN_DIR = AI_HELPER_ROOT;

/**
 * Folder an earlier release built a copy of the plugin into. Nothing writes
 * it any more, and a leftover copy would put both skills in the tree twice,
 * so the plugin target sweeps whatever that build left behind.
 */
export const LEGACY_PLUGIN_BUILD = 'plugins';

/**
 * Skill folder names this script used to install. An install predating a
 * rename leaves the old folder behind, and the AI tool would then load both
 * copies of the same skill, so every install and uninstall sweeps these too.
 */
export const LEGACY_SKILLS = ['svg-animations'];

/** Looks a helper up by name, raising on one that is not in the registry. */
export function helper(name) {
  const found = HELPERS[name];
  if (!found) {
    throw new Error(`ai-helper: unknown helper "${name}". Known: ${HELPER_NAMES.join(', ')}`);
  }
  return found;
}

/** Every skill the named helpers carry, in install order. */
export function skillsOf(names = HELPER_NAMES) {
  return names.flatMap((name) => helper(name).skills);
}

/**
 * Resolves a target name to its destination folder. Dot-folder targets get a
 * leading dot; `plugin` resolves to a helper's own root instead, because a
 * plugin is a tree with a manifest rather than a dot-folder an AI tool scans.
 */
export function targetDir(name, pluginHelper = DEFAULT_PLUGIN_HELPER) {
  const key = name.replace(/^\./, '').toLowerCase();
  if (key === 'plugin' || key === 'plugins') return helper(pluginHelper).dir;
  if (KNOWN_TARGETS[key]) return KNOWN_TARGETS[key];
  return name.startsWith('.') ? name : `.${name}`;
}

/** The helper whose root a resolved target is, or null for a dot-folder. */
export function helperAtDir(dir) {
  const clean = String(dir).replace(/\\/g, '/').replace(/\/+$/, '');
  if (clean === LEGACY_PLUGIN_DIR) return DEFAULT_PLUGIN_HELPER;
  return HELPER_NAMES.find((name) => HELPERS[name].dir === clean) ?? null;
}

/** True when a resolved target is a plugin root rather than a dot-folder. */
export function isPluginTarget(dir) {
  return helperAtDir(dir) !== null;
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
 * Copies one text file, resolving the plugin-only path variable.
 *
 * A command or subagent addresses its own plugin as `${CLAUDE_PLUGIN_ROOT}`,
 * which the AI tool defines only for a *loaded plugin*. The same file copied
 * into a dot-folder has no such variable, so every path in it would be a
 * dead end. Rewriting it to the helper's repository-relative folder is what
 * makes the copied command work at all.
 */
async function copyResolved(from, to, helperDir) {
  const text = await readFile(from, 'utf-8');
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, text.split('${CLAUDE_PLUGIN_ROOT}').join(helperDir), 'utf-8');
}

/**
 * Copies the named helpers into one tool folder, replacing stale copies.
 *
 * Skills land side by side so the cross-links between them
 * (`../vector-graphics/...`) resolve after install as they do in the
 * repository. Commands, subagents and instructions come too: a delivery that
 * carried only the skills left every slash command the plugin documents
 * reachable in one delivery and missing in the other.
 */
export async function installTo(dir, names = HELPER_NAMES) {
  if (isPluginTarget(dir)) return installPlugin(helperAtDir(dir));

  const base = join(root, dir);

  for (const skill of LEGACY_SKILLS) {
    await rm(join(base, 'skills', skill), { recursive: true, force: true });
  }

  let skills = 0;
  let commands = 0;
  for (const name of names) {
    const { dir: source, skills: helperSkills, instructions, commands: cmds, agents } = helper(name);
    for (const skill of helperSkills) {
      const skillDest = join(base, 'skills', skill);
      await rm(skillDest, { recursive: true, force: true });
      await mkdir(dirname(skillDest), { recursive: true });
      await cp(join(root, source, 'skills', skill), skillDest, { recursive: true });
      skills++;
    }
    for (const file of instructions) {
      await copyResolved(join(root, source, 'instructions', file), join(base, 'instructions', file), source);
    }
    // Commands land in a folder named for the helper, so the copied command
    // answers to `/<helper>:<command>` - the same spelling the plugin gives it.
    // A command that is only reachable under one delivery is a command whose
    // documentation is wrong half the time.
    for (const file of cmds) {
      await copyResolved(join(root, source, 'commands', file), join(base, 'commands', name, file), source);
      commands++;
    }
    for (const file of agents) {
      await copyResolved(join(root, source, 'agents', file), join(base, 'agents', file), source);
    }
  }

  console.log(
    `ai-helper: installed ${skills} skills, ${commands} commands + instructions from ${names.join(', ')} to ${dir}/`
  );
}

/** The package version, used as every plugin's version. */
async function packageVersion() {
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Every file a plugin needs to load: the marketplace entry at the repository
 * root, the manifest, the commands, any subagents, the instructions, and one
 * `SKILL.md` per skill. These are checked rather than generated - they are
 * tracked source, so a missing one is a mistake to report, not a file to write
 * over somebody's work.
 */
export function pluginFiles(name = DEFAULT_PLUGIN_HELPER) {
  const { dir, skills, instructions, commands, agents } = helper(name);
  return [
    MARKETPLACE_MANIFEST,
    `${dir}/.claude-plugin/plugin.json`,
    ...commands.map((file) => `${dir}/commands/${file}`),
    ...agents.map((file) => `${dir}/agents/${file}`),
    ...instructions.map((file) => `${dir}/instructions/${file}`),
    ...skills.map((skill) => `${dir}/skills/${skill}/SKILL.md`),
  ];
}

/** Which of {@link pluginFiles} are not on disk. */
export async function missingPluginFiles(name = DEFAULT_PLUGIN_HELPER) {
  const missing = [];
  for (const rel of pluginFiles(name)) {
    if (!(await exists(join(root, rel)))) missing.push(rel);
  }
  return missing;
}

/**
 * Points a plugin manifest at the package's version. The manifest is tracked
 * source, so this rewrites one field and only when it has drifted: a release
 * bumps `package.json`, and a plugin should not be claiming the version before
 * it.
 */
export async function syncPluginVersion(name = DEFAULT_PLUGIN_HELPER) {
  const version = await packageVersion();
  const path = join(root, helper(name).dir, '.claude-plugin', 'plugin.json');
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
 * Readies a helper's plugin, which is the helper's folder itself.
 *
 * There is nothing to copy: the folder already holds what a plugin is made
 * of, and the repository root holds the marketplace that lists it.
 *
 *     .claude-plugin/marketplace.json   lists each plugin and its source
 *     ai-helper/<helper>/
 *       .claude-plugin/plugin.json      the plugin manifest
 *       commands/<command>.md           /<plugin>:<command>
 *       agents/<agent>.md               subagents, when the helper has any
 *       skills/<skill>/                 one folder per skill
 *       instructions/                   the helper contract
 *
 * So this checks the tree is whole, syncs the manifest version, sweeps the
 * build folder an older release generated, and prints the two commands that
 * actually load the plugin - building it was never the step that did.
 */
export async function installPlugin(name = DEFAULT_PLUGIN_HELPER) {
  const { dir } = helper(name);
  const missing = await missingPluginFiles(name);
  if (missing.length > 0) {
    throw new Error(
      `ai-helper: the ${name} plugin is incomplete. Missing:\n  ${missing.join('\n  ')}`
    );
  }

  const { version, changed } = await syncPluginVersion(name);
  if (changed) console.log(`ai-helper: set the ${name} manifest version to ${version}.`);
  if (await sweepLegacyPluginBuild()) {
    console.log(`ai-helper: removed the retired ${LEGACY_PLUGIN_BUILD}/ build of the plugin.`);
  }

  console.log(`ai-helper: the ${name} plugin (v${version}) is ready in ${dir}/.`);
  console.log('ai-helper: it is not loaded until you add it. In Claude Code run');
  console.log('ai-helper:   /plugin marketplace add .');
  console.log(`ai-helper:   /plugin install ${name}@${PLUGIN_MARKETPLACE}`);
  console.log(
    'ai-helper: or, without a clone, /plugin marketplace add isocialPractice/napkin-sketch'
  );
}

/** Writes one JSON file with a trailing newline. */
async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

/**
 * Removes only what {@link installTo} put there: the named helpers' skills
 * (plus any folder left by an earlier name) and their instructions files.
 * Anything else the user keeps in that dot-folder - their own skills, settings,
 * commands, and the other helper's files - is left alone, which is what lets
 * one feature be removed without disturbing the AI tool it was installed for.
 * A plugin target removes nothing, because what it installed was tracked
 * source; see {@link uninstallPlugin}.
 */
export async function uninstallFrom(dir, names = HELPER_NAMES) {
  if (isPluginTarget(dir)) return uninstallPlugin(helperAtDir(dir));

  const base = join(root, dir);
  for (const skill of [...skillsOf(names), ...LEGACY_SKILLS]) {
    await rm(join(base, 'skills', skill), { recursive: true, force: true });
  }
  for (const name of names) {
    for (const file of helper(name).instructions) {
      await rm(join(base, 'instructions', file), { force: true });
    }
    // The command folder is named for the helper, so removing it takes exactly
    // this helper's commands and leaves anyone else's alone.
    await rm(join(base, 'commands', name), { recursive: true, force: true });
    for (const file of helper(name).agents) {
      await rm(join(base, 'agents', file), { force: true });
    }
  }
  console.log(`ai-helper: removed ${names.join(', ')} skills, commands + instructions from ${dir}/`);
}

/**
 * Unloads a plugin, which is something only the AI tool can do: the files are
 * tracked source the repository needs either way, so deleting them is never
 * the right answer. This prints the two commands that drop it and sweeps the
 * folder an older release built a copy into.
 */
export async function uninstallPlugin(name = DEFAULT_PLUGIN_HELPER) {
  if (await sweepLegacyPluginBuild()) {
    console.log(`ai-helper: removed the retired ${LEGACY_PLUGIN_BUILD}/ build of the plugin.`);
  }
  console.log(`ai-helper: ${helper(name).dir}/ is tracked source, so nothing was deleted.`);
  console.log('ai-helper: to unload the plugin, in Claude Code run');
  console.log(`ai-helper:   /plugin uninstall ${name}@${PLUGIN_MARKETPLACE}`);
  console.log(`ai-helper:   /plugin marketplace remove ${PLUGIN_MARKETPLACE}`);
}

async function run() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    console.log('Known targets: claude (.claude), github/copilot (.github),');
    console.log('codex (.codex), gemini (.gemini).');
    console.log('Any other name installs to a dot-folder of that name (e.g. --to cursor).');
    console.log('Helpers (--helper, repeatable; every one of them by default):');
    for (const name of HELPER_NAMES) {
      console.log(`  ${name.padEnd(17)} ${helper(name).dir}/  skills: ${helper(name).skills.join(', ')}`);
    }
    console.log(
      'plugin checks a helper in its own folder and prints the /plugin commands that ' +
        'load it, instead of copying into a dot-folder.'
    );
    return;
  }

  let targets = [];
  const names = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--to' && args[i + 1]) targets.push(args[++i]);
    if (args[i] === '--helper' && args[i + 1]) names.push(args[++i]);
  }

  if (args.includes('--on-clone')) {
    const fromEnv = (process.env.NAPKIN_AI_HELPER ?? '').trim();
    if (!fromEnv) return; // plain npm install: nothing requested, nothing done
    targets = fromEnv.split(',').map((t) => t.trim()).filter(Boolean);
  }

  if (targets.length === 0) targets = ['claude'];
  const helpers = names.length > 0 ? names : HELPER_NAMES;
  for (const name of helpers) helper(name); // fail early on a typo, before copying

  if (!(await exists(sourceDir))) {
    console.error(`ai-helper: source folder not found at ${sourceDir}`);
    process.exit(1);
  }

  // `--to plugin` names a delivery rather than one folder, so it expands to a
  // root per selected helper: with no `--helper` that readies both plugins,
  // where a dot-folder target takes every selected helper in one pass.
  const dirs = new Set();
  for (const target of targets) {
    const key = target.replace(/^\./, '').toLowerCase();
    if (key === 'plugin' || key === 'plugins') {
      for (const name of helpers) dirs.add(helper(name).dir);
    } else {
      dirs.add(targetDir(target));
    }
  }

  for (const dir of dirs) {
    await installTo(dir, helpers);
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
