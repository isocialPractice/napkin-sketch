/**
 * The command line's drawing commands - `draw`, `check`, `render` and
 * `verbs` - as one function of the arguments, standard input and output, and
 * a working folder, which returns the exit code.
 *
 * Nothing here reaches Electron or opens a window, so the commands run on an
 * install where the GUI cannot start; and nothing here touches `process`, so
 * the tests call it with strings and no process is spawned.
 *
 * Output is for a person by default: diagnostics and warnings on standard
 * error in the `file:line:column: level code: message` form editors and CI
 * read, and the files written on standard output, a path a line. With
 * `--json` it is one line of JSON on standard output and nothing else.
 *
 * `draw --prompt` is the one command that starts another program: an AI
 * tool, which writes the script from a request (see `helper.ts` and
 * `core/script/ai-bridge.ts`) before it is drawn as any other script is.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { helperBinary, helperToolFor, type AiTool } from '../core/ai-tool.js';
import { resolveLinkFromDir } from '../core/graphic-design/files.js';
import type { LinkResolver } from '../core/link.js';
import {
  drawToFiles,
  fileStem,
  loadAssets,
  loadDocuments,
  scriptName,
  writeBook,
  type DrawToFilesOptions,
  type WrittenFile,
} from '../core/script-files.js';
import {
  DEFAULT_SCRIPT_HELPER_COMMAND,
  promptScript,
  SCRIPT_OUT_FILE,
  type PromptFailure,
  type PromptScriptResult,
} from '../core/script/ai-bridge.js';
import { MeasuredFramesError, measuredFramesScript } from '../core/script/animation.js';
import { formatDiagnostic, makeDiagnostic } from '../core/script/diagnostics.js';
import { evaluate, type ScriptSource, type ScriptStats } from '../core/script/evaluate.js';
import { DIAGNOSTICS, SCRIPT_VERSION, VERB_CATEGORIES, VERBS, type Diagnostic } from '../core/script/instructions.js';
import { SHAPE_NAMES } from '../core/script/library.js';
import type { RenderFormat } from '../core/script/render.js';
import { readSketchBook } from '../core/sketchbook.js';
import type { SketchBook } from '../core/types.js';
import { parseArgs, type Command, type CommandArgs } from './args.js';
import { onPath, runScriptHelper } from './helper.js';

/** The exit codes, which callers in other languages branch on. */
export const EXIT = {
  /** It drew, or the script checked clean. */
  ok: 0,
  /** The arguments were wrong. */
  usage: 1,
  /** The script had errors, or with `--strict`, anything was reported. The files that could be drawn are still written unless `--strict`. */
  script: 2,
  /** A file could not be read or written: the script, an asset, a document, a linked file, or the output folder. */
  io: 3,
  /** `draw --prompt` got no script back: the AI helper is not installed, not signed in, or failed. */
  helper: 4,
} as const;

/** What each exit code means, in a line: the table the documentation lists them from. */
export const EXIT_SUMMARIES: { readonly [K in keyof typeof EXIT]: string } = {
  ok: 'It drew, the script checked clean, or the book was written.',
  usage: 'The arguments were wrong: an unknown option, a bad value, no script. Nothing is written.',
  script: 'The script had errors, render was given a file that is not a book, or --animate found no figure on its page; with --strict, anything reported at all. What could be drawn is written, unless --strict.',
  io: 'A file could not be read or written. A linked file that could not be read is drawn as its placeholder and the files are written; for anything else, nothing is.',
  helper: 'draw --prompt got no script back: the AI helper is not installed, is not signed in, or failed. Nothing is written.',
};

/** What a command reads and writes, handed in so nothing reaches for `process`. */
export interface CommandIo {
  /** The arguments after the program's name: `['draw', 'card.napkin', '--to', 'png']`. */
  argv: readonly string[];
  /** Standard input, read whole when the script is `-`: a stream, or the text itself. */
  stdin: NodeJS.ReadableStream | string;
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  /** The folder every relative path is read against. */
  cwd: string;
  /** The package's version, for `--json`. */
  version?: string;
  /** The environment, which `draw --prompt` reads `NAPKIN_SCRIPT_HELPER` from. */
  env?: Readonly<Record<string, string | undefined>>;
}

