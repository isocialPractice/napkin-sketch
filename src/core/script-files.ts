/**
 * Node-only: a script read from a file, the files it names read in, and a
 * drawing written out as files - the half of the script API that touches the
 * disk, which `napkin-sketch/node` exports.
 *
 * The language reads no file. A script names an image or a document, and the
 * host hands it over; a script names a linked file, and the host reads it,
 * inside one folder. Everything here is that host, running before a script
 * and after it. It is kept apart from `src/core/script/` for the reason the
 * composition's file helpers are: so that importing the language never drags
 * `node:fs` into a web build.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { imageDataUrl, resolveLinkFromDir } from './graphic-design/files.js';
import { readSketchBook } from './sketchbook.js';
import { evaluate, type EvaluateOptions, type ScriptSource, type ScriptStats } from './script/evaluate.js';
import type { Diagnostic } from './script/instructions.js';
import type { ScriptDocument } from './script/media.js';
import { renderBook, type RenderFormat, type RenderSketchOptions } from './script/render.js';
import type { SketchBook } from './types.js';

/**
 * Reads a script file. A `.json` file is the object form and comes back as
 * its JSON value; anything else is napkin script text. Throws when the file
 * cannot be read, and when a `.json` file is not JSON or holds something
 * other than an array, since then it is not a script at all. What is wrong
 * inside a script is not thrown: `evaluate` reports it as diagnostics.
 */
