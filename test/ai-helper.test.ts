/**
 * The `ai-helper/` plugin: one copy of every skill in the tree, and a plugin
 * an AI tool can actually load.
 *
 * Both halves are worth a test. The helper used to be built into a second
 * folder, which meant every skill existed twice and the copy went stale; the
 * folder is now the plugin itself, and nothing should quietly reintroduce a
 * duplicate. And a plugin is only loadable when its manifests agree with each
 * other and the files they promise are there, none of which the compiler can
 * check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ANIMATION_PLUGIN } from '../src/core/ai-tool.js';
import { ANIMATION_SKILL_NAME, VECTOR_SKILL_NAME } from '../src/core/animation.js';

/**
 * The repository root, found by walking up from the working directory until a
 * `package.json` naming this package turns up. The suite runs from a bundle in
 * `dist-test/`, so neither `__dirname` nor a fixed relative path is reliable.
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf-8')).name === 'napkin-sketch') {
      return dir;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`repository root not found from ${process.cwd()}`);
}

const ROOT = repoRoot();
const PLUGIN = join(ROOT, ANIMATION_PLUGIN.dir);

/** Build outputs and working folders, none of which is tracked. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-test', 'release', 'logs', 'animations']);

/**
 * Every file in the tracked tree. Dot-entries are skipped along with the build
 * folders: the AI tool dot-folders that hold installed copies of these skills
 * are ignored, and a duplicate there is the install working, not a mistake.
 */
function* trackedFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* trackedFiles(full);
    else yield full;
  }
}

/** The `name:` a SKILL.md declares, which is what the AI tool calls the skill. */
function skillName(file: string): string {
  const match = /^name:\s*(.+)$/m.exec(readFileSync(file, 'utf-8').split('---')[1] ?? '');
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

test('every skill exists once in the tracked tree', () => {
  const skills = new Map<string, string[]>();
  for (const file of trackedFiles(ROOT)) {
    if (!file.endsWith('SKILL.md')) continue;
    const name = skillName(file);
    assert.ok(name, `${file} declares no name:`);
    skills.set(name, [...(skills.get(name) ?? []), file]);
  }

  for (const [name, files] of skills) {
    assert.equal(files.length, 1, `${name} appears ${files.length} times:\n  ${files.join('\n  ')}`);
  }
  assert.deepEqual([...skills.keys()].sort(), [ANIMATION_SKILL_NAME, VECTOR_SKILL_NAME].sort());
});

test('the retired plugin build folder is gone', () => {
  // It held a second copy of both skills, generated from this folder and stale
  // the moment either changed. Nothing writes it now.
  assert.equal(existsSync(join(ROOT, 'plugins')), false);
});

test('the marketplace at the repository root lists the plugin', () => {
  const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf-8'));
  assert.equal(market.name, ANIMATION_PLUGIN.marketplace);
  assert.ok(market.owner?.name, 'a marketplace needs an owner');

  const entry = market.plugins.find((p: { name: string }) => p.name === ANIMATION_PLUGIN.name);
  assert.ok(entry, `${ANIMATION_PLUGIN.name} is not listed`);
  // The source points at the folder rather than at a copy of it, which is what
  // keeps one skill from becoming two.
  assert.equal(entry.source, `./${ANIMATION_PLUGIN.dir}`);
});

test('the plugin manifest names the plugin and tracks the package version', () => {
  const manifest = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf-8'));
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  assert.equal(manifest.name, ANIMATION_PLUGIN.name);
  assert.equal(manifest.version, pkg.version, 'run `npm run ai-helper -- --to plugin` to sync it');
});

test('the plugin carries the parts the app names', () => {
  // The app tells the helper to reach for these by name, so a missing one is a
  // form that asks for something the tool cannot find.
  for (const skill of [ANIMATION_SKILL_NAME, VECTOR_SKILL_NAME]) {
    const file = join(PLUGIN, 'skills', skill, 'SKILL.md');
    assert.ok(existsSync(file), `${skill} is missing`);
    assert.equal(skillName(file), skill, `${skill} declares a different name:`);
  }

  const command = join(PLUGIN, 'commands', `${ANIMATION_PLUGIN.command}.md`);
  assert.ok(existsSync(command), 'the animation-mode command is missing');

  const agent = join(PLUGIN, 'agents', `${ANIMATION_PLUGIN.agent}.md`);
  assert.ok(existsSync(agent), 'the animation-frame subagent is missing');
  assert.match(readFileSync(agent, 'utf-8'), new RegExp(`^name:\\s*${ANIMATION_PLUGIN.agent}$`, 'm'));

  assert.ok(existsSync(join(PLUGIN, 'instructions', 'animation-mode.instructions.md')));
});

test('the plugin root is the install source, not a copy of it', () => {
  // `--to claude` copies out of the same folder the plugin loads from. If they
  // ever diverge, one of the two deliveries is shipping stale skills.
  assert.equal(resolve(PLUGIN), resolve(ROOT, 'ai-helper'));
});