/** What a drawing command reports: printed for a person, or as one line of JSON with `--json`. */
export interface CommandReport {
  /** True exactly when the exit code is 0. */
  ok: boolean;
  exitCode: number;
  /** The files written, as paths from the working folder, or absolute when `--out` was. */
  files: Array<{ path: string; format: RenderFormat; page?: number }>;
  /** What the script reported, reading and running together, in reading order. */
  diagnostics: Diagnostic[];
  /** What a format left out or drew as a stand-in. */
  warnings: string[];
  /** How much the run did; null when no script ran. */
  stats: ScriptStats | null;
  /**
   * The script the command wrote before drawing: for `draw --prompt`, the
   * one the AI helper wrote, how many tries it took, and where it was kept -
   * absent when `--strict` wrote nothing; for `render --animate`, the one
   * that draws the frames, which copies the page's parts in and so is not
   * kept on its own.
   */
  script?: { path?: string; attempts?: number; text: string };
  /**
   * Why the command stopped, when it was the arguments, a file, a book that
   * could not be read, or an AI helper that gave back no script, and for that
   * last, what the helper did.
   */
  error?: { kind: 'usage' | 'io' | 'input' | 'helper'; message: string; reason?: PromptFailure };
  /** The package's version. */
  version: string;
  /** The napkin script version this build reads. */
  language: number;
}

/** A file that could not be read or written: exit code 3. */
class IoError extends Error {}

