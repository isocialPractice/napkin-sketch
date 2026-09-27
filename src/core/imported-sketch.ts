/**
 * Imported files as pages, with no store and no DOM.
 *
 * The app brings a file in by adding its layers to the page in view: an SVG's
 * layer tree, a PDF's pages. Automate > Generate Script needs the same thing
 * without a page to add to - the file as a page of its own - so the writer can
 * turn it into a script. The one routine that builds the layers is here, and
 * the store's import calls it too, so a generated script and an import cannot
 * disagree about the tree a file makes.
 */

import type { Effect } from './effects.js';
import type { ImportedPdfPage } from './pdf-import.js';
import { createGroupLayer, createId, createLayer, createSketch, type Layer, type Sketch, type Stroke } from './types.js';

/** One layer read from a file; a group when it has children. The SVG importer's layers are these. */
export interface ImportedTreeNode {
  name: string;
  opacity: number;
  strokes: Stroke[];
  children?: ImportedTreeNode[];
  /** Effects the layer carried in the file. */
  effects?: Effect[];
}

/** A file read as one page: its size, its paper when it had one, and its layers. */
export interface ImportedDocument {
  width: number;
  height: number;
  background?: string;
  layers: ImportedTreeNode[];
}

/** The layers and marks a file's tree becomes, in stack order, and the layer the import leaves active. */
export interface BuiltLayers {
  layers: Layer[];
  strokes: Stroke[];
  /** The last drawing layer made, or null when none was. */
  active: string | null;
}

/**
 * Builds the layer rows and marks for an imported tree, as the app stacks
 * them: a node with children becomes a group whose children come first and
 * whose header follows them, which is what draws the header above them in the
 * Layers panel. Marks a file kept on a group itself get a row of their own
 * inside it, named apart from the group so the panel shows no name twice.
 * Every layer and mark gets a new id.
 */
export function buildImportedLayers(nodes: readonly ImportedTreeNode[]): BuiltLayers {
  const layers: Layer[] = [];
  const strokes: Stroke[] = [];
  let active: string | null = null;
  const leaf = (
    item: ImportedTreeNode,
    parent: string | undefined,
    opacity = item.opacity,
    name = item.name,
    effects = item.effects,
  ): void => {
    const layer = createLayer(name);
    layer.opacity = opacity;
    layer.parent = parent;
    if (effects) layer.effects = effects;
    layers.push(layer);
    for (const stroke of item.strokes) strokes.push({ ...stroke, id: createId('st'), layer: layer.id });
    active = layer.id;
  };
  const add = (item: ImportedTreeNode, parent?: string): void => {
    if (item.children && item.children.length > 0) {
      const group = createGroupLayer(item.name);
      group.opacity = item.opacity;
      group.parent = parent;
      if (item.effects) group.effects = item.effects;
      for (const child of item.children) add(child, group.id);
      if (item.strokes.length > 0) leaf(item, group.id, 1, `${item.name} contents`, undefined);
      layers.push(group);
    } else {
      leaf(item, parent);
    }
  };
  for (const node of nodes) add(node);
  return { layers, strokes, active };
}

/**
 * An imported SVG as a page of its own: the file's size, rounded up so nothing
 * is cut; its paper when it had one, the app's otherwise; and its layer tree.
 */
export function importedToSketch(document: ImportedDocument, name: string): Sketch {
  const sketch = createSketch(name);
  sketch.width = Math.max(1, Math.ceil(document.width));
  sketch.height = Math.max(1, Math.ceil(document.height));
  sketch.sizeMode = 'sized';
  if (document.background) sketch.background = document.background;
  const built = buildImportedLayers(document.layers);
  if (built.layers.length > 0) {
    sketch.layers = built.layers;
    sketch.strokes = built.strokes;
  }
  return sketch;
}

/**
 * An imported PDF's pages as the app adds them: one page each, named for the
 * file (with `-1`, `-2` and on when there is more than one), its size rounded,
 * its detected paper, and its marks on one layer.
 */
export function pdfPagesToSketches(pages: readonly ImportedPdfPage[], name: string): Sketch[] {
  return pages.map((page, index) => {
    const sketch = createSketch(pages.length === 1 ? name : `${name}-${index + 1}`);
    sketch.width = Math.round(page.width);
    sketch.height = Math.round(page.height);
    if (page.background) sketch.background = page.background;
    sketch.strokes = page.strokes.map((stroke) => ({ ...stroke, layer: sketch.layers[0].id }));
    return sketch;
  });
}

/**
 * A page with every id made anew - its own, its layers' and its marks' - and
 * every reference to them kept: how a page drawn elsewhere (a script the
 * evaluator counted ids for) joins a book that may hold the same ids already.
 */
export function withNewIds(sketch: Sketch): Sketch {
  const ids = new Map(sketch.layers.map((layer) => [layer.id, createId(layer.group ? 'gp' : 'ly')]));
  return {
    ...sketch,
    id: createId('sk'),
    layers: sketch.layers.map((layer) => ({
      ...layer,
      id: ids.get(layer.id) ?? createId('ly'),
      ...(layer.parent !== undefined ? { parent: ids.get(layer.parent) ?? layer.parent } : {}),
    })),
    strokes: sketch.strokes.map((stroke) => ({
      ...stroke,
      id: createId('st'),
      ...(stroke.layer !== undefined ? { layer: ids.get(stroke.layer) ?? stroke.layer } : {}),
    })),
  };
}
