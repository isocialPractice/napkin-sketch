/**
 * Pure, side-effect-free CLI argument parsing.
 *
 * Kept separate from `index.ts` (which launches Electron on import) so the
 * parser can be unit-tested without spawning a process.
 */

import { MAX_SEQUENCE_FRAMES, MIN_SEQUENCE_FRAMES, type AnimationFacing } from '../core/animation.js';
import type { LaunchMode } from '../core/launch.js';
import { MEASURED_ANIMATION_TYPES, measuredAnimationType } from '../core/script/animation.js';
import { RENDER_FORMATS, type RenderFormat } from '../core/script/render.js';

/** The words that select a subcommand, each of which runs with no window and no Electron. */
export const COMMANDS = ['draw', 'check', 'render', 'verbs'] as const;

export type Command = (typeof COMMANDS)[number];

/** What `--crop` asks for: the ink, the whole page, or a box `x,y,width,height`. */
export type CropArg = 'auto' | 'none' | { x: number; y: number; width: number; height: number };

/** A subcommand's arguments, read and checked. */
export interface CommandArgs {
  command: Command;
  /** The script to draw or check, or the book to render; `-` is standard input. Absent for `draw --prompt`. */
  input: string | undefined;
  /** `--prompt`: a request the AI helper writes the script for, in place of a script. */
  prompt: string | undefined;
  /** `--helper`: the AI helper command `--prompt` runs. */
  helper: string | undefined;
  /** `--to`: the formats to write, each once. */
  formats: RenderFormat[];
  out: string | undefined;
  name: string | undefined;
  base: string | undefined;
  /** `--asset <name>=<file>`, by name. */
  assets: Record<string, string>;
  /** `--use <name>=<book.skbk>`, by name. */
  documents: Record<string, string>;
  seed: number | undefined;
  scale: number | undefined;
  crop: CropArg | undefined;
  /** `--limit`: the instruction budget. */
  limit: number | undefined;
  /** `--page`, counting from 1. */
  page: number | undefined;
  /** `render --animate`: the measured cycle to draw the page's figure through. */
  animate: string | undefined;
  /** `--frames`: how many frames the cycle is spread across. */
  frames: number | undefined;
  /** `--facing`: which way the figure travels. */
  facing: AnimationFacing | undefined;
  category: string | undefined;
  json: boolean;
  strict: boolean;
  quiet: boolean;
  help: boolean;
  /** What was wrong with the arguments, one sentence each. Any at all is a usage error. */
  errors: string[];
}

/**
 * Each command as it is written and what it does. The `--help` text and the
 * documentation's tables are both made from this, so they cannot disagree.
 */
export const COMMAND_SUMMARIES: { readonly [C in Command]: { usage: string; summary: string } } = {
  draw: { usage: 'draw <script | ->', summary: 'Draw a napkin script to svg, png, pdf, skbk or jsx files.' },
  check: { usage: 'check <script | ->', summary: 'Read and run a script, report what is wrong, write nothing.' },
  render: { usage: 'render <book.skbk>', summary: 'Write a sketch book as svg, png, pdf, skbk or jsx files, or its figure as animation frames.' },
  verbs: { usage: 'verbs', summary: "List napkin script's verbs and the shape library." },
};