/** A command's own help, which `<command> --help` prints. */
export const COMMAND_HELP: { readonly [C in Command]: string } = {
  draw: `napkin-sketch draw <script | -> [options]
napkin-sketch draw --prompt "<request>" [options]

Draws a napkin script to files, with no window. "-" reads the script from
standard input; a .json script, or standard input starting with "[", is the
object form. With --prompt an AI tool writes the script from the request
first: it is checked, sent back once with its errors if it has any, drawn,
and kept as <name>.napkin beside the files.

Options:
  --to <formats>          svg, png, pdf, skbk, jsx, comma-separated (default:
                          svg); jsx is a script that rebuilds the drawing in
                          Adobe Illustrator
  --out <dir>             The folder to write into (default: the current one)
  --name <stem>           The files' name (default: the script's name, else
                          the script file's)
  --base <dir>            The folder linked files are read inside (default:
                          the script's folder)
  --asset <name>=<file>   An image the script places by name; repeatable
  --use <name>=<book>     A .skbk book the script copies in; repeatable
  --seed <n>              The seed for the hand-drawn pass
  --scale <n>             PNG pixels a page pixel (default: 1)
  --crop auto|none|<x,y,w,h>
                          What every file is cut to (default: the script's crop)
  --limit <n>             The most instructions a run may execute
  --prompt <request>      Ask the AI helper for a script that draws this
  --helper <command>      The helper command (default: $NAPKIN_SCRIPT_HELPER,
                          else claude -p --model sonnet
                          --dangerously-skip-permissions < _temp/script-form.txt)
  --json                  Print one line of JSON on standard output, nothing else
  --strict                Write nothing when anything at all is reported
  --quiet                 Print errors and nothing else
  -h, --help              Show this help

Exit codes: 0 drew; 1 the arguments were wrong; 2 the script had errors (what
could be drawn is still written, unless --strict); 3 a file could not be read
or written; 4 --prompt got no script back from the AI helper.
`,
  check: `napkin-sketch check <script | -> [options]

Reads and runs a script, writes nothing, and reports what is wrong with it.

Options:
  --base <dir>            The folder linked files are read inside
  --asset <name>=<file>   An image the script places by name; repeatable
  --use <name>=<book>     A .skbk book the script copies in; repeatable
  --seed <n>              The seed for the hand-drawn pass
  --limit <n>             The most instructions a run may execute
  --json                  Print one line of JSON on standard output, nothing else
  --strict                Fail on a warning as on an error
  --quiet                 Print errors and nothing else
  -h, --help              Show this help

Exit codes: 0 no errors; 1 the arguments were wrong; 2 the script has errors,
or with --strict, anything at all; 3 a file could not be read.
`,
  render: `napkin-sketch render <book.skbk> [options]

Writes a sketch book - one the app saved, or one a script drew - as files.
With --animate, writes the figure on its first page, or on --page, as
animation frames instead: a frame a page, each posed from a measured cycle
with no AI, every frame cut to one box so the frames line up.

Options:
  --to <formats>          svg, png, pdf, skbk, jsx, comma-separated (default:
                          svg); jsx is a script that rebuilds the book in
                          Adobe Illustrator
  --page <n>              Only this page, counting from 1
  --animate <type>        Draw the page's figure through a measured cycle:
                          walk, run, ideal (the app's Idle) or knocked-down
  --frames <n>            How many frames the cycle is spread across (default:
                          the cycle's own length)
  --facing left|right     Which way the figure travels (default: read from its
                          feet)
  --out <dir>             The folder to write into (default: the current one)
  --name <stem>           The files' name (default: the book file's; with
                          --animate, the book file's and the animation's)
  --base <dir>            The folder linked files are read inside (default:
                          the book's folder)
  --scale <n>             PNG pixels a page pixel (default: 1)
  --crop auto|none|<x,y,w,h>
                          What every file is cut to (default: the whole page)
  --json                  Print one line of JSON on standard output, nothing else
  --strict                Write nothing when a format leaves anything out
  --quiet                 Print errors and nothing else
  -h, --help              Show this help

Exit codes: 0 wrote; 1 the arguments were wrong; 2 the book could not be read
as a book, its page has no figure for --animate, or with --strict, a format
left something out; 3 a file could not be read or written.
`,
  verbs: `napkin-sketch verbs [options]

Lists napkin script's verbs by category, each with how it is written and what
it does, and the shapes the shape library draws.

Options:
  --category <name>       Only this category: ${VERB_CATEGORIES.map((category) => category.id).join(', ')}
  --json                  The verb table, the categories, the shapes and the
                          diagnostic codes, as one line of JSON
  -h, --help              Show this help
`,
};

/** Runs a subcommand and returns its exit code. `io.argv` must start with a command word. */
export async function runCommand(io: CommandIo): Promise<number> {
  const args = parseArgs([...io.argv]).command;
  if (!args) throw new Error(`napkin-sketch: "${io.argv[0] ?? ''}" is not a command`);
  if (args.help) {
    io.stdout.write(COMMAND_HELP[args.command]);
    return EXIT.ok;
  }
  const report: CommandReport = {
    ok: false,
    exitCode: EXIT.ok,
    files: [],
    diagnostics: [],
    warnings: [],
    stats: null,
    version: io.version ?? 'unknown',
    language: SCRIPT_VERSION,
  };
  if (args.errors.length > 0) return finish(io, args, report, EXIT.usage, { kind: 'usage', message: args.errors.join('; ') });
  if (args.command === 'verbs') return verbs(io, args, report);
  try {
    if (args.command === 'draw') return await draw(io, args, report);
    if (args.command === 'check') return await check(io, args, report);
    return await render(io, args, report);
  } catch (err) {
    if (err instanceof IoError) return finish(io, args, report, EXIT.io, { kind: 'io', message: err.message });
    throw err;
  }
}

