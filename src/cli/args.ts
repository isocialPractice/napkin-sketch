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
  unknown: string[];
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