export async function readScript(path: string): Promise<ScriptSource> {
  const text = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
  if (!/\.json$/i.test(path)) return text;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`napkin-sketch: ${path} is not JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`napkin-sketch: ${path} is JSON but not a script, which is an array of instructions`);
  }
  return value;
}

/** A script file's name without its extension: `card` for `card.napkin` and for `card.napkin.json`. */
export function scriptName(path: string): string {
  return /^(.*?)(\.napkin\.json|\.[^.]*)?$/i.exec(basename(path))?.[1] || 'drawing';
}

/**
 * Images for `options.assets`, read by name: `{ logo: 'art/logo.png' }` gives
 * `{ logo: 'data:image/png;base64,...' }`. A value that is already a data URL
 * is kept as it is; any other is a path, read relative to `from`, the working
 * folder unless given. These are the host's own files, named by the host, so
 * no folder guard applies to them, as one does to a link a script names.
 */
export async function loadAssets(
  assets: Readonly<Record<string, string>>,
  from: string = process.cwd(),
): Promise<Record<string, string>> {
  const loaded: Record<string, string> = {};
  for (const [name, value] of Object.entries(assets)) {
    if (value.startsWith('data:')) {
      loaded[name] = value;
      continue;
    }
    const path = resolve(from, value);
    try {
      loaded[name] = await imageDataUrl(path);
    } catch (err) {
      throw new Error(`napkin-sketch: asset "${name}" could not be read from ${path}: ${(err as Error).message}`);
    }
  }
  return loaded;
}

/**
 * Documents for `options.documents`, read by name: a path is a `.skbk` book,
 * read relative to `from`, the working folder unless given, and a page or a
 * book already in hand is kept as it is.
 */
export async function loadDocuments(
  documents: Readonly<Record<string, string | ScriptDocument>>,
  from: string = process.cwd(),
): Promise<Record<string, ScriptDocument>> {
  const loaded: Record<string, ScriptDocument> = {};
  for (const [name, value] of Object.entries(documents)) {
    if (typeof value !== 'string') {
      loaded[name] = value;
      continue;
    }
    const path = resolve(from, value);
    try {
      loaded[name] = await readSketchBook(path);
    } catch (err) {
      throw new Error(`napkin-sketch: document "${name}" could not be read from ${path}: ${(err as Error).message}`);
    }
  }
  return loaded;
}

/** One file a write made. */
export interface WrittenFile {
  /** Where it was written: `out` joined with the file's name. */
  path: string;
  format: RenderFormat;
  /**
   * The page it holds, counting from 1, for a format written one file a page,
   * SVG and PNG. Absent for a PDF, a `.skbk` or an Illustrator script, which
   * hold the whole book.
   */
  page?: number;
}

/** How {@link writeBook} names and writes its files, and renders what goes in them. */
export interface WriteBookOptions extends Omit<RenderSketchOptions, 'format'> {
  /** The folder the files go in, made when it is missing. The working folder unless given. */
  out?: string;
  /**
   * The name the files are written under, without an extension. The first
   * page's name unless given, which is what a script's `name` sets. Any
   * character a file name cannot hold becomes `-`, so a name can never reach
   * outside `out`.
   */
  name?: string;
  /** The formats to write, each once. `['svg']` unless given. */
  formats?: readonly RenderFormat[];
  /**
   * The folder the book's linked files are read in, which an Illustrator
   * script places each one from: the script names a linked file by its path
   * from the script's own folder, through here. The working folder unless
   * given.
   */
  base?: string;
  /** Write nothing when a format left something out or drew a stand-in for it. */
  strict?: boolean;
}

/** A file rendered and ready to write. */
interface RenderedFile {
  file: string;
  format: RenderFormat;
  page?: number;
  data: string | Uint8Array;
}

/** Windows device names, which no file may be called, whatever its extension. */
const DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * A name as a file name. Every character a file name cannot hold on Windows,
 * macOS or Linux becomes `-` - a path separator above all, since a script
 * names its own pages and its name must not step out of the output folder -
 * dots and spaces at either end go, and what is left is kept to 120
 * characters. `drawing` when nothing is left.
 */
export function fileStem(name: string): string {
  const stem = name
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-')
    .replace(/^[\s.]+/, '')
    .slice(0, 120)
    .replace(/[\s.]+$/, '');
  if (!stem) return 'drawing';
  return DEVICE_NAMES.test(stem) ? `${stem}-drawing` : stem;
}

/**
 * The folder an Illustrator script written into `out` finds the links in:
 * `base` from `out`, with forward slashes, or undefined when they are one.
 */
function linkFolderFrom(out: string | undefined, base: string | undefined): string | undefined {
  const from = relative(resolve(out ?? '.'), resolve(base ?? '.')).replace(/\\/g, '/');
  return from === '' ? undefined : from;
}

/** Every file a book is written as, rendered in memory, named and in order. */
function renderFiles(book: SketchBook, options: WriteBookOptions): RenderedFile[] {
  const { out, base, name, formats = ['svg'], strict: _strict, ...render } = options;
  const stem = fileStem(name ?? book.sketches[0]?.name ?? book.name);
  const several = book.sketches.length > 1;
  const files: RenderedFile[] = [];
  for (const format of new Set(formats)) {
    if (format === 'jsx') {
      files.push({ file: `${stem}.jsx`, format, data: renderBook(book, { ...render, format, linkFolder: render.linkFolder ?? linkFolderFrom(out, base) }) });
      continue;
    }
    if (format === 'pdf' || format === 'skbk') {
      files.push({ file: `${stem}.${format}`, format, data: renderBook(book, { ...render, format }) });
      continue;
    }
    const pages: ReadonlyArray<string | Uint8Array> =
      format === 'png' ? renderBook(book, { ...render, format }) : renderBook(book, { ...render, format });
    pages.forEach((data, i) => {
      files.push({ file: several ? `${stem}-${i + 1}.${format}` : `${stem}.${format}`, format, page: i + 1, data });
    });
  }
  return files;
}

/**
 * Writes a file whole or not at all: to a scratch file beside it, renamed
 * over it once complete, so a failure part way leaves the file that was there
 * rather than half of a new one. A PDF is latin1, the encoding that keeps an
 * embedded image's bytes.
 */
async function writeWhole(path: string, data: string | Uint8Array, format: RenderFormat): Promise<void> {
  const scratch = `${path}.${process.pid}.tmp`;
  if (typeof data === 'string') await writeFile(scratch, data, format === 'pdf' ? 'latin1' : 'utf8');
  else await writeFile(scratch, data);
  try {
    await rename(scratch, path);
  } catch (err) {
    await rm(scratch, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Writes rendered files into `out`, in order, and says where each went. */
async function writeFiles(files: readonly RenderedFile[], out: string = process.cwd()): Promise<WrittenFile[]> {
  await mkdir(out, { recursive: true });
  const root = resolve(out);
  const written: WrittenFile[] = [];
  for (const file of files) {
    // A stem holds no separator, so this cannot miss; it is the guard that says so.
    if (!resolve(root, file.file).startsWith(root + sep)) throw new Error(`napkin-sketch: ${file.file} is not a file name`);
    const path = join(out, file.file);
    await writeWhole(path, file.data, file.format);
    written.push({ path, format: file.format, ...(file.page ? { page: file.page } : {}) });
  }
  return written;
}

/**
 * Writes a book into `out`: one SVG or PNG a page - `<name>.<ext>` for a book
 * of one page, and `<name>-1.<ext>`, `<name>-2.<ext>` and on for several -
 * and one PDF, one `.skbk` and one Illustrator script for the whole book. Every file is rendered
 * before any is written, and each is written whole or not at all. Rendering
 * takes the options `renderBook` takes. With `strict`, nothing is written
 * when a format warned, and the list comes back empty.
 */
export async function writeBook(book: SketchBook, options: WriteBookOptions = {}): Promise<WrittenFile[]> {
  let warned = false;
  const rendered = renderFiles(book, {
    ...options,
    onWarning: (message) => {
      warned = true;
      options.onWarning?.(message);
    },
  });
  if (options.strict && warned) return [];
  return writeFiles(rendered, options.out);
}

/** How {@link drawToFiles} and {@link drawFile} run a script and write what it drew. */
export interface DrawToFilesOptions extends Omit<EvaluateOptions, 'assets' | 'documents'>, WriteBookOptions {
  /**
   * The name the files are written under, and the book's. Without one, the
   * files take the first page's name, which a script's `name` sets.
   */
  name?: string;
  /**
   * The book's name when neither `name` nor the script's own `name` gives
   * one, and so the files': {@link drawFile} passes the file's name.
   * `drawing` unless given.
   */
  defaultName?: string;
  /** Images the script places by name: data URLs, or paths read with {@link loadAssets}. */
  assets?: Readonly<Record<string, string>>;
  /** Documents the script copies in with `use`: pages, books, or `.skbk` paths read with {@link loadDocuments}. */
  documents?: Readonly<Record<string, string | ScriptDocument>>;
  /**
   * The folder the script's links are read inside: for their size, and for
   * the PNG, which draws a linked file itself, unless `resolveLink` is given;
   * and for an Illustrator script, which places each linked file from there.
   * The working folder unless given; {@link drawFile} makes it the script's
   * own folder.
   */
  base?: string;
  /**
   * Write nothing when anything at all was reported - a diagnostic, even a
   * warning, or a format leaving something out - and give `ok` false.
   */
  strict?: boolean;
}

/** What {@link drawToFiles} and {@link drawFile} give back: what the CLI prints with `--json`, less the version. */
export interface DrawResult {
  /** True when nothing was an error; with `strict`, true only when nothing was reported at all. */
  ok: boolean;
  /** The files written, in the order the formats were asked for and then page by page. */
  files: WrittenFile[];
  /** Everything the script reported, reading and running together, in reading order. */
  diagnostics: Diagnostic[];
  stats: ScriptStats;
  /** What a format left out or drew as a stand-in, as `onWarning` hears it. */
  warnings: string[];
}

async function draw(source: ScriptSource, options: DrawToFilesOptions): Promise<DrawResult> {
  const {
    assets,
    documents,
    base,
    strict,
    out,
    name,
    defaultName,
    formats,
    crop,
    registration,
    transparent,
    scale,
    decodeImage,
    onWarning,
    resolveLink: given,
    ...run
  } = options;
  const resolveLink = given ?? resolveLinkFromDir(base ?? process.cwd());
  const result = evaluate(source, {
    ...run,
    name: name ?? defaultName,
    resolveLink,
    ...(assets ? { assets: await loadAssets(assets) } : {}),
    ...(documents ? { documents: await loadDocuments(documents) } : {}),
  });
  const warnings: string[] = [];
  const done = (ok: boolean, files: WrittenFile[]): DrawResult => ({
    ok,
    files,
    diagnostics: result.diagnostics,
    stats: result.stats,
    warnings,
  });
  if (strict && result.diagnostics.length > 0) return done(false, []);
  const rendered = renderFiles(result.book, {
    out,
    base,
    name,
    formats,
    crop: crop ?? result.output.crop,
    registration: registration ?? result.output.registration,
    transparent,
    scale,
    resolveLink,
    decodeImage,
    onWarning: (message) => {
      warnings.push(message);
      onWarning?.(message);
    },
  });
  if (strict && warnings.length > 0) return done(false, []);
  return done(result.ok, await writeFiles(rendered, out));
}

/**
 * Runs a script and writes what it drew: the whole road from a script to its
 * files in one call. The script's own `crop` and `registration` apply unless
 * the options say otherwise. A script with errors still writes what it drew,
 * with `ok` false and the diagnostics saying why, unless `strict` is set.
 * What throws is the disk: an asset or document that cannot be read, or an
 * output folder that cannot be written.
 */
export async function drawToFiles(source: ScriptSource, options: DrawToFilesOptions = {}): Promise<DrawResult> {
  return draw(source, options);
}

/**
 * Reads a script file with {@link readScript} and writes what it drew, as
 * {@link drawToFiles} does. The book is named after the file - `card` for
 * `card.napkin` - unless the script's `name` or the options name it, and the
 * script's links are read inside the script's own folder unless `base` says
 * otherwise.
 */
export async function drawFile(path: string, options: DrawToFilesOptions = {}): Promise<DrawResult> {
  const source = await readScript(path);
  return draw(source, {
    ...options,
    base: options.base ?? dirname(resolve(path)),
    defaultName: options.defaultName ?? scriptName(path),
  });
}
