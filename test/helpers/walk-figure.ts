/**
 * The walking character in `test/imports/walk.svg` as a page with its layer
 * tree, read with no DOM: a `walk_0` group holding the six assemblies in paint
 * order, each a group of its parts - a shoe inside each leg among them - so
 * Animation Mode's rules find the assemblies, their joints and the facing.
 *
 * The marks come from `fixtureSketch`, one part at a time: each part's
 * markup is wrapped in the file's own `<svg>` and style block and read as a
 * fixture of its own, then laid on a layer named after the part, its `-2`
 * style suffix dropped as the importer drops it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createSketch, type Layer, type Sketch } from '../../src/core/types.js';
import { fixtureSketch } from './fixture-sketch.js';
import { repoRoot } from './repo-root.js';

/** A tag: its name, its attributes, and whether it opens, closes, or is both. */
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

/** The group elements directly inside a piece of markup, each with its id and its own markup. */
function childGroups(markup: string): Array<{ id: string; markup: string }> {
  const found: Array<{ id: string; markup: string }> = [];
  let depth = 0;
  let start = -1;
  let id = '';
  for (const m of markup.matchAll(TAG)) {
    const [whole, closing, tag, rest, selfClosing] = m;
    if (tag !== 'g' || selfClosing) continue;
    if (!closing) {
      if (depth === 1) {
        start = m.index;
        id = /\bid="([^"]*)"/.exec(rest)?.[1] ?? '';
      }
      depth++;
    } else {
      depth--;
      if (depth === 1) found.push({ id, markup: markup.slice(start, m.index + whole.length) });
    }
  }
  return found;
}

/** The character as a page: `walk_0` > the six assemblies > their parts. */
export function walkFigure(): Sketch {
  const svg = readFileSync(join(repoRoot(), 'test', 'imports', 'walk.svg'), 'utf8');
  const open = svg.slice(0, svg.indexOf('>', svg.indexOf('<svg')) + 1);
  const defs = /<defs>[\s\S]*?<\/defs>/.exec(svg)?.[0] ?? '';
  const [figure] = childGroups(`<g>${svg.slice(open.length, svg.lastIndexOf('</svg>'))}</g>`);

  const sketch = createSketch('walk');
  const page = fixtureSketch(svg);
  sketch.width = page.width;
  sketch.height = page.height;
  sketch.background = '#ffffff';
  sketch.createdAt = sketch.updatedAt = '2026-09-25T00:00:00.000Z';

  let n = 0;
  const layer = (name: string, parent: string | undefined, group = false): Layer => ({
    id: `ly_walk_${++n}`,
    name,
    opacity: 1,
    visible: true,
    locked: false,
    ...(group ? { group: true } : {}),
    ...(parent ? { parent } : {}),
  });
  const root = layer(figure.id, undefined, true);
  const layers: Layer[] = [];
  sketch.strokes = [];
  for (const assembly of childGroups(figure.markup)) {
    const group = layer(assembly.id, root.id, true);
    for (const part of childGroups(assembly.markup)) {
      const leaf = layer(part.id.replace(/-\d+$/, ''), group.id);
      const marks = fixtureSketch(`${open}${defs}${part.markup}</svg>`).strokes;
      sketch.strokes.push(...marks.map((stroke, i) => ({ ...stroke, id: `${leaf.id}_st${i}`, layer: leaf.id })));
      layers.push(leaf);
    }
    // A group's row follows its children, as the app keeps the stack.
    layers.push(group);
  }
  layers.push(root);
  sketch.layers = layers;
  return sketch;
}
