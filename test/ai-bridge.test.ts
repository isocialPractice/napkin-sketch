/**
 * The AI bridge behind `draw --prompt`: the form a script helper reads, the
 * script read back from what it saved or printed, and the loop that checks
 * the script and sends it back once with its diagnostics. Run against a
 * stand-in for the helper, so no AI tool is needed; the command line's half,
 * which starts a real process, is in `cli-draw.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AI_HELPERS, SCRIPTING_PLUGIN } from '../src/core/ai-tool.js';
import {
  DEFAULT_SCRIPT_HELPER_COMMAND,
  promptScript,
  SCRIPT_FORM_FILE,
  SCRIPT_HELPER_ATTEMPTS,
  SCRIPT_OUT_FILE,
  SCRIPT_SKILL_NAME,
  scriptForm,
  scriptFromReply,
  scriptFromSaved,
  type ScriptHelperRun,
} from '../src/core/script/ai-bridge.js';
import { evaluate } from '../src/core/script/index.js';
import { LOGO } from './helpers/script-fixtures.js';

const GOOD = 'napkin 1\npage 200 100\nname "card"\nrect 10 10 180 80 r 8\n';
const BAD = 'napkin 1\npage 200 100\nbox 10 10 180 80\n';

/** A run that saved `text`, and said so. */
function saved(text: string | null, run: Partial<ScriptHelperRun> = {}): ScriptHelperRun {
  return { saved: text, stdout: `saved ${SCRIPT_OUT_FILE}\n`, stderr: '', code: 0, ...run };
}

