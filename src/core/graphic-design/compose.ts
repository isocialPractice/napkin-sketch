/**
 * The authoring surface of the graphic-design API.
 *
 * A `Composition` is a page plus a list of elements and a method per shape.
 * Every method takes a plain object of properties, returns the element it
 * created - so it can be referenced later, or handed to a clipping mask - and
 * appends it to the composition in drawing order. Nothing renders until one of
 * `toSVG`, `toPNG` or `render` is called, and rendering never mutates the
 * document, so one composition can be written out in both formats and the two
 * are the same graphic by construction rather than by inspection.
 *
 * ```ts
 * const design = createComposition({ width: 360, height: 360, background: '#fdfcf7' });
 * design.rect({ x: 24, y: 24, width: 312, height: 120, rx: 12, fill: '#326478' });
 * design.text({ x: 180, y: 96, text: 'Acme Corp', align: 'center', fill: '#ffffff' });
 * const svg = design.toSVG();
 * const png = design.toPNG();
 * ```
 */

import { DEFAULT_UNITS, DEFAULT_COMPOSITION_SIZE } from './types.js';
import type {
  CircleElement,
  ClipDefinition,
  ClipShape,
  CompositionDocument,
  Element,
  EllipseElement,
  FillRule,
  GroupElement,
  ImageElement,
  LineElement,
  PageOptions,
  PathElement,
  PolygonElement,
  PolylineElement,
  RectElement,
  TextElement,
  TriangleElement,
} from './types.js';
import { compositionToSvg, type SvgOptions } from './svg.js';
import { encodePng } from './png.js';
import { rasterizeComposition, type RasterOptions, type RasterResult } from './raster.js';

/** Properties of an element, minus the discriminator the method supplies. */
type Props<T extends Element> = Omit<T, 'type'>;

/**
 * An ordered list of elements and the methods that append to it.
 *
 * Shared by the composition itself and by every group inside it, so a group
 * is built with exactly the calls the page is built with.
 */
export class ElementList {
  /** The elements, in drawing order: later ones paint over earlier ones. */
  readonly elements: Element[] = [];

  /** Appends an element built by hand. */
  add<T extends Element>(element: T): T {
    this.elements.push(element);
    return element;
  }

  /** Appends several elements at once. */
  addAll(elements: Element[]): Element[] {
    this.elements.push(...elements);
    return elements;
  }

  /** A rectangle, with optional rounded corners. */
  rect(props: Props<RectElement>): RectElement {
    return this.add({ type: 'rect', ...props });
  }

  /** A circle. */
  circle(props: Props<CircleElement>): CircleElement {
    return this.add({ type: 'circle', ...props });
  }

  /** An ellipse. */
  ellipse(props: Props<EllipseElement>): EllipseElement {
    return this.add({ type: 'ellipse', ...props });
  }

  /** A triangle, from three points or from a box and a direction. */
  triangle(props: Props<TriangleElement>): TriangleElement {
    return this.add({ type: 'triangle', ...props });
  }

  /** A closed polygon. */
  polygon(props: Props<PolygonElement>): PolygonElement {
    return this.add({ type: 'polygon', ...props });
  }

  /** An open polyline. */
  polyline(props: Props<PolylineElement>): PolylineElement {
    return this.add({ type: 'polyline', ...props });
  }

  /** A straight line. */
  line(props: Props<LineElement>): LineElement {
    return this.add({ type: 'line', ...props });
  }

  /** A path in SVG path syntax (`M L H V C S Q T Z`). */
  path(props: Props<PathElement>): PathElement {
    return this.add({ type: 'path', ...props });
  }

  /** A block of text, wrapped and aligned. */
  text(props: Props<TextElement>): TextElement {
    return this.add({ type: 'text', ...props });
  }

  /** A placed media file, given as a data URL. */
  image(props: Props<ImageElement>): ImageElement {
    return this.add({ type: 'image', ...props });
  }

  /**
   * A group: one transform, one opacity and one clip over several children.
   *
   * Pass a builder to fill it, which keeps the children beside the group that
   * owns them rather than in a variable declared above it.
   */
  group(
    props: Omit<Props<GroupElement>, 'children'> & { children?: Element[] } = {},
    build?: (group: ElementList) => void,
  ): GroupElement {
    const children = props.children ? [...props.children] : [];
    const element: GroupElement = { ...props, type: 'group', children };
    if (build) {
      const inner = new ElementList();
      build(inner);
      children.push(...inner.elements);
    }
    return this.add(element);
  }
}