/** Each flag as it is written, and what it does, for the documentation's table of which command takes which. */
export const FLAG_SUMMARIES: { readonly [flag: string]: { value?: string; summary: string } } = {
  '--to': { value: '<formats>', summary: 'The formats to write: svg, png, pdf, skbk, jsx, comma-separated.' },
  '--out': { value: '<dir>', summary: 'The folder to write into, made when it is missing.' },
  '--name': { value: '<stem>', summary: 'The name the files are written under.' },
  '--base': { value: '<dir>', summary: 'The folder linked files are read inside.' },
  '--asset': { value: '<name>=<file>', summary: 'An image the script places by name; repeatable.' },
  '--use': { value: '<name>=<book.skbk>', summary: 'A book the script copies in with use; repeatable.' },
  '--seed': { value: '<n>', summary: 'The seed for the hand-drawn pass.' },
  '--scale': { value: '<n>', summary: 'PNG pixels a page pixel.' },
  '--crop': { value: 'auto|none|<x,y,w,h>', summary: 'What every file is cut to.' },
  '--limit': { value: '<n>', summary: 'The most instructions a run may execute.' },
  '--prompt': { value: '<request>', summary: 'Ask the AI helper for a script that draws this, and draw it; the script is kept as <name>.napkin.' },
  '--helper': { value: '<command>', summary: 'The AI helper command --prompt runs: $NAPKIN_SCRIPT_HELPER unless given, else Claude Code.' },
  '--page': { value: '<n>', summary: 'Only this page of the book, counting from 1.' },
  '--animate': { value: '<type>', summary: `Draw the page's figure through a measured cycle, a frame a page: ${MEASURED_ANIMATION_TYPES.join(', ')}.` },
  '--frames': { value: '<n>', summary: `How many frames --animate spreads the cycle across: ${MIN_SEQUENCE_FRAMES} to ${MAX_SEQUENCE_FRAMES}, the cycle's own length unless given.` },
  '--facing': { value: 'left|right', summary: 'Which way the --animate figure travels, when its feet do not say.' },
  '--category': { value: '<name>', summary: 'Only this category of verbs.' },
  '--json': { summary: 'One line of JSON on standard output, and nothing else.' },
  '--strict': { summary: 'Anything reported at all is a failure, and nothing is written.' },
  '--quiet': { summary: 'Print errors and nothing else.' },
};

/** The flags each subcommand takes, besides `-h` and `--help`. */
export const COMMAND_FLAGS: { readonly [C in Command]: readonly string[] } = {
  draw: ['--to', '--out', '--name', '--base', '--asset', '--use', '--seed', '--scale', '--crop', '--limit', '--prompt', '--helper', '--json', '--strict', '--quiet'],
  check: ['--base', '--asset', '--use', '--seed', '--limit', '--json', '--strict', '--quiet'],
  render: ['--to', '--page', '--animate', '--frames', '--facing', '--out', '--name', '--base', '--scale', '--crop', '--json', '--strict', '--quiet'],
  verbs: ['--category', '--json'],
};

/** The flags that take a value: the next token, or what follows `=` in `--flag=value`. */
const VALUE_FLAGS = new Set(['--to', '--out', '--name', '--base', '--asset', '--use', '--seed', '--scale', '--crop', '--limit', '--page', '--category', '--prompt', '--helper', '--animate', '--frames', '--facing']);

/** A `--crop` value, or a sentence saying what is wrong with it. */
function readCrop(value: string): { crop: CropArg } | { error: string } {
  if (value === 'auto' || value === 'none') return { crop: value };
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return { error: `--crop takes auto, none, or a box x,y,width,height; not "${value}"` };
  }
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) return { error: `--crop needs a box with a width and a height above 0; not "${value}"` };
  return { crop: { x, y, width, height } };
}