test('the form carries the request, the two rules, where to save, and what the host hands over', () => {
  const form = scriptForm('a three-box flowchart with arrows', { assets: ['logo', 'seal'] });
  assert.match(form, /^# A napkin script, from a request\n/);
  assert.ok(form.includes('\n## The request\n\na three-box flowchart with arrows\n'));
  assert.ok(form.includes(`\`${SCRIPT_OUT_FILE}\``), 'where to save');
  assert.ok(form.includes(`\`${SCRIPT_SKILL_NAME}\``) && form.includes(`\`${SCRIPTING_PLUGIN.name}:${SCRIPT_SKILL_NAME}\``), 'the skill, both ways it answers');
  assert.ok(form.includes('- One instruction a line.') && form.includes('- Put every name in double quotes'), 'the two rules');
  assert.ok(form.includes('- Images to place by name with `image`: `logo` and `seal`.'));
  assert.ok(form.includes('- No documents: do not use `use`.'));
  assert.doesNotMatch(form, /## Try \d/, 'a first try carries no diagnostics');
  assert.deepEqual([...form].filter((c) => c.charCodeAt(0) > 126), [], 'ASCII, so a tool reads it the same in any encoding');
});

test('a second try carries the last script and every diagnostic it had, printed as check prints them', () => {
  const { diagnostics } = evaluate(BAD);
  const form = scriptForm('a card', { attempt: 2, attempts: 2, previous: { script: BAD, diagnostics } });
  assert.ok(form.includes('## Try 2 of 2: fix the last script'));
  assert.match(form, /\nscript-out\.napkin:3:1: error unknown-verb: /);
  assert.ok(form.includes('```napkin\nnapkin 1\npage 200 100\nbox 10 10 180 80\n```'));
});

test('a script is read from the file the helper saved, unwrapped from a fence it should not have used', () => {
  assert.equal(scriptFromSaved(GOOD), GOOD);
  assert.equal(scriptFromSaved(String.fromCharCode(0xfeff) + GOOD.replace(/\n/g, '\r\n')), GOOD, 'a byte-order mark and CRLF');
  assert.equal(scriptFromSaved('```napkin\n' + GOOD + '```\n'), GOOD);
  assert.equal(scriptFromSaved('Here it is:\n\n```\n' + GOOD + '```\n'), GOOD);
  assert.equal(scriptFromSaved('  \n'), null, 'an empty file is no script');
});

test('a script printed instead is read from the reply, and a reply with none gives none', () => {
  assert.equal(scriptFromReply('Here is the script:\n\n```napkin\n' + GOOD + '```\n\nIt draws a card.'), GOOD);
  assert.equal(scriptFromReply('```\n' + GOOD + '```'), GOOD, 'an unmarked fence that starts napkin 1');
  assert.equal(scriptFromReply(GOOD), GOOD, 'a reply that is the script');
  assert.equal(scriptFromReply('```js\nconsole.log(1)\n```'), null);
  assert.equal(scriptFromReply(`saved ${SCRIPT_OUT_FILE}`), null);
});

test('a script that checks clean is taken on the first try', async () => {
  const forms: string[] = [];
  const result = await promptScript('a card', async (form) => {
    forms.push(form);
    return saved(GOOD);
  });
  assert.deepEqual([result.ok, result.script, result.attempts, result.failure, result.diagnostics], [true, GOOD, 1, undefined, []]);
  assert.equal(forms.length, 1);
});

test('a script with errors goes back once with them, and the fix is taken', async () => {
  const forms: string[] = [];
  const attempts: string[] = [];
  const result = await promptScript(
    'a card',
    async (form, attempt) => {
      forms.push(form);
      return saved(attempt === 1 ? BAD : GOOD);
    },
    { onAttempt: (attempt, of) => attempts.push(`${attempt}/${of}`) },
  );
  assert.deepEqual([result.ok, result.script, result.attempts], [true, GOOD, 2]);
  assert.deepEqual(attempts, ['1/2', '2/2']);
  assert.match(forms[1], /## Try 2 of 2/);
  assert.match(forms[1], /error unknown-verb/);
});

test('a script still wrong after the last try comes back with its diagnostics, for the host to draw what it can', async () => {
  let runs = 0;
  const result = await promptScript('a card', async () => {
    runs++;
    return saved(BAD);
  });
  assert.equal(runs, SCRIPT_HELPER_ATTEMPTS);
  assert.deepEqual([result.ok, result.script, result.attempts], [false, BAD, 2]);
  assert.deepEqual(result.diagnostics.filter((d) => d.level === 'error').map((d) => d.code), ['unknown-verb']);
});

test('a helper that gives back nothing is told apart: missing, signed out, failed, or silent', async () => {
  const none = (run: Partial<ScriptHelperRun>) => promptScript('a card', async () => ({ saved: null, stdout: '', stderr: '', code: 0, ...run }));
  assert.equal((await none({ stdout: 'I could not decide what to draw.' })).failure, 'no-script');
  assert.equal((await none({ code: 127, stderr: 'sh: claude: command not found' })).failure, 'missing-tool');
  assert.equal((await none({ code: 1, stderr: 'Error: not logged in. Please log in.' })).failure, 'auth');
  assert.equal((await none({ code: 2, stderr: 'rate limited' })).failure, 'other');
  const silent = await none({});
  assert.deepEqual([silent.ok, silent.script, silent.attempts], [false, null, 1], 'no second try when the first gave back nothing');
});

test('when the second try gives back nothing, the first script comes back with its diagnostics', async () => {
  const result = await promptScript('a card', async (_form, attempt) =>
    attempt === 1 ? saved(BAD) : { saved: null, stdout: '', stderr: '', code: 0 },
  );
  assert.deepEqual([result.ok, result.script, result.attempts, result.failure], [false, BAD, 2, 'no-script']);
  assert.ok(result.diagnostics.some((d) => d.code === 'unknown-verb'));
});

test('an image the host hands over is no error when the script is checked', async () => {
  const placed = 'napkin 1\npage 200 100\nimage "logo" at 10 10 size 40\n';
  const alone = await promptScript('a card', async () => saved(placed), { attempts: 1 });
  assert.deepEqual(alone.diagnostics.map((d) => d.code), ['unknown-asset'], 'an image nobody handed over');
  const handed = await promptScript('a card', async () => saved(placed), { attempts: 1, assets: ['logo'], evaluate: { assets: { logo: LOGO } } });
  assert.equal(handed.ok, true);
});

test('the default helper reads the form the bridge writes, with the skill the registry lists', () => {
  assert.match(DEFAULT_SCRIPT_HELPER_COMMAND, /^claude -p /);
  assert.ok(DEFAULT_SCRIPT_HELPER_COMMAND.endsWith(`< ${SCRIPT_FORM_FILE}`));
  const scripting = AI_HELPERS.find((helper) => helper.name === SCRIPTING_PLUGIN.name);
  assert.deepEqual(scripting?.skills, [SCRIPT_SKILL_NAME]);
});
