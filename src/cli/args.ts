/**
 * Pure, side-effect-free CLI argument parsing.
 *
 * Kept separate from `index.ts` (which launches Electron on import) so the
 * parser can be unit-tested without spawning a process.
 */

import type { LaunchMode } from '../core/launch.js';

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
  };

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