/** A page of elements, renderable to SVG or PNG. */
export class Composition extends ElementList {
  /** Page width in {@link units}. */
  width: number;
  /** Page height in {@link units}. */
  height: number;
  /** The unit every coordinate in this composition is read in. */
  units: CompositionDocument['units'];
  /** Page background, or `null` for transparent. */
  background: string | null;
  /** Document id, written as the root `<svg id>`. */
  id?: string;
  /** Human title, written as `<title>`. */
  title?: string;
  /** Whether the GUI's own canvas is the intended target. False by default. */
  useGuiCanvas: boolean;
  /** Named clipping masks this composition defines. */
  readonly clips: ClipDefinition[] = [];

  constructor(options: PageOptions = {}) {
    super();
    this.width = options.width ?? DEFAULT_COMPOSITION_SIZE;
    this.height = options.height ?? DEFAULT_COMPOSITION_SIZE;
    this.units = options.units ?? DEFAULT_UNITS;
    this.background = options.background ?? null;
    this.id = options.id;
    this.title = options.title;
    this.useGuiCanvas = options.useGuiCanvas ?? false;
  }

  /**
   * Defines a named clipping mask.
   *
   * Elements reference it by id - `clip: 'badge'` - so one mask can be shared,
   * which is the case a mask usually exists for. A one-off mask can be written
   * inline on the element instead.
   */
  defineClip(id: string, shapes: ClipShape | ClipShape[], fillRule?: FillRule): ClipDefinition {
    const definition: ClipDefinition = {
      id,
      shapes: Array.isArray(shapes) ? shapes : [shapes],
      fillRule,
    };
    this.clips.push(definition);
    return definition;
  }

  /** Snapshots the composition as the plain document the renderers read. */
  toDocument(): CompositionDocument {
    return {
      width: this.width,
      height: this.height,
      units: this.units,
      background: this.background,
      id: this.id,
      title: this.title,
      useGuiCanvas: this.useGuiCanvas,
      elements: this.elements,
      clips: this.clips,
    };
  }

  /** Renders the composition as an SVG document. */
  toSVG(options?: SvgOptions): string {
    return compositionToSvg(this.toDocument(), options);
  }

  /** Renders the composition as PNG file bytes. */
  toPNG(options?: RasterOptions): Uint8Array {
    return renderPng(this.toDocument(), options).data;
  }

  /** Renders to pixels, keeping the warnings the raster pass collected. */
  rasterize(options?: RasterOptions): RasterResult {
    return rasterizeComposition(this.toDocument(), options);
  }
}

/** Creates a composition. Defaults to a 360 by 360 pixel page. */
export function createComposition(options: PageOptions = {}): Composition {
  return new Composition(options);
}

/** A PNG render: the file bytes, its pixel size, and anything skipped. */
export interface PngRender {
  data: Uint8Array;
  width: number;
  height: number;
  warnings: string[];
}

/** Renders a composition document to PNG file bytes. */
export function renderPng(doc: CompositionDocument, options: RasterOptions = {}): PngRender {
  const raster = rasterizeComposition(doc, options);
  return {
    data: encodePng(raster.data, raster.width, raster.height),
    width: raster.width,
    height: raster.height,
    warnings: raster.warnings,
  };
}

/** The export formats a composition renders to. */
export type CompositionFormat = 'svg' | 'png';

/** Options accepted by {@link renderComposition}. */
export interface RenderOptions extends RasterOptions, SvgOptions {
  format?: CompositionFormat;
}

/**
 * Renders a composition in one of its formats.
 *
 * The single entry point a caller parameterises over: the same document, the
 * same elements, the same layout, and the only difference between the two
 * results is the media the graphic is carried in.
 */
export function renderComposition(
  source: Composition | CompositionDocument,
  options: RenderOptions = {},
): string | Uint8Array {
  const doc = source instanceof Composition ? source.toDocument() : source;
  if (options.format === 'png') return renderPng(doc, options).data;
  return compositionToSvg(doc, options);
}