/** Sets the exit code, prints the report, and returns the code. */
function finish(io: CommandIo, args: CommandArgs, report: CommandReport, code: number, error?: CommandReport['error']): number {
  report.exitCode = code;
  report.ok = code === EXIT.ok;
  if (error) report.error = error;
  if (args.json) {
    io.stdout.write(`${JSON.stringify(report)}\n`);
    return code;
  }
  const label = args.input === '-' ? '<stdin>' : args.input ?? args.command;
  for (const diagnostic of report.diagnostics) {
    if (args.quiet && diagnostic.level !== 'error') continue;
    io.stderr.write(`${formatDiagnostic(diagnostic, label)}\n`);
  }
  if (!args.quiet) for (const warning of report.warnings) io.stderr.write(`${label}: warning: ${warning}\n`);
  if (error) {
    io.stderr.write(`napkin-sketch: ${error.message}\n`);
    if (error.kind === 'usage') io.stderr.write(`Run "napkin-sketch ${args.command} --help" for its options.\n`);
  }
  if (!args.quiet && report.script?.path) io.stdout.write(`${report.script.path}\n`);
  if (!args.quiet) for (const file of report.files) io.stdout.write(`${file.path}\n`);
  if (args.command === 'check' && !args.quiet && !error) {
    const errors = report.diagnostics.filter((d) => d.level === 'error').length;
    const warnings = report.diagnostics.length - errors;
    const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
    io.stderr.write(`${label}: ${errors + warnings === 0 ? 'no problems' : `${count(errors, 'error')}, ${count(warnings, 'warning')}`}\n`);
  }
  return code;
}

/** Reads standard input whole. */
async function readAll(stdin: NodeJS.ReadableStream | string): Promise<string> {
  if (typeof stdin === 'string') return stdin;
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

/** The line and column, from 1, of a character offset in text. */
function lineColumn(text: string, offset: number): { line: number; column: number } {
  const lines = text.slice(0, offset).split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/**
 * A script from text: the object form when `json` is true, napkin script text
 * otherwise. Text that is not JSON, or JSON that is not an array, is no script
 * at all, and comes back as a diagnostic so `--json` callers read it where
 * they read every other problem.
 */
function scriptFrom(text: string, json: boolean): { source: ScriptSource | null; diagnostics: Diagnostic[] } {
  if (!json) return { source: text, diagnostics: [] };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const message = (err as Error).message;
    const at = /position (\d+)/.exec(message);
    return {
      source: null,
      diagnostics: [makeDiagnostic('unexpected-token', `The script is not JSON: ${message}`, at ? lineColumn(text, Number(at[1])) : {})],
    };
  }
  if (!Array.isArray(value)) {
    return { source: null, diagnostics: [makeDiagnostic('invalid-value', 'A script in JSON is an array of instructions, each an object naming its `verb`.')] };
  }
  return { source: value, diagnostics: [] };
}

/** Reads the script a command names: a file, or standard input for `-`. */
async function readScriptInput(io: CommandIo, input: string): Promise<{ source: ScriptSource | null; diagnostics: Diagnostic[] }> {
  let text: string;
  if (input === '-') {
    text = await readAll(io.stdin);
  } else {
    try {
      text = await readFile(resolve(io.cwd, input), 'utf8');
    } catch (err) {
      throw new IoError(`cannot read ${input}: ${(err as Error).message}`);
    }
  }
  text = text.replace(/^\uFEFF/, '');
  return scriptFrom(text, input === '-' ? /^\s*[[{]/.test(text) : /\.json$/i.test(input));
}

/** A link resolver inside `base` that remembers every link it could not read. */
function watchedLinks(base: string): { resolveLink: LinkResolver; unread: string[] } {
  const read = resolveLinkFromDir(base);
  const unread: string[] = [];
  return {
    resolveLink: (href) => {
      const file = read(href);
      if (!file && !unread.includes(href)) unread.push(href);
      return file;
    },
    unread,
  };
}

/** Why the linked files a command could not read stop it with exit code 3. */
function unreadMessage(unread: readonly string[], base: string, cwd: string): string {
  const where = relative(cwd, base) || '.';
  return `${unread.length === 1 ? 'a linked file' : 'linked files'} could not be read inside ${where}: ${unread.join(', ')}; ${
    unread.length === 1 ? 'it was drawn as its placeholder' : 'they were drawn as their placeholders'
  }`;
}

/** Host-named files as paths from `cwd`; a data URL is kept as it is. */
function fromCwd(files: Readonly<Record<string, string>>, cwd: string): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([name, file]) => [name, file.startsWith('data:') ? file : resolve(cwd, file)]));
}

