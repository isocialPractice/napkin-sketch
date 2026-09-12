/** AI helper tool identification, failure classification, and install record. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiToolById,
  classifyHelperFailure,
  helperBinary,
  helperToolFor,
  AI_TOOLS,
} from '../src/core/ai-tool.js';
import {
  parseAnimationInstall,
  serializeAnimationInstall,
  normalizeInstallTarget,
  ANIMATION_INSTALL_FILE,
} from '../src/core/animation-install.js';
import { ANIMATION_PLUGIN } from '../src/core/ai-tool.js';

test('helperBinary reads the executable out of a helper command', () => {
  assert.equal(helperBinary('claude -p --model sonnet < _temp/animation-form.txt'), 'claude');
  assert.equal(helperBinary('  copilot -p "hi"  '), 'copilot');
  assert.equal(helperBinary(String.raw`"C:\Program Files\bin\claude.exe" -p`), 'claude');
  assert.equal(helperBinary('/usr/local/bin/codex exec'), 'codex');
  assert.equal(helperBinary('CLAUDE.CMD -p'), 'claude');
  assert.equal(helperBinary(''), '');
});

test('helperToolFor names a known tool and shrugs at an unknown one', () => {
  assert.equal(helperToolFor('claude -p')?.id, 'claude');
  assert.equal(helperToolFor('copilot -p "x"')?.label, 'GitHub Copilot CLI');
  assert.equal(helperToolFor('my-own-llm --run'), null);
});

test('every known tool has an id, binary, dot-folder, and sign-in hint', () => {
  for (const tool of AI_TOOLS) {
    assert.ok(tool.id && tool.binary && tool.label);
    assert.ok(tool.target.startsWith('.'), `${tool.id} installs into a dot-folder`);
    assert.match(tool.signInHint, /terminal/i);
    assert.equal(aiToolById(tool.id.toUpperCase()), tool);
  }
  assert.equal(aiToolById('nope'), null);
});

test('classifyHelperFailure spots a missing tool from the shell and the exit code', () => {
  assert.equal(
    classifyHelperFailure({ code: 1, stderr: "'claude' is not recognized as an internal or external command" }),
    'missing-tool',
  );
  assert.equal(classifyHelperFailure({ code: 127, stderr: '' }), 'missing-tool');
  assert.equal(classifyHelperFailure({ code: 9009, stderr: '' }), 'missing-tool');
  assert.equal(classifyHelperFailure({ code: 1, stderr: 'sh: codex: command not found' }), 'missing-tool');
});

test('classifyHelperFailure spots an unsigned-in tool', () => {
  const auth = [
    'Error: you are not logged in',
    'Please sign in to continue',
    'Unauthorized',
    'authentication required',
    'missing API key',
    'HTTP 401',
    'invalid credential supplied',
  ];
  for (const stderr of auth) {
    assert.equal(classifyHelperFailure({ code: 1, stderr }), 'auth', stderr);
  }
});

test('classifyHelperFailure leaves ordinary failures alone', () => {
  assert.equal(classifyHelperFailure({ code: 1, stderr: 'could not parse the SVG' }), 'other');
  assert.equal(classifyHelperFailure({ code: 0, stderr: '' }), 'other');
  // A run that merely mentions signing in as prose is not an auth failure.
  assert.equal(
    classifyHelperFailure({ code: 2, stderr: 'wrote the frame', stdout: 'the login screen path' }),
    'other',
  );
});

test('the install record round-trips and names no credential', () => {
  const record = {
    version: 1 as const,
    tool: 'claude',
    target: '.claude',
    installedAt: '2026-08-30T00:00:00.000Z',
  };
  const text = serializeAnimationInstall(record);
  assert.deepEqual(parseAnimationInstall(text), record);
  // Nothing about an account may ever be written here.
  assert.ok(!/token|key|secret|password|credential/i.test(text));
});

test('a damaged install record reads as "not installed"', () => {
  assert.equal(parseAnimationInstall('not json'), null);
  assert.equal(parseAnimationInstall('null'), null);
  assert.equal(parseAnimationInstall('{"version":2,"tool":"claude","target":".claude"}'), null);
  assert.equal(parseAnimationInstall('{"version":1,"target":".claude"}'), null);
  assert.equal(parseAnimationInstall('{"version":1,"tool":"  ","target":".claude"}'), null);
  // A record with no timestamp is still a valid install.
  assert.deepEqual(parseAnimationInstall('{"version":1,"tool":"codex","target":".codex"}'), {
    version: 1,
    tool: 'codex',
    target: '.codex',
    installedAt: '',
  });
});

test('the install record lives where the install script writes it', () => {
  // The container's file, not the plugin's. `.gitignore` excludes this exact
  // path, so a record one folder deeper would start committing a local install.
  assert.equal(ANIMATION_INSTALL_FILE, 'ai-helper/installed.json');
});

test('a plugin target recorded before the helpers were split still resolves', () => {
  // `ai-helper/` was the vectors plugin then and is a container now, so a
  // stored `ai-helper` has to be read as naming the plugin that moved out of
  // it - otherwise an uninstall would be pointed at the container root.
  assert.equal(normalizeInstallTarget('ai-helper'), ANIMATION_PLUGIN.dir);
  assert.equal(normalizeInstallTarget('ai-helper/'), ANIMATION_PLUGIN.dir);
  assert.equal(normalizeInstallTarget('  ai-helper  '), ANIMATION_PLUGIN.dir);

  // Everything else is left exactly as it was found.
  assert.equal(normalizeInstallTarget(ANIMATION_PLUGIN.dir), ANIMATION_PLUGIN.dir);
  assert.equal(normalizeInstallTarget('.claude'), '.claude');
  assert.equal(normalizeInstallTarget('.github'), '.github');
  assert.equal(normalizeInstallTarget('ai-helper/graphic-designer'), 'ai-helper/graphic-designer');
});

test('reading an old record migrates its target', () => {
  const legacy = '{"version":1,"tool":"plugin","target":"ai-helper","installedAt":"2026-01-01T00:00:00.000Z"}';
  assert.deepEqual(parseAnimationInstall(legacy), {
    version: 1,
    tool: 'plugin',
    target: ANIMATION_PLUGIN.dir,
    installedAt: '2026-01-01T00:00:00.000Z',
  });
});
