/**
 * A napkin script from a sentence: the form an AI helper reads, the script it
 * saves, and the one more try it gets when that script has errors.
 *
 * `napkin-sketch draw --prompt "a three-box flowchart with arrows"` asks an AI
 * tool for a script instead of reading one. The tool runs with the
 * `napkin-script` skill - the `scripting` helper's, which teaches it the
 * language from the verb table - reads the form this module writes, and saves
 * a script. The script is checked the way `check` checks one; when it has
 * errors the tool runs once more, with a form that carries the script and
 * every diagnostic, so the second try corrects the first rather than guessing
 * again.
 *
 * Nothing here starts a process or touches a disk. The host hands in a
 * function that runs the helper once - the command line's writes the form to
 * `_temp/`, starts the tool through the shell as Animation Mode starts its
 * helper, and reads back what it saved - so the loop is the same in any host
 * and is tested with a stand-in. A run that gives back no script is classified
 * the way Animation Mode classifies one: the tool is missing, is not signed
 * in, or failed.
 */

import { classifyHelperFailure, SCRIPTING_PLUGIN, type HelperFailure } from '../ai-tool.js';
import { formatDiagnostic } from './diagnostics.js';
import { evaluate, type EvaluateOptions } from './evaluate.js';
import type { Diagnostic } from './instructions.js';

/** Where the form goes, relative to the folder the helper runs in. */
export const SCRIPT_FORM_FILE = '_temp/script-form.txt';

/** Where the helper saves the script, relative to the same folder. */
export const SCRIPT_OUT_FILE = '_temp/script-out.napkin';

/** The skill the helper writes with, by its bare name. */
export const SCRIPT_SKILL_NAME = SCRIPTING_PLUGIN.skill;

/**
 * The helper command when none is configured: Claude Code, reading the form on
 * standard input, with a Sonnet-class model, as Animation Mode's default does.
 * Any agentic command-line tool that can read the form and save a file will
 * do; one that prints the script instead of saving it works too.
 */
export const DEFAULT_SCRIPT_HELPER_COMMAND = `claude -p --model sonnet --dangerously-skip-permissions < ${SCRIPT_FORM_FILE}`;

/** How many tries a request gets: the first, and one more with the first one's diagnostics. */
export const SCRIPT_HELPER_ATTEMPTS = 2;

/** What a form carries beside the request. */
export interface ScriptFormOptions {
  /** Which try this is, counting from 1. Default 1. */
  attempt?: number;
  /** How many tries there are in all. Default {@link SCRIPT_HELPER_ATTEMPTS}. */
  attempts?: number;
  /** The script the last try saved, and what checking it reported. */
  previous?: { script: string; diagnostics: readonly Diagnostic[] };
  /** Images the host hands the script, which `image "<name>"` may place. */
  assets?: readonly string[];
  /** Documents the host hands the script, which `use "<name>"` may copy in. */
  documents?: readonly string[];
}

