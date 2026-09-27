/**
 * Automate > Generate Script: the scripts the app writes from a media file,
 * from the selected layers or from the session history, and what the dialog
 * shows beside each.
 *
 * A vector source is a page the writer turns into a script: an SVG read into
 * its layer tree, a PDF's pages, or the layers chosen on the page in view. A
 * picture is not traced - the app has no tracer, and a script that claimed to
 * redraw a photograph would be the kind of generated code people are right to
 * distrust - so a PNG, JPEG, GIF or WebP becomes a page its own size with the
 * file placed on it: linked by its name, or with its data in the script.
 *
 * Every script starts with a comment saying where it came from, and the
 * writer's notes as comments after it, so a saved script carries both. Pure
 * and DOM-free; the renderer reads the file and shows the result.
 */

import { linkKind } from '../link.js';
import { DEFAULT_BACKGROUND, SKETCHBOOK_VERSION, type Sketch } from '../types.js';
import { formatScript } from './format.js';
import { SCRIPT_VERSION, type DocumentInstruction } from './instructions.js';
import { historyScript, type HistoryScriptOptions, type HistoryScriptStep } from './history-script.js';
import { imageSize } from './media.js';
import { bookToInstructions, scriptComments, sketchToInstructions, type WriteOptions, type WriteStats, type WrittenScript } from './writer.js';

/** A generated script, and what the dialog says about it. */
export interface GeneratedScript {
  /** What the script was written from, as the dialog's title names it: `logo.svg`, `2 layers`. */
  readonly source: string;
  /** The name it draws its first page under, and the file name Save As offers. */
  readonly name: string;
  /** The script, as it is copied, saved and opened. */
  readonly text: string;
  readonly stats: WriteStats;
  /** What the script cannot draw as the source is, a sentence each. */
  readonly notes: readonly string[];
}

/** The comment a generated script opens with. */
function header(source: string): string {
  return `Written by napkin-sketch from ${source}.`;
}

function generated(written: WrittenScript, source: string, name: string): GeneratedScript {
  return {
    source,
    name,
    text: scriptComments(written, [header(source)]) + formatScript(written.script),
    stats: written.stats,
    notes: written.notes,
  };
}

/**
 * A script that draws pages: one page through the writer, or several as a
 * book, a `newpage` before each after the first. `options` goes to the writer:
 * `layers` for a part of the page, `page: 'fit'` for a page the size of the ink.
 */
export function scriptFromPages(pages: readonly Sketch[], source: string, options: WriteOptions = {}): GeneratedScript {
  if (pages.length === 0) throw new Error('scriptFromPages: there is no page to write.');
  const name = pages[0].name;
  if (pages.length === 1) return generated(sketchToInstructions(pages[0], options), source, name);
  const stamp = pages[0].createdAt;
  const book = { format: 'napkin-sketch' as const, version: SKETCHBOOK_VERSION, name, sketches: [...pages], createdAt: stamp, updatedAt: stamp };
  return generated(bookToInstructions(book, { page: options.page, decimals: options.decimals }), source, name);
}

/**
 * The steps Track History recorded on a page, the ticked ones played, as a
 * script: see history-script.ts. Save As offers `<page>-history`.
 */
export function scriptFromHistory(steps: readonly HistoryScriptStep[], page: Sketch, options: HistoryScriptOptions = {}): GeneratedScript {
  const written = historyScript(steps, page, options);
  const n = written.included.length;
  return {
    source: `${n} ${n === 1 ? 'step' : 'steps'}`,
    name: `${page.name}-history`,
    text: written.text,
    stats: written.stats,
    notes: written.notes,
  };
}

/** A picture read for a script: its name without the extension, its file name, and its data. */
export interface RasterFile {
  readonly name: string;
  readonly fileName: string;
  readonly dataUrl: string;
}

/**
 * A picture as a script: a page the picture's size, read from its header,
 * with the picture placed at its corner. Linked by default, which keeps the
 * script short and draws the file where it sits beside the script; with
 * `embed`, the picture's data goes into the script, on a layer named for the
 * file, and the script needs nothing beside it.
 */
export function rasterScript(file: RasterFile, options: { embed: boolean }): GeneratedScript {
  const notes: string[] = [];
  const read = imageSize(file.dataUrl);
  if (!read) notes.push("The picture's size cannot be read from its data, so it is placed 100 by 100.");
  const { width, height } = read ?? { width: 100, height: 100 };
  const script: DocumentInstruction[] = [
    { verb: 'napkin', version: SCRIPT_VERSION },
    { verb: 'page', width, height },
    { verb: 'background', color: DEFAULT_BACKGROUND },
    { verb: 'name', name: file.name },
  ];
  if (options.embed) {
    script.push({ verb: 'layer', name: file.fileName }, { verb: 'image', src: file.dataUrl, x: 0, y: 0, width, height });
  } else {
    if (linkKind(file.fileName) === 'unknown') {
      const kind = /\.([a-z0-9]+)$/i.exec(file.fileName)?.[1]?.toUpperCase() ?? 'this kind of';
      notes.push(`napkin-sketch shows a linked ${kind} file as a placeholder; Embed the image data carries the picture in the script instead.`);
    }
    script.push({ verb: 'link', href: file.fileName, x: 0, y: 0, width, height });
  }
  const written: WrittenScript = { script, notes, stats: { instructions: script.length, marks: 1, layers: 1, pages: 1 } };
  return generated(written, file.fileName, file.name);
}

/** How big a script is, as the dialog says it: `12 instructions, 9 marks, 3 layers`, and the pages when there are several. */
export function statsLine(stats: WriteStats): string {
  const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  const parts = [
    count(stats.instructions, 'instruction', 'instructions'),
    count(stats.marks, 'mark', 'marks'),
    count(stats.layers, 'layer', 'layers'),
  ];
  if (stats.pages > 1) parts.push(count(stats.pages, 'page', 'pages'));
  return parts.join(', ');
}

/** Image data this long or longer is shortened where a person reads the script. */
const LONG_DATA = 120;

/**
 * The script as the dialog shows it: the same text, with each long run of
 * image data cut short and its size given, so a picture's megabytes do not
 * fill the view. What is copied, saved and opened is always the whole text.
 */
export function displayScript(text: string): string {
  return text.replace(/"(data:[^",]*,)([^"]*)"/g, (whole, head: string, data: string) => {
    if (data.length < LONG_DATA) return whole;
    const bytes = Math.floor((data.length * 3) / 4);
    const size = bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
    return `"${head}${data.slice(0, 32)}... (${size} of image data)"`;
  });
}