/** Reads one flag's value into the arguments, or adds what is wrong with it. */
function readFlag(args: CommandArgs, flag: string, value: string): void {
  const number = Number(value);
  const whole = Number.isInteger(number) && number > 0;
  switch (flag) {
    case '--to': {
      const formats = value.split(',').map((format) => format.trim().toLowerCase()).filter(Boolean);
      const unknown = formats.filter((format) => !(RENDER_FORMATS as readonly string[]).includes(format));
      if (formats.length === 0 || unknown.length > 0) {
        args.errors.push(`--to takes ${RENDER_FORMATS.join(', ')}, comma-separated; not "${value}"`);
      } else {
        args.formats = [...new Set(formats)] as RenderFormat[];
      }
      break;
    }
    case '--out':
      args.out = value;
      break;
    case '--name':
      args.name = value;
      break;
    case '--base':
      args.base = value;
      break;
    case '--asset':
    case '--use': {
      const eq = value.indexOf('=');
      if (eq <= 0 || eq === value.length - 1) {
        args.errors.push(`${flag} takes <name>=<file>; not "${value}"`);
      } else {
        (flag === '--asset' ? args.assets : args.documents)[value.slice(0, eq)] = value.slice(eq + 1);
      }
      break;
    }
    case '--seed':
      if (value.trim() === '' || !Number.isFinite(number)) args.errors.push(`--seed takes a number; not "${value}"`);
      else args.seed = number;
      break;
    case '--scale':
      if (!(Number.isFinite(number) && number > 0)) args.errors.push(`--scale takes a number above 0; not "${value}"`);
      else args.scale = number;
      break;
    case '--limit':
      if (!whole) args.errors.push(`--limit takes a whole number above 0; not "${value}"`);
      else args.limit = number;
      break;
    case '--page':
      if (!whole) args.errors.push(`--page takes a page number, counting from 1; not "${value}"`);
      else args.page = number;
      break;
    case '--crop': {
      const read = readCrop(value);
      if ('error' in read) args.errors.push(read.error);
      else args.crop = read.crop;
      break;
    }
    case '--category':
      args.category = value;
      break;
    case '--prompt':
      // Kept even when empty, so the missing script is not reported as well.
      args.prompt = value.trim();
      if (args.prompt === '') args.errors.push('--prompt needs a request: what the script should draw');
      break;
    case '--helper':
      if (value.trim() === '') args.errors.push('--helper needs a command to run');
      else args.helper = value.trim();
      break;
    case '--animate': {
      // The id or the label the app shows: `idle` is the type whose id is `ideal`.
      const type = measuredAnimationType(value);
      if (type === undefined) {
        args.errors.push(`--animate takes an animation with a measured cycle: ${MEASURED_ANIMATION_TYPES.join(', ')}; not "${value}"`);
      } else {
        args.animate = type;
      }
      break;
    }
    case '--frames':
      if (!(whole && number >= MIN_SEQUENCE_FRAMES && number <= MAX_SEQUENCE_FRAMES)) {
        args.errors.push(`--frames takes a whole number from ${MIN_SEQUENCE_FRAMES} to ${MAX_SEQUENCE_FRAMES}; not "${value}"`);
      } else {
        args.frames = number;
      }
      break;
    case '--facing':
      if (value !== 'left' && value !== 'right') args.errors.push(`--facing takes left or right; not "${value}"`);
      else args.facing = value;
      break;
  }
}

/**
 * Reads a subcommand's arguments: its flags, in either `--flag value` or
 * `--flag=value` form, and its one positional, the script or the book. A value
 * may start with a single `-`, so `--seed -3` works; a token starting `--` is
 * always a flag. Nothing is printed and nothing throws: every problem is a
 * sentence in `errors`.
 */
export function parseCommand(command: Command, argv: readonly string[]): CommandArgs {
  const args: CommandArgs = {
    command,
    input: undefined,
    prompt: undefined,
    helper: undefined,
    formats: ['svg'],
    out: undefined,
    name: undefined,
    base: undefined,
    assets: {},
    documents: {},
    seed: undefined,
    scale: undefined,
    crop: undefined,
    limit: undefined,
    page: undefined,
    animate: undefined,
    frames: undefined,
    facing: undefined,
    category: undefined,
    json: false,
    strict: false,
    quiet: false,
    help: false,
    errors: [],
  };
  const allowed = new Set(COMMAND_FLAGS[command]);
  const everyFlag = new Set(Object.values(COMMAND_FLAGS).flat());
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '-' || !token.startsWith('-')) {
      positional.push(token);
      continue;
    }
    if (token === '-h' || token === '--help') {
      args.help = true;
      continue;
    }
    const eq = token.startsWith('--') ? token.indexOf('=') : -1;
    const flag = eq > 0 ? token.slice(0, eq) : token;
    if (!allowed.has(flag)) {
      args.errors.push(everyFlag.has(flag) ? `${command} does not take ${flag}` : `unknown option ${flag}`);
      if (VALUE_FLAGS.has(flag) && eq < 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) i++;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) {
      if (eq > 0) args.errors.push(`${flag} takes no value`);
      else if (flag === '--json') args.json = true;
      else if (flag === '--strict') args.strict = true;
      else if (flag === '--quiet') args.quiet = true;
      continue;
    }
    const value = eq > 0 ? token.slice(eq + 1) : argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : undefined;
    if (value === undefined || value === '') args.errors.push(`${flag} needs a value`);
    else readFlag(args, flag, value);
  }

  if ((args.frames !== undefined || args.facing !== undefined) && args.animate === undefined) {
    args.errors.push('--frames and --facing go with --animate');
  }
  if (args.animate !== undefined && args.crop !== undefined) {
    args.errors.push('--animate cuts every frame to one box of its own, so it takes no --crop');
  }

  if (command === 'verbs') {
    if (positional.length > 0) args.errors.push(`verbs takes no script; not "${positional.join(' ')}"`);
  } else if (args.prompt !== undefined && positional.length > 0) {
    args.errors.push(`draw reads a script or a --prompt, not both; not ${positional.join(', ')} with --prompt`);
  } else if (positional.length > 1) {
    args.errors.push(`${command} reads one ${command === 'render' ? 'book' : 'script'} at a time; not ${positional.join(', ')}`);
  } else if (positional.length === 1) {
    args.input = positional[0];
    if (command === 'render' && args.input === '-') args.errors.push('render reads a .skbk file, not standard input');
  } else if (!args.help && args.prompt === undefined) {
    args.errors.push(
      command === 'render'
        ? 'render needs a .skbk book to read'
        : command === 'draw'
          ? 'draw needs a script: a file, - for standard input, or --prompt with a request'
          : `${command} needs a script: a file, or - for standard input`,
    );
  }
  return args;
}

