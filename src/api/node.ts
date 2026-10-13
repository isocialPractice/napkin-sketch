/**
 * `@isocialpractice/napkin-sketch/node`: the part of the API that reads and writes files, for
 * Node only.
 *
 * The language, its evaluator and its renderers are in the browser-safe
 * `@isocialpractice/napkin-sketch` entry, and none of them reads a file. This entry is the
 * host around them: a script read from disk, the images and documents it
 * names loaded by name, its links read inside one folder, and a drawing
 * written out as files.
 *
 * ```ts
 * import { drawFile } from '@isocialpractice/napkin-sketch/node';
 *
 * const { ok, files, diagnostics } = await drawFile('card.napkin', { formats: ['svg', 'png'], out: 'out' });
 * ```
 *
 * The composition API's file helpers are here as well, so a Node script has
 * one import to remember; `@isocialpractice/napkin-sketch/graphic-design/files` keeps working.
 *
 * A drawing it draws shows its Markdown Flow text as the Markdown renders,
 * and its code accented: it reads Markdown with marked's lexer and code with
 * highlight.js, as the command line does.
 */

import '../markdown/core.js';

export * from '../core/graphic-design/files.js';

export {
  drawFile,
  drawToFiles,
  loadAssets,
  loadDocuments,
  loadFonts,
  readCompositionStyle,
  readScript,
  writeBook,
  type DrawResult,
  type DrawToFilesOptions,
  type FontSources,
  type WriteBookOptions,
  type WrittenFile,
} from '../core/script-files.js';
