/**
 * Straight from a script to an SVG: the convenience for a caller that wants
 * the picture and what was wrong with the script, and nothing in between.
 */

import { evaluate, type Box, type EvaluateOptions, type ScriptSource } from './evaluate.js';
import type { Diagnostic } from './instructions.js';
import { renderSketch, type RenderCrop } from './render.js';

/** How {@link drawSvg} runs a script and writes its first page. */
export interface DrawSvgOptions extends EvaluateOptions {
  /** What to cut the page to. The script's own `crop` unless given, and the whole page when it has none. */
  crop?: RenderCrop;
  /** One box to cut the page to, over any crop. The script's own `registration` unless given. */
  registration?: Box;
  /** Leave the paper out, so the SVG is transparent wherever nothing is drawn. */
  transparent?: boolean;
}

/** What {@link drawSvg} gives back. */
export interface DrawSvgResult {
  /** True when nothing was an error, reading or running. */
  ok: boolean;
  /** The first page as SVG: always a document, however much of the script ran. */
  svg: string;
  /** Everything reported, reading and running together, in reading order. */
  diagnostics: Diagnostic[];
}

/**
 * Reads and runs a script, and writes its first page as SVG, in one call.
 * The script's own `crop` and `registration` apply unless the options say
 * otherwise. Like `evaluate`, it never throws for anything in the script: a
 * script with errors still draws what it could, and says what went wrong.
 * For every page, or another format, run `evaluate` and hand the book to
 * `renderBook`.
 */
export function drawSvg(source: ScriptSource, options: DrawSvgOptions = {}): DrawSvgResult {
  const { crop, registration, transparent, ...run } = options;
  const result = evaluate(source, run);
  const svg = renderSketch(result.book.sketches[0], {
    crop: crop ?? result.output.crop,
    registration: registration ?? result.output.registration,
    transparent,
  });
  return { ok: result.ok, svg, diagnostics: result.diagnostics };
}