/** Normalized result of parsing the napkin-sketch argv. */
export interface ParsedArgs {
  help: boolean;
  version: boolean;
  mode: LaunchMode | null;
  target: string | undefined;
  sharpenOnly: boolean;
  fullScreen: boolean;
  /** Single file to import into the opening sketch (-i, --import). */
  importFile: string | undefined;
  /** True when -i/--import was passed (even without a value, for validation). */
  importRequested: boolean;
  /** Files to import laid out in a grid (-m, --multiple-imports). */
  multipleImports: string[];
  /** True when -m/--multiple-imports was passed (even without a value). */
  multipleImportsRequested: boolean;
  unknown: string[];
  /**
   * A subcommand, when the first token names one: `draw`, `check`, `render`
   * or `verbs`. The GUI's flags are not read then.
   */
  command: CommandArgs | null;
}

/**
 * Splits a `--multiple-imports` value list into file paths.
 *
 * The list is comma-separated. Shell quoting keeps a name with spaces in one
 * argv token, but a space after a comma splits the list across tokens, so the
 * raw tokens are joined back together before splitting on commas; whitespace
 * around each entry is trimmed and empty entries (trailing commas) dropped.
 */
export function splitImportList(tokens: string[]): string[] {
  return tokens
    .join(' ')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Parses argv (excluding node + script) into a normalized structure. */
export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    help: false,
    version: false,
    mode: null,
    target: undefined,
    sharpenOnly: false,
    fullScreen: false,
    importFile: undefined,
    importRequested: false,
    multipleImports: [],
    multipleImportsRequested: false,
    unknown: [],
    command: null,
  };

  // A first token that names a subcommand selects it, and its arguments are its own.
  if (argv.length > 0 && (COMMANDS as readonly string[]).includes(argv[0])) {
    result.command = parseCommand(argv[0] as Command, argv.slice(1));
    return result;
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        result.help = true;
        break;
      case '-v':
      case '--version':
        result.version = true;
        break;
      case '-f':
      case '--full-screen':
        result.fullScreen = true;
        break;
      case '-b':
      case '--book':
        result.mode = 'book';
        result.target = argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : undefined;
        break;
      case '-n':
      case '--new':
        result.mode = 'new';
        result.target = argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : undefined;
        break;
      case '--sharpen':
        result.mode = 'sharpen';
        result.sharpenOnly = true;
        result.target = argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : undefined;
        break;
      case '-i':
      case '--import':
        result.importRequested = true;
        result.importFile = argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : undefined;
        break;
      case '-m':
      case '--multiple-imports': {
        result.multipleImportsRequested = true;
        // Consume every following non-flag token: a space after a comma (or a
        // quoted name with spaces the shell split oddly) spreads the list
        // across argv entries.
        const tokens: string[] = [];
        while (argv[i + 1] && !argv[i + 1].startsWith('-')) tokens.push(argv[++i]);
        result.multipleImports = splitImportList(tokens);
        break;
      }
      default:
        if (arg.startsWith('-')) {
          result.unknown.push(arg);
        } else if (result.target === undefined && result.mode === null) {
          // Bare positional with no flag: treat as a book to open.
          result.mode = 'book';
          result.target = arg;
        } else if (result.target === undefined) {
          result.target = arg;
        } else {
          result.unknown.push(arg);
        }
        break;
    }
  }
  return result;
}