/** A path as a person reads it: from the working folder, unless `--out` was absolute. */
function shownPath(path: string, args: CommandArgs, cwd: string): string {
  return args.out && isAbsolute(args.out) ? path : relative(cwd, path) || path;
}

/** Paths as a person reads them: from the working folder, unless `--out` was absolute. */
function shown(files: readonly WrittenFile[], args: CommandArgs, cwd: string): CommandReport['files'] {
  return files.map((file) => ({ ...file, path: shownPath(file.path, args, cwd) }));
}

async function draw(io: CommandIo, args: CommandArgs, report: CommandReport): Promise<number> {
  if (args.prompt !== undefined) return drawFromPrompt(io, args, report, args.prompt);
  const input = args.input!;
  const read = await readScriptInput(io, input);
  if (!read.source) {
    report.diagnostics = read.diagnostics;
    return finish(io, args, report, EXIT.script);
  }
  const base = resolve(io.cwd, args.base ?? (input === '-' ? '.' : dirname(input)));
  return drawSource(io, args, report, read.source, {
    base,
    links: watchedLinks(base),
    defaultName: input === '-' ? undefined : scriptName(input),
    assets: fromCwd(args.assets, io.cwd),
    documents: fromCwd(args.documents, io.cwd),
  });
}

/** Where a script in hand is drawn from: its links' folder, its name, and what the host hands it. */
interface DrawFrom {
  base: string;
  links: ReturnType<typeof watchedLinks>;
  defaultName: string | undefined;
  assets: DrawToFilesOptions['assets'];
  documents: DrawToFilesOptions['documents'];
}

/** Draws a script in hand to the files the arguments ask for, and reports it. */
async function drawSource(io: CommandIo, args: CommandArgs, report: CommandReport, source: ScriptSource, from: DrawFrom): Promise<number> {
  const { base, links } = from;
  let result;
  try {
    result = await drawToFiles(source, {
      out: resolve(io.cwd, args.out ?? '.'),
      base,
      name: args.name,
      defaultName: from.defaultName,
      formats: args.formats,
      assets: from.assets,
      documents: from.documents,
      resolveLink: links.resolveLink,
      seed: args.seed,
      ...(args.limit !== undefined ? { limits: { instructions: args.limit } } : {}),
      scale: args.scale,
      crop: args.crop,
      strict: args.strict,
    });
  } catch (err) {
    throw new IoError((err as Error).message.replace(/^napkin-sketch: /, ''));
  }
  report.files = shown(result.files, args, io.cwd);
  report.diagnostics = result.diagnostics;
  report.warnings = result.warnings;
  report.stats = result.stats;
  if (links.unread.length > 0) return finish(io, args, report, EXIT.io, { kind: 'io', message: unreadMessage(links.unread, base, io.cwd) });
  return finish(io, args, report, result.ok ? EXIT.ok : EXIT.script);
}

/** The first line of a tool's output worth quoting in a message. */
function firstLine(text: string): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '') ?? '';
  return line.length > 200 ? `${line.slice(0, 199)}...` : line;
}

/** Why a prompt run gave back no script, in a sentence that says what to do. */
function helperMessage(result: PromptScriptResult, label: string, tool: AiTool | null): string {
  const said = firstLine(result.run.stderr) || firstLine(result.run.stdout);
  switch (result.failure) {
    case 'missing-tool':
      return `${label} could not be started${said ? `: ${said}` : ''}`;
    case 'auth':
      return `${label} is not signed in. ${tool?.signInHint ?? `Sign in to ${label}, then try again.`}`;
    case 'no-script':
      return `${label} finished without saving a script to ${SCRIPT_OUT_FILE} or printing one`;
    default:
      return `${label} failed${result.run.code !== null ? ` with exit code ${result.run.code}` : ''}${said ? `: ${said}` : ''}`;
  }
}

