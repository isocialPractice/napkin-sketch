/**
 * Adds or removes Animation Mode.
 *
 * Animation Mode is the one feature of napkin-sketch that needs software the
 * app does not ship: an agentic AI command-line tool (Claude Code, GitHub
 * Copilot CLI, Codex, Gemini, or another). Because of that dependency it is
 * not part of a default install - `npm install` leaves it out entirely, and
 * the app runs with no Edit-menu entry, no shortcut, and no AI tool required.
 *
 * Installing copies the helper's skills and instructions into the AI tool's
 * dot-folder - or, with `--to plugin`, readies the `vectors` plugin that
 * `ai-helper/vectors/` already is - and writes `ai-helper/installed.json`,
 * which is the only thing the app looks at to decide whether the mode exists.
 * It also removes an install that targeted somewhere else first, so switching
 * delivery never leaves two copies of a skill loaded. Uninstalling removes
 * the record and leaves every other feature untouched.
 *
 * Every call names `vectors` explicitly. There is a second helper in
 * `ai-helper/`, and Animation Mode has no business installing or removing it:
 * `npm run ai-helper` is the script that handles the helpers as a set.
 *
 *   npm run animation-mode -- --status
 *   npm run animation-mode -- --install              # defaults to Claude Code
 *   npm run animation-mode -- --install --to copilot
 *   npm run animation-mode -- --install --to plugin   # the vectors plugin
 *   npm run animation-mode -- --uninstall
 *
 * No credential is read or written at any point. The install records which
 * tool was chosen and nothing about the account behind it; signing in stays
 * between the user and their AI tool.
 */

import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  AI_HELPER_ROOT,
  installTo,
  isPluginTarget,
  PLUGIN_MARKETPLACE,
  PLUGIN_NAME,
  root,
  targetDir,
  uninstallFrom,
} from './install-ai-helper.mjs';

/** Must match ANIMATION_INSTALL_FILE in src/core/animation-install.ts. */
const INSTALL_FILE = join(root, AI_HELPER_ROOT, 'installed.json');

/** The only helper this script installs or removes. */
const HELPERS = [PLUGIN_NAME];

/**
 * Migrates a target read off an older record.
 *
 * `--to plugin` recorded `ai-helper` while that folder was the plugin itself.
 * It is a container now, so a stored value naming it has to be read as naming
 * the plugin that moved out of it - otherwise the sweep below would be pointed
 * at the container root. Mirrors `normalizeInstallTarget` in
 * `src/core/animation-install.ts`.
 */
function normalizeTarget(target) {
  const clean = String(target).replace(/\\/g, '/').replace(/\/+$/, '');
  return clean === AI_HELPER_ROOT ? targetDir('plugin') : clean;
}

/** Tools the app can name and start; anything else installs by folder name. */
const TOOLS = {
  claude: 'Claude Code',
  copilot: 'GitHub Copilot CLI',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  plugin: `Claude Code (the ${PLUGIN_NAME} plugin)`,
};

async function readInstall() {
  try {
    const record = JSON.parse(await readFile(INSTALL_FILE, 'utf-8'));
    return record && record.version === 1 && record.tool ? record : null;
  } catch {
    return null;
  }
}

async function status() {
  const record = await readInstall();
  if (!record) {
    console.log('animation-mode: not installed (the app runs without it).');
    console.log('animation-mode: add it with `npm run animation-mode -- --install`.');
    return;
  }
  const label = TOOLS[record.tool] ?? record.tool;
  console.log(`animation-mode: installed for ${label} (${normalizeTarget(record.target)}).`);
  if (record.installedAt) console.log(`animation-mode: installed at ${record.installedAt}.`);
  console.log('animation-mode: remove it with `npm run animation-mode -- --uninstall`.');
}

async function install(tool) {
  const target = targetDir(tool);

  // Switching delivery would otherwise leave the old one in place: a
  // dot-folder install that is not swept keeps its copy of both skills, and a
  // tool that then loads the plugin sees each skill twice. Remove a previous
  // install whenever it landed somewhere other than this target.
  const previous = await readInstall();
  const previousTarget = previous ? normalizeTarget(previous.target) : null;
  if (previousTarget && previousTarget !== target) await uninstallFrom(previousTarget, HELPERS);

  await installTo(target, HELPERS);
  await mkdir(dirname(INSTALL_FILE), { recursive: true });
  const record = {
    version: 1,
    tool,
    target,
    installedAt: new Date().toISOString(),
  };
  await writeFile(INSTALL_FILE, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
  const label = TOOLS[tool] ?? tool;
  console.log(`animation-mode: installed for ${label}.`);
  console.log(`animation-mode: ${label} must be on your PATH and signed in.`);
  console.log('animation-mode: the app offers to start it for sign-in when it is not.');

  // Recording the plugin does not by itself make its skills reachable: Claude
  // Code only loads them once the marketplace is added and the plugin is
  // installed. Say so rather than letting the install record imply otherwise.
  if (isPluginTarget(target)) {
    console.log('animation-mode: the plugin is ready but not yet loaded. In Claude Code run');
    console.log('animation-mode:   /plugin marketplace add .');
    console.log(`animation-mode:   /plugin install ${PLUGIN_NAME}@${PLUGIN_MARKETPLACE}`);
  }

  console.log('animation-mode: restart napkin-sketch to pick up the change.');
}

async function uninstall() {
  const record = await readInstall();
  if (!record) {
    console.log('animation-mode: not installed; nothing to remove.');
    return;
  }
  await uninstallFrom(normalizeTarget(record.target), HELPERS);
  await rm(INSTALL_FILE, { force: true });
  console.log('animation-mode: removed. Every other feature is untouched.');
  console.log('animation-mode: restart napkin-sketch to pick up the change.');
}

async function run() {
  const args = process.argv.slice(2);
  let tool = 'claude';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--to' && args[i + 1]) tool = args[++i].replace(/^\./, '').toLowerCase();
  }

  if (args.includes('--uninstall')) return uninstall();
  if (args.includes('--install')) return install(tool);
  return status();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
