/**
 * The graphic-design API: simple elements in, a finished graphic out.
 *
 * Build a composition from rectangles, circles, ellipses, triangles, polygons,
 * lines, paths, text, placed media and clipping masks, then render it. Two
 * back ends read the same document, so the SVG and the PNG differ in their
 * media export format and in nothing else.
 *
 * Everything exported here is browser-safe. The Node-only file helpers live in
 * `./files.js`, and the canvas painter the GUI uses lives in `./canvas.js`.
 *
 * See `API.md` for the reference and worked examples.
 */

export {
  Composition,
  ElementList,
  createComposition,
  renderComposition,
  renderPng,
  type CompositionFormat,
  type PngRender,
  type RenderOptions,
} from './compose.js';

export { compositionToSvg, escapeXml, type SvgOptions } from './svg.js';

export {
  rasterizeComposition,
  rasterizeContours,
  type ImageDecoder,
  type RasterOptions,
  type RasterResult,
} from './raster.js';

export { decodePng, encodePng, isPng, type RgbaImage } from './png.js';

export { formatColor, parseColor, parsePaint, type Rgba } from './color.js';

export {
  charWidth,
  fontMetrics,
  layoutText,
  measureText,
  transformText,
  wrapText,
  FONT_CAP_HEIGHT,
  FONT_UNITS_PER_EM,
  FONT_X_HEIGHT,
  type FontMetrics,
  type LaidOutLine,
  type TextLayout,
} from './font.js';

export {
  contourBounds,
  ellipseContour,
  parsePathData,
  rectContour,
  strokeContour,
  triangleContour,
  type Contour,
  type Matrix,
} from './geometry.js';

export {
  DEFAULT_COMPOSITION_SIZE,
  DEFAULT_FONT_SIZE,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_TEXT_FONT,
  DEFAULT_UNITS,
  isGroup,
  type CircleElement,
  type ClipDefinition,
  type ClipShape,
  type CommonProps,
  type CompositionDocument,
  type Element,
  type EllipseElement,
  type FillRule,
  type GroupElement,
  type ImageElement,
  type ImageFit,
  type LineCap,
  type LineElement,
  type LineJoin,
  type PageOptions,
  type ParagraphStyle,
  type PathElement,
  type Point,
  type PolygonElement,
  type PolylineElement,
  type RectElement,
  type TextAlign,
  type TextBaseline,
  type TextElement,
  type TextStyle,
  type TriangleElement,
} from './types.js';