/**
 * `draw --prompt`: asks the AI helper for a script, keeps it as
 * `<name>.napkin` in the output folder, and draws it. The helper runs in the
 * working folder, where a project's installed skill is found, and reads its
 * links, assets and documents from there as a script from standard input
 * would.
 */
async function drawFromPrompt(io: CommandIo, args: CommandArgs, report: CommandReport, request: string): Promise<number> {
  const command = args.helper ?? (io.env?.NAPKIN_SCRIPT_HELPER?.trim() || DEFAULT_SCRIPT_HELPER_COMMAND);
  const binary = helperBinary(command);
  const tool = helperToolFor(command);
  const label = tool?.label ?? (binary || 'The AI helper');
  if (!binary || !onPath(binary)) {
    return finish(io, args, report, EXIT.helper, {
      kind: 'helper',
      reason: 'missing-tool',
      message: `${label} was not found on the PATH: install it, or name another helper with --helper or NAPKIN_SCRIPT_HELPER`,
    });
  }
  const base = resolve(io.cwd, args.base ?? '.');
  const links = watchedLinks(base);
  let assets: Record<string, string> = {};
  let documents: Awaited<ReturnType<typeof loadDocuments>> = {};
  try {
    if (Object.keys(args.assets).length > 0) assets = await loadAssets(fromCwd(args.assets, io.cwd));
    if (Object.keys(args.documents).length > 0) documents = await loadDocuments(fromCwd(args.documents, io.cwd));
  } catch (err) {
    throw new IoError((err as Error).message.replace(/^napkin-sketch: /, ''));
  }
  const say = (text: string): void => {
    if (!args.json && !args.quiet) io.stderr.write(`napkin-sketch: ${text}\n`);
  };
  const result = await promptScript(request, (form) => runScriptHelper(command, io.cwd, form), {
    assets: Object.keys(assets),
    documents: Object.keys(documents),
    evaluate: {
      seed: args.seed,
      ...(args.limit !== undefined ? { limits: { instructions: args.limit } } : {}),
      assets,
      documents,
      resolveLink: links.resolveLink,
    },
    onAttempt: (attempt, attempts) =>
      say(attempt === 1 ? `asking ${label} for a script` : `the script had errors; asking ${label} to fix them, try ${attempt} of ${attempts}`),
  });
  if (!result.script) {
    return finish(io, args, report, EXIT.helper, { kind: 'helper', reason: result.failure ?? 'no-script', message: helperMessage(result, label, tool) });
  }
  if (result.failure) say(`${helperMessage(result, label, tool)}; drawing the script from the try before`);
  report.script = { attempts: result.attempts, text: result.script };
  // The script is kept under the drawing's own name, so it can be edited and drawn again without asking.
  if (!(args.strict && result.diagnostics.length > 0)) {
    const out = resolve(io.cwd, args.out ?? '.');
    const page = evaluate(result.script, { name: 'drawing' }).book.sketches[0]?.name;
    const path = join(out, `${fileStem(args.name ?? page ?? 'drawing')}.napkin`);
    try {
      await mkdir(out, { recursive: true });
      await writeFile(path, result.script, 'utf8');
    } catch (err) {
      throw new IoError(`cannot write ${path}: ${(err as Error).message}`);
    }
    report.script.path = shownPath(path, args, io.cwd);
  }
  return drawSource(io, args, report, result.script, { base, links, defaultName: 'drawing', assets, documents });
}

