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
 * dot-folder and writes `ai-helper/installed.json`, which is the only thing
 * the app looks at to decide whether the mode exists. Uninstalling removes
 * both and leaves every other feature untouched.
 *
 *   npm run animation-mode -- --status
 *   npm run animation-mode -- --install              # defaults to Claude Code
 *   npm run animation-mode -- --install --to copilot
 *   npm run animation-mode -- --uninstall
 *
 * No credential is read or written at any point. The install records which
 * tool was chosen and nothing about the account behind it; signing in stays
 * between the user and their AI tool.
 */

import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { installTo, root, targetDir, uninstallFrom } from './install-ai-helper.mjs';

/** Must match ANIMATION_INSTALL_FILE in src/core/animation-install.ts. */
const INSTALL_FILE = join(root, 'ai-helper', 'installed.json');

/** Tools the app can name and start; anything else installs by folder name. */
const TOOLS = {
  claude: 'Claude Code',
  copilot: 'GitHub Copilot CLI',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
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
  console.log(`animation-mode: installed for ${label} (${record.target}).`);
  if (record.installedAt) console.log(`animation-mode: installed at ${record.installedAt}.`);
  console.log('animation-mode: remove it with `npm run animation-mode -- --uninstall`.');
}

async function install(tool) {
  const target = targetDir(tool);
  await installTo(target);
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
  console.log('animation-mode: restart napkin-sketch to pick up the change.');
}

async function uninstall() {
  const record = await readInstall();
  if (!record) {
    console.log('animation-mode: not installed; nothing to remove.');
    return;
  }
  await uninstallFrom(record.target);
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