/** Names as a list in a sentence: `a`, `a and b`, `a, b and c`, each in backticks. */
function listed(names: readonly string[]): string {
  const quoted = names.map((name) => `\`${name}\``);
  return quoted.length <= 1 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/**
 * The form the helper reads: the request, how to write the script and where
 * to save it, what the host can hand over, and on a later try the last script
 * with every diagnostic it had.
 */
export function scriptForm(request: string, options: ScriptFormOptions = {}): string {
  const attempt = options.attempt ?? 1;
  const attempts = options.attempts ?? SCRIPT_HELPER_ATTEMPTS;
  const assets = options.assets ?? [];
  const documents = options.documents ?? [];
  const lines = [
    '# A napkin script, from a request',
    '',
    'napkin-sketch is asking for a napkin script. Write one that draws what the',
    `request below asks for, and save it - the script and nothing else - to`,
    `\`${SCRIPT_OUT_FILE}\`, making the folder if it is missing.`,
    '',
    '## The request',
    '',
    request.trim(),
    '',
    '## How to write it',
    '',
    `- Use the \`${SCRIPT_SKILL_NAME}\` skill, which answers to \`${SCRIPTING_PLUGIN.name}:${SCRIPT_SKILL_NAME}\` when`,
    '  it came as a plugin. Its `references/verbs.md` lists every verb.',
    '- Start with `napkin 1`, then a `page`.',
    '- One instruction a line. Paint verbs - `color`, `width`, `fill` and the rest -',
    '  may share a line; nothing else may.',
    '- Put every name in double quotes: `layer "Boxes"`, `text "Start" at 60 40`.',
    '- Save the script alone: no prose around it, and no code fences.',
    '- Do not ask a question. Decide what the request leaves open, and write the',
    '  script.',
    '',
    '## What the host hands over',
    '',
    assets.length > 0 ? `- Images to place by name with \`image\`: ${listed(assets)}.` : '- No images: do not use `image`.',
    documents.length > 0 ? `- Documents to copy in with \`use\`: ${listed(documents)}.` : '- No documents: do not use `use`.',
    '- No other files: a `link` names a file nobody has checked is there.',
  ];
  if (attempt > 1 && options.previous) {
    const printed = options.previous.diagnostics.map((d) => formatDiagnostic(d, 'script-out.napkin'));
    lines.push(
      '',
      `## Try ${attempt} of ${attempts}: fix the last script`,
      '',
      'The last script did not check clean. Fix every line these name, keep what',
      'works, and save the whole script again:',
      '',
      '```text',
      ...printed,
      '```',
      '',
      'The last script:',
      '',
      '```napkin',
      options.previous.script.trimEnd(),
      '```',
    );
  }
  lines.push('', `When it is saved, reply with one short line, such as \`saved ${SCRIPT_OUT_FILE}\`.`, '');
  return lines.join('\n');
}

/** The byte-order mark some editors put in front of a file. */
const BOM = String.fromCharCode(0xfeff);

/** Fenced blocks in text, with the word after each opening fence. */
function fencedBlocks(text: string): Array<{ lang: string; body: string }> {
  return [...text.matchAll(/^```([^\n`]*)\n([\s\S]*?)\n```\s*$/gm)].map((m) => ({ lang: m[1].trim().toLowerCase(), body: m[2] }));
}

/** True when text reads as a script: its first line that is not blank or a comment is `napkin <version>`. */
function startsAsScript(text: string): boolean {
  const first = text.split('\n').find((line) => line.trim() !== '' && !/^\s*#(\s|$)/.test(line));
  return first !== undefined && /^\s*napkin\s+\d+\s*$/i.test(first);
}

/** A script as it is kept: no byte-order mark, one newline at the end. */
function tidy(text: string): string {
  return `${text.replace(/\r\n?/g, '\n').trim()}\n`;
}

/**
 * The script in a file the helper saved: the file itself, or - when a helper
 * wrapped it in a code fence regardless - what the fence holds. Null for a
 * file with nothing in it.
 */
export function scriptFromSaved(text: string): string | null {
  const clean = text.replace(/\r\n?/g, '\n').split(BOM).join('');
  if (clean.trim() === '') return null;
  const blocks = fencedBlocks(clean);
  const block = blocks.find((b) => b.lang === 'napkin') ?? blocks.find((b) => startsAsScript(b.body));
  return tidy(block ? block.body : clean);
}

/**
 * A script a helper printed rather than saved: a fenced block marked `napkin`,
 * else the first fenced block that starts `napkin <version>`, else the whole
 * reply when it starts that way. Null when the reply holds no script.
 */
export function scriptFromReply(text: string): string | null {
  const clean = text.replace(/\r\n?/g, '\n').split(BOM).join('');
  const blocks = fencedBlocks(clean);
  const block = blocks.find((b) => b.lang === 'napkin') ?? blocks.find((b) => startsAsScript(b.body));
  if (block) return tidy(block.body);
  return startsAsScript(clean) ? tidy(clean) : null;
}

/** What one run of the helper gave back. */
export interface ScriptHelperRun {
  /** The file it saved, as text; null when it saved none. */
  saved: string | null;
  /** What it printed. A script printed rather than saved is taken from here. */
  stdout: string;
  stderr: string;
  /** Its exit code; null when it was stopped. */
  code: number | null;
}

/** Runs the helper once on a form, however the host starts it. */
export type ScriptHelperRunner = (form: string, attempt: number) => Promise<ScriptHelperRun>;

/** How {@link promptScript} asks, and checks what comes back. */
export interface PromptScriptOptions extends Pick<ScriptFormOptions, 'assets' | 'documents'> {
  /** Tries in all. Default {@link SCRIPT_HELPER_ATTEMPTS}. */
  attempts?: number;
  /**
   * What a script is checked with: the assets, documents and link resolver the
   * drawing will get, so a name the host hands over is not an error.
   */
  evaluate?: EvaluateOptions;
  /** Told as each try starts. */
  onAttempt?: (attempt: number, attempts: number) => void;
}

/** Why no script came back: the tool is missing, is not signed in, failed, or finished without one. */
export type PromptFailure = HelperFailure | 'no-script';

/** What {@link promptScript} gives back. */
export interface PromptScriptResult {
  /** True when a script came back and checked with no errors. */
  ok: boolean;
  /** The last script the helper wrote; null when none came back at all. */
  script: string | null;
  /** What checking that script reported. */
  diagnostics: Diagnostic[];
  /** How many tries were made. */
  attempts: number;
  /** Why the last try gave back no script, when it gave back none. */
  failure?: PromptFailure;
  /** The last run, for a log or a message. */
  run: ScriptHelperRun;
}

/**
 * Asks the helper for a script that draws `request`, checks it, and on errors
 * asks once more with the script and its diagnostics in the form. Gives back
 * the first script that checks clean, or the last one with its diagnostics,
 * or - when a try gives back nothing - the script before it, if there was one,
 * and why.
 */
export async function promptScript(
  request: string,
  runHelper: ScriptHelperRunner,
  options: PromptScriptOptions = {},
): Promise<PromptScriptResult> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? SCRIPT_HELPER_ATTEMPTS));
  let previous: { script: string; diagnostics: Diagnostic[] } | undefined;
  let last: PromptScriptResult | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    options.onAttempt?.(attempt, attempts);
    const form = scriptForm(request, { attempt, attempts, previous, assets: options.assets, documents: options.documents });
    const run = await runHelper(form, attempt);
    const script = (run.saved !== null ? scriptFromSaved(run.saved) : null) ?? scriptFromReply(run.stdout);
    if (!script) {
      const failure: PromptFailure = run.code === 0 ? 'no-script' : classifyHelperFailure(run);
      return { ok: false, script: previous?.script ?? null, diagnostics: previous?.diagnostics ?? [], attempts: attempt, failure, run };
    }
    const { diagnostics } = evaluate(script, options.evaluate);
    last = { ok: !diagnostics.some((d) => d.level === 'error'), script, diagnostics, attempts: attempt, run };
    if (last.ok) return last;
    previous = { script, diagnostics };
  }
  return last!;
}