async function check(io: CommandIo, args: CommandArgs, report: CommandReport): Promise<number> {
  const input = args.input!;
  const read = await readScriptInput(io, input);
  if (!read.source) {
    report.diagnostics = read.diagnostics;
    return finish(io, args, report, EXIT.script);
  }
  const base = resolve(io.cwd, args.base ?? (input === '-' ? '.' : dirname(input)));
  const links = watchedLinks(base);
  let assets: Record<string, string> | undefined;
  let documents: Awaited<ReturnType<typeof loadDocuments>> | undefined;
  try {
    if (Object.keys(args.assets).length > 0) assets = await loadAssets(fromCwd(args.assets, io.cwd));
    if (Object.keys(args.documents).length > 0) documents = await loadDocuments(fromCwd(args.documents, io.cwd));
  } catch (err) {
    throw new IoError((err as Error).message.replace(/^napkin-sketch: /, ''));
  }
  const result = evaluate(read.source, {
    ...(input === '-' ? {} : { name: scriptName(input) }),
    seed: args.seed,
    ...(args.limit !== undefined ? { limits: { instructions: args.limit } } : {}),
    assets,
    documents,
    resolveLink: links.resolveLink,
  });
  report.diagnostics = result.diagnostics;
  report.stats = result.stats;
  if (links.unread.length > 0) return finish(io, args, report, EXIT.io, { kind: 'io', message: unreadMessage(links.unread, base, io.cwd) });
  const failed = !result.ok || (args.strict && result.diagnostics.length > 0);
  return finish(io, args, report, failed ? EXIT.script : EXIT.ok);
}

async function render(io: CommandIo, args: CommandArgs, report: CommandReport): Promise<number> {
  const input = args.input!;
  let book: SketchBook;
  try {
    book = await readSketchBook(resolve(io.cwd, input));
  } catch (err) {
    const message = (err as Error).message;
    if ((err as NodeJS.ErrnoException).code) throw new IoError(`cannot read ${input}: ${message}`);
    return finish(io, args, report, EXIT.script, { kind: 'input', message: `${input}: ${message}` });
  }
  const pages = book.sketches.length;
  if (args.page !== undefined && args.page > pages) {
    return finish(io, args, report, EXIT.usage, {
      kind: 'usage',
      message: `${input} has ${pages} page${pages === 1 ? '' : 's'}; there is no page ${args.page}`,
    });
  }
  if (args.animate !== undefined) return animate(io, args, report, book, input, args.animate);
  const stem = scriptName(input);
  const name = args.name ?? (args.page !== undefined && pages > 1 ? `${stem}-${args.page}` : stem);
  const base = resolve(io.cwd, args.base ?? dirname(input));
  const links = watchedLinks(base);
  let files: WrittenFile[];
  try {
    files = await writeBook(args.page !== undefined ? { ...book, sketches: [book.sketches[args.page - 1]] } : book, {
      out: resolve(io.cwd, args.out ?? '.'),
      base,
      name,
      formats: args.formats,
      crop: args.crop,
      scale: args.scale,
      resolveLink: links.resolveLink,
      strict: args.strict,
      onWarning: (message) => report.warnings.push(message),
    });
  } catch (err) {
    throw new IoError((err as Error).message.replace(/^napkin-sketch: /, ''));
  }
  report.files = shown(files, args, io.cwd);
  if (links.unread.length > 0) return finish(io, args, report, EXIT.io, { kind: 'io', message: unreadMessage(links.unread, base, io.cwd) });
  return finish(io, args, report, args.strict && report.warnings.length > 0 ? EXIT.script : EXIT.ok);
}

/**
 * `render --animate`: the figure on the chosen page drawn through a measured
 * cycle, with no AI, a frame a page, every frame cut to the one registration
 * box the script sets. The script is the report's `script`; it copies the
 * page's parts in by name, so it is not written as a file of its own.
 */
