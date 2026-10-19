/**
 * The `/sharpen` entry: the auto-sharpen engine and nothing else.
 *
 * A page that tidies hand-drawn strokes into the shapes they were meant to be
 * loads a few kilobytes for it, rather than the editor, the language and the
 * composition API the main entry carries besides. The names are the main
 * entry's own, the same functions.
 *
 * The main entry names these from `./sharpen.js` and not through this file: a
 * module of re-exports that two entries share is written as a chunk of its
 * own, empty, which every page would fetch.
 */

export {
  DEFAULT_SHARPEN_OPTIONS,
  classify,
  sharpenPoints,
  sharpenStroke,
  sharpenStrokes,
  type ShapeKind,
  type SharpenOptions,
} from './sharpen.js';

export type { Point, Stroke } from '../core/types.js';
