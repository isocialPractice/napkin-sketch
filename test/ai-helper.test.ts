/**
 * The `ai-helper/` plugins: one copy of every skill in the tree, and plugins an
 * AI tool can actually load.
 *
 * Both halves are worth a test. The helper used to be built into a second
 * folder, which meant every skill existed twice and the copy went stale; each
 * helper's folder is now the plugin itself, and nothing should quietly
 * reintroduce a duplicate. And a plugin is only loadable when its manifests
 * agree with each other and the files they promise are there, none of which the
 * compiler can check.
 *
 * `ai-helper/` became a container when the second helper arrived, which is why
 * these tests read a registry rather than two constants: adding a third helper
 * should be an entry in one list, not an edit spread across this file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  AI_HELPERS,
  AI_HELPER_ROOT,
  allHelperSkills,
  ANIMATION_PLUGIN,
  GRAPHIC_DESIGNER_PLUGIN,
} from '../src/core/ai-tool.js';
import { ANIMATION_SKILL_NAME, VECTOR_SKILL_NAME } from '../src/core/animation.js';
import { ANIMATION_INSTALL_FILE } from '../src/core/animation-install.js';

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

/**
 * Build outputs and working folders, plus one tracked folder that is skipped
 * on purpose.
 *
 * `generated-skill/` holds a frozen copy of a skill the graphic-designer
 * helper *generated*, kept so `test/generated-skill.test.ts` has something
 * tracked to render. It declares a `name:` like any other skill, but no
 * install carries it and no AI tool loads it - it is test data. The uniqueness
 * rule below is about skills a tool can load, so a fixture belongs outside it.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-test',
  'release',
  'logs',
  'animations',
  'generated-skill',
]);

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
  // An exact set, not a superset: a skill in the tracked tree that no helper
  // declares is one no install would carry, which is a mistake either way.
  assert.deepEqual([...skills.keys()].sort(), allHelperSkills().sort());
});

test('the skill names the app reaches for are the ones the registry lists', () => {
  // `animation.ts` names two skills in every generated form. They have to be
  // the two the vectors helper actually ships, or the form asks for something
  // the tool cannot find.
  const vectors = AI_HELPERS.find((h) => h.name === ANIMATION_PLUGIN.name);
  assert.ok(vectors, 'the vectors helper is not registered');
  assert.deepEqual([...vectors.skills].sort(), [ANIMATION_SKILL_NAME, VECTOR_SKILL_NAME].sort());
});

test('the retired plugin build folder is gone', () => {
  // It held a second copy of both skills, generated from this folder and stale
  // the moment either changed. Nothing writes it now.
  assert.equal(existsSync(join(ROOT, 'plugins')), false);
});

test('the marketplace at the repository root lists every helper', () => {
  const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf-8'));
  assert.equal(market.name, ANIMATION_PLUGIN.marketplace);
  assert.ok(market.owner?.name, 'a marketplace needs an owner');

  for (const helper of AI_HELPERS) {
    const entry = market.plugins.find((p: { name: string }) => p.name === helper.name);
    assert.ok(entry, `${helper.name} is not listed`);
    // The source points at the folder rather than at a copy of it, which is
    // what keeps one skill from becoming two.
    assert.equal(entry.source, `./${helper.dir}`);
  }
});

test('every plugin manifest names its plugin and tracks the package version', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  for (const helper of AI_HELPERS) {
    const path = join(ROOT, helper.dir, '.claude-plugin', 'plugin.json');
    assert.ok(existsSync(path), `${helper.name} has no manifest`);
    const manifest = JSON.parse(readFileSync(path, 'utf-8'));
    assert.equal(manifest.name, helper.name);
    assert.equal(
      manifest.version,
      pkg.version,
      `${helper.name}: run \`npm run ai-helper -- --to plugin\` to sync it`
    );
  }
});

/**
 * The frame subagent has to be able to finish inside the app's stall limit.
 *
 * A frame is 50-80 KB of path data. The agent reaches its output path by
 * copying the file it just edited, which costs nothing; handing the document
 * to a `Write` call instead puts all of it through a tool call, and the run is
 * killed at five minutes having produced nothing. The agent shipped that way
 * from the start and it only shows up when the helper happens to delegate, so
 * the tool list is asserted rather than trusted.
 */