async function animate(io: CommandIo, args: CommandArgs, report: CommandReport, book: SketchBook, input: string, type: string): Promise<number> {
  const page = book.sketches[(args.page ?? 1) - 1];
  let plan;
  try {
    plan = measuredFramesScript(page, { type, frames: args.frames, facing: args.facing });
  } catch (err) {
    if (err instanceof MeasuredFramesError) return finish(io, args, report, EXIT.script, { kind: 'input', message: `${input}: ${err.message}` });
    throw err;
  }
  const result = evaluate(plan.script, { documents: plan.documents, timestamp: page.updatedAt });
  report.script = { text: plan.text };
  report.diagnostics = result.diagnostics;
  report.stats = result.stats;
  const stem = scriptName(input);
  const name = args.name ?? `${args.page !== undefined && book.sketches.length > 1 ? `${stem}-${args.page}` : stem}-${type}`;
  const base = resolve(io.cwd, args.base ?? dirname(input));
  const links = watchedLinks(base);
  let files: WrittenFile[];
  try {
    files = await writeBook(result.book, {
      out: resolve(io.cwd, args.out ?? '.'),
      base,
      name,
      formats: args.formats,
      registration: result.output.registration,
      scale: args.scale,
      resolveLink: links.resolveLink,
      strict: args.strict,
      onWarning: (message) => report.warnings.push(message),
    });
  } catch (err) {
    throw new IoError((err as Error).message.replace(/^napkin-sketch: /, ''));
  }
  report.files = shown(files, args, io.cwd);
  if (links.unread.length > 0) return finish(io, args, report, EXIT.io, { kind: 'io', message: unreadMessage(links.unread, base, io.cwd) });
  const failed = !result.ok || (args.strict && (report.warnings.length > 0 || result.diagnostics.length > 0));
  return finish(io, args, report, failed ? EXIT.script : EXIT.ok);
}

/** Wraps words into lines of at most `width` characters, each starting with `indent`. */
function wrap(words: readonly string[], width: number, indent: string): string[] {
  const lines: string[] = [];
  let line = indent;
  for (const word of words) {
    if (line.length > indent.length && line.length + word.length + 1 > width) {
      lines.push(line);
      line = indent;
    }
    line += line.length > indent.length ? ` ${word}` : word;
  }
  if (line.length > indent.length) lines.push(line);
  return lines;
}

function verbs(io: CommandIo, args: CommandArgs, report: CommandReport): number {
  const categories = args.category ? VERB_CATEGORIES.filter((category) => category.id === args.category) : VERB_CATEGORIES;
  if (categories.length === 0) {
    return finish(io, args, report, EXIT.usage, {
      kind: 'usage',
      message: `there is no category "${args.category}"; the categories are ${VERB_CATEGORIES.map((category) => category.id).join(', ')}`,
    });
  }
  const listed = VERBS.filter((verb) => categories.some((category) => category.id === verb.category));
  const shapes = !args.category || args.category === 'shapes' ? SHAPE_NAMES : [];
  if (args.json) {
    io.stdout.write(
      `${JSON.stringify({
        ok: true,
        exitCode: EXIT.ok,
        version: report.version,
        language: SCRIPT_VERSION,
        categories,
        verbs: listed,
        shapes,
        ...(args.category ? {} : { diagnostics: DIAGNOSTICS }),
      })}\n`,
    );
    return EXIT.ok;
  }
  const lines: string[] = [`napkin script ${SCRIPT_VERSION}: ${listed.length} verb${listed.length === 1 ? '' : 's'}`];
  for (const category of categories) {
    lines.push('', ...wrap(`${category.title}: ${category.summary}`.split(' '), 78, ''), '');
    for (const verb of listed.filter((v) => v.category === category.id)) {
      for (const form of verb.forms) lines.push(`  ${form.signature}`);
      lines.push(...wrap(verb.summary.split(' '), 78, '      '));
    }
  }
  if (shapes.length > 0) {
    lines.push('', `The shape library, for shape "<name>": ${shapes.length} shapes`, '');
    lines.push(...wrap(shapes.map((shape, i) => (i < shapes.length - 1 ? `${shape},` : shape)), 78, '  '));
  }
  io.stdout.write(`${lines.join('\n')}\n`);
  return EXIT.ok;
}
