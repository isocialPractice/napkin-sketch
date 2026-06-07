/**
 * Public, framework-agnostic API for napkin-sketch.
 *
 * Import this from a website, a WordPress block, or a VS Code webview to embed
 * the editor or reuse the auto-sharpen engine without Electron:
 *
 * ```ts
 * import { NapkinSketch, sharpenStrokes } from 'napkin-sketch';
 * ```
 *
 * Everything exported here is browser-safe (no Node or Electron imports).
 */

export { NapkinSketch } from './embed.js';
export type { NapkinOptions } from './embed.js';

// Data model
export {
  SKETCHBOOK_VERSION,
  SKETCHBOOK_EXTENSION,
  DEFAULT_SURFACE,
  DEFAULT_BACKGROUND,
  DEFAULT_FONT_FAMILY,
  createId,
  createSketch,
  createSketchBook,
  isTextStroke,
  type Point,
  type Stroke,
  type Sketch,
  type SketchBook,
  type Tool,
} from '../core/types.js';

// Serialization (browser-safe)
export {
  withSketchBookExtension,
  deriveName,
  normalizeSketchBook,
  parseSketchBook,
  serializeSketchBook,
} from '../core/serialize.js';

// Auto-sharpen engine
export {
  DEFAULT_SHARPEN_OPTIONS,
  sharpenPoints,
  sharpenStroke,
  sharpenStrokes,
  classify,
  type SharpenOptions,
  type ShapeKind,
} from '../sharpen/sharpen.js';

// Rendering surface (advanced use)
export { Surface, strokeBounds } from '../renderer/surface.js';
export type { LiveStroke, Overlay } from '../renderer/surface.js';