function assertFrameAgentCanFinish(base: string, agents: readonly string[]): void {
  for (const agent of agents) {
    const text = readFileSync(join(base, 'agents', agent), 'utf-8');
    const tools = /^tools:\s*(.+)$/m.exec(text);
    if (!tools) continue; // An agent that declares none inherits them all.
    const granted = tools[1].split(',').map((t) => t.trim());
    assert.ok(
      !granted.includes('Write'),
      `${agent}: a Write tool lets the frame be re-emitted instead of copied`,
    );
    assert.ok(
      granted.some((t) => t === 'Bash' || t === 'PowerShell'),
      `${agent}: without a shell there is no cheap way to reach the output path`,
    );
  }
}

test('every plugin carries the parts its registry entry promises', () => {
  for (const helper of AI_HELPERS) {
    const base = join(ROOT, helper.dir);

    for (const skill of helper.skills) {
      const file = join(base, 'skills', skill, 'SKILL.md');
      assert.ok(existsSync(file), `${helper.name}: ${skill} is missing`);
      assert.equal(skillName(file), skill, `${skill} declares a different name:`);
    }
    for (const command of helper.commands) {
      assert.ok(existsSync(join(base, 'commands', command)), `${helper.name}: ${command} is missing`);
    }
    for (const agent of helper.agents) {
      const path = join(base, 'agents', agent);
      assert.ok(existsSync(path), `${helper.name}: ${agent} is missing`);
      // A subagent answers to its declared name, not to its filename.
      const declared = agent.replace(/\.md$/, '');
      assert.match(readFileSync(path, 'utf-8'), new RegExp(`^name:\\s*${declared}$`, 'm'));
    }
    assertFrameAgentCanFinish(base, helper.agents);
    for (const file of helper.instructions) {
      assert.ok(existsSync(join(base, 'instructions', file)), `${helper.name}: ${file} is missing`);
    }
  }
});

test('each plugin root is its own install source, not a copy of one', () => {
  // `--to claude` copies out of the same folders the plugins load from. If they
  // ever diverge, one of the two deliveries is shipping stale skills.
  assert.equal(resolve(ROOT, ANIMATION_PLUGIN.dir), resolve(ROOT, AI_HELPER_ROOT, 'vectors'));
  assert.equal(
    resolve(ROOT, GRAPHIC_DESIGNER_PLUGIN.dir),
    resolve(ROOT, AI_HELPER_ROOT, 'graphic-designer')
  );

  // And the container holds nothing but those folders, its own README, and the
  // install record the installer drops beside them, so "each helper has an
  // exclusive path" stays true rather than being a claim. The record is
  // untracked and appears on any machine that has run the install, which is
  // every machine that has run `npm install`.
  const allowedFiles = new Set(['README.md', basename(ANIMATION_INSTALL_FILE)]);
  const stray = readdirSync(join(ROOT, AI_HELPER_ROOT), { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .filter((e) =>
      e.isDirectory() ? !AI_HELPERS.some((h) => h.dir.endsWith(`/${e.name}`)) : !allowedFiles.has(e.name)
    )
    .map((e) => e.name);
  assert.deepEqual(stray, [], `${AI_HELPER_ROOT}/ holds something that is not a helper`);
});

test('the installer registry and the app registry agree', () => {
  // The script cannot import the TypeScript, so the two lists are held together
  // here instead. A helper added to one and not the other installs nothing, or
  // installs something the app cannot name.
  const script = readFileSync(join(ROOT, 'scripts', 'install-ai-helper.mjs'), 'utf-8');
  for (const helper of AI_HELPERS) {
    assert.ok(
      new RegExp(`['"]?${helper.name}['"]?\\s*:\\s*\\{`).test(script),
      `install-ai-helper.mjs does not register ${helper.name}`
    );
    assert.ok(script.includes(`\`\${AI_HELPER_ROOT}/${helper.name}\``), `${helper.name}: dir does not match`);
    for (const skill of helper.skills) {
      assert.ok(script.includes(`'${skill}'`), `install-ai-helper.mjs does not install ${skill}`);
    }
    for (const file of [...helper.commands, ...helper.agents, ...helper.instructions]) {
      assert.ok(script.includes(`'${file}'`), `install-ai-helper.mjs does not list ${file}`);
    }
  }
});
