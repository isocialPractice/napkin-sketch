# The drawing engines

[API hub](../../../API.md) · **Reference** · [Quickstart](QUICKSTART.md) · [Cheatsheet](CHEATSHEET.md)

The app's tools stand on engines that run as plain functions: regions
combined and cut, the Eraser, the Wipe Stacks and the Shape Stacker, Split,
clipping masks, the Pencil's grades and grain, the Smear and Liquify; the
blend modes, the effects and the appearance stack, Splatter, Warp and 3D;
measuring along a path; setting type, hyphenating it and drawing it from font
files; Text Configurations and Composition Styles. This page is the reference
for each as a program calls it from `@isocialpractice/napkin-sketch`, with a worked example
for each that runs as it is.

**Contents**

- [What this is](#what-this-is)
- [The mental model](#the-mental-model)
- [Reference](#reference)
  - [Regions](#regions)
  - [Combining regions: booleanOp](#combining-regions-booleanop)
  - [Erasing: eraseMarks](#erasing-erasemarks)
  - [Wiping: wipeMarks](#wiping-wipemarks)
  - [Faces and stacking: arrangeFaces, stackFaces](#faces-and-stacking-arrangefaces-stackfaces)
  - [Splitting: splitMark](#splitting-splitmark)
  - [Clipping masks](#clipping-masks)
  - [Pencils: PENCIL_GRADES, pencilPaint, grainTile](#pencils-pencil_grades-pencilpaint-graintile)
  - [Smearing: smudgeBuffer](#smearing-smudgebuffer)
  - [Liquify: liquifyField, liquifyMarks](#liquify-liquifyfield-liquifymarks)
  - [Applying an edit](#applying-an-edit)
  - [Blending: BLEND_MODES, blendPixel](#blending-blend_modes-blendpixel)
  - [The appearance stack: addEffect, appearanceSections](#the-appearance-stack-addeffect-appearancesections)
  - [Effects as pixels: runEffects](#effects-as-pixels-runeffects)
  - [Splatter: splatterPaths](#splatter-splatterpaths)
  - [Warp: warpStyleMap](#warp-warpstylemap)
  - [3D: extrudeMesh, revolveMesh, render3d](#3d-extrudemesh-revolvemesh-render3d)
  - [Measuring along a path: lengthTable, pointAtLength](#measuring-along-a-path-lengthtable-pointatlength)
  - [Setting type: layoutType, hyphenate](#setting-type-layouttype-hyphenate)
  - [Fonts as shapes: openSfnt, glyphOutline, outlineText](#fonts-as-shapes-opensfnt-glyphoutline-outlinetext)
  - [Text Configurations: applyTextConfig, resolveRunAttrs](#text-configurations-applytextconfig-resolverunattrs)
  - [Composition styles on a page: applyCompositionStyle](#composition-styles-on-a-page-applycompositionstyle)
- [Worked examples](#worked-examples)
- [Limits](#limits)
- [For agents](#for-agents)
- [See also](#see-also)

## What this is

What the Eraser cuts, what a wipe leaves, where Split cuts and how a Liquify
brush bends are not drawing-window code: each is a function in the core, which
the window calls on a press and a napkin script calls for its verbs. The same
functions are exported from `@isocialpractice/napkin-sketch`, so a program can do to a sketch
what the tools do, with no window, no DOM and no disk.

None of them changes what it is given but the pixel passes, which work on
the picture they are handed. An engine that edits marks gives back the edit -
which marks changed, which went, which were added - and the caller applies
it; one that draws gives back pixels, points or shapes. The sketches they
read are the app's own: a page from `evaluate`, from a `.skbk`, or from the
importer.

## The mental model

```text
 marks --> regions (closed contours) --> booleanOp --> contours
 a page + mark ids --> eraseMarks, wipeMarks, stackFaces --> an edit: changed, removed, added
 a mark + a point --> nearestOnMark --> splitMark --> two marks, or one opened
 a page --> clipIndex --> what each layer is clipped by
 a pencil mark --> rasterizePencil, smudgeBuffer --> its picture's pixels
 marks + dabs --> liquifyMarks --> the marks bent
 two pixels + a mode --> blendPixel --> one pixel
 a picture + effects --> runEffects --> the picture drawn, and what lies under it
 a region + options --> splatterPaths --> hatch paths
 a box + a style --> warpStyleMap --> a map of points
 an outline --> extrudeMesh, revolveMesh --> a mesh;  a mark + 3D --> render3d --> faces
 a path --> lengthTable --> points, directions and bends by distance
 a text --> layoutType --> lines and glyphs --> outlineText + font files --> shapes
 a page + a composition style --> applyCompositionStyle --> the page restyled, and a report
```

Coordinates are page pixels, `y` running down, as everywhere in the app.

## Reference

### Regions

A region is the inside of closed contours: an array of contours, each an
array of points `{ x, y }`, filled under the non-zero rule unless a call says
`evenodd`. A square is one contour of four points; a ring is two, the hole
wound against the outside. Every engine that cuts or combines works on
regions, and gives back marks rebuilt from them, with their curves kept where
a result runs along a mark's own outline.

### Combining regions: booleanOp

`booleanOp(a, b, op, options?)` combines two regions: `union` (in either),
`difference` (in `a` and not in `b`) or `intersection` (in both). It gives
back the result's contours, or null when the operands have more than
`BOOLEAN_EDGE_LIMIT` edges between them or floating point leaves pieces that
will not close. `options.ruleA` and `options.ruleB` say how each operand
fills; `booleanRegions` gives the same result with the vertices where it
passes from one operand's edge to the other's, which a refit keeps as corners.

```js
import { booleanOp } from '@isocialpractice/napkin-sketch';

const square = (x, y, size) => [[{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }]];
const ring = booleanOp(square(0, 0, 100), square(25, 25, 50), 'difference');
console.log(ring.length);
// → 2
const overlap = booleanOp(square(0, 0, 100), square(50, 50, 100), 'intersection');
console.log(JSON.stringify(overlap[0].map((p) => [p.x, p.y]).sort()));
// → [[100,100],[100,50],[50,100],[50,50]]
```

### Erasing: eraseMarks

`eraseMarks(sketch, ids, region)` cuts a region out of the marks of `ids`, as
the app's Eraser does, and gives back `{ changed, removed, skipped, raster }`:
each changed mark whole, by id; the ids of marks it left nothing of; the marks
in reach it passes over - text, pictures and placed files; and the marks whose
cut the geometry could not make. `eraseRegionOf(eraser)` is the region an
eraser mark takes away: its swath, the width it is drawn at all along, with
round ends. `eraseKind(mark)` says how a mark is cut: `area` for a filled
shape, a Copic stroke or a profiled one, `line` for the rest, `skip` for what
it passes over.

- A **line** is cut along its length into a mark of several pieces, one
  subpath each; its width stays.
- An **area** has the region taken out of it, and the cut edge is refitted
  into curves, a corner kept wherever the cut met its edge.

```js
import { evaluate, eraseMarks, eraseRegionOf } from '@isocialpractice/napkin-sketch';

const page = evaluate('napkin 1\nline 0 50 200 50\n').book.sketches[0];
const eraser = { id: 'e', tool: 'eraser', color: '#000000', width: 20, points: [{ x: 100, y: 0 }, { x: 100, y: 100 }] };
const cut = eraseMarks(page, page.strokes.map((s) => s.id), eraseRegionOf(eraser));
const [line] = cut.changed.values();
console.log(JSON.stringify(line.vector.anchors.map((a) => [Math.round(a.p.x), a.p.y])));
// → [[0,50],[89,50],[111,50],[200,50]]
```

The line is cut where the eraser's swath, 20 wide, meets its own width.

### Wiping: wipeMarks

`wipeMarks(sketch, ids, op)` combines the marks of `ids` as the app's Wipe
Stacks - a vector editor's Pathfinder - do, taking them in paint order, the
first at the bottom. `op` is one of `WIPE_OPS`:

| `op` | Pathfinder | What is left | Painted as |
| --- | --- | --- | --- |
| `in` | Unite | everything the marks cover | the topmost mark |
| `out-front` | Minus Front | the bottom mark, less the rest | the bottom mark |
| `out-back` | Minus Back | the top mark, less the rest | the top mark |
| `mid` | Intersect | where all of them overlap | the topmost mark |
| `outer` | Exclude | where an odd number overlap | the topmost mark |
| `clean` | Divide | every piece of their overlaps, a mark each | the topmost mark over the piece |

It gives back an edit, `{ changed, removed, added, skipped, problem, empty }`:
the mark a result is painted as is changed in place, the others are removed,
and `clean`'s pieces are added, each `{ stroke, above }`, `above` the id of the
layer it goes over. `problem` is `too-few`, `too-many` or `failed` when the
wipe did nothing, and `empty` says the result left nothing at all.
`wipeOperand(mark)` says what a mark is to a wipe: a filled mark or a closed
outline is its inside, anything else the ink it paints.

```js
import { evaluate, wipeMarks } from '@isocialpractice/napkin-sketch';

const page = evaluate('napkin 1\nfill #27486d\nrect 0 0 100 100\ncircle 100 50 50\n').book.sketches[0];
const [square, circle] = page.strokes;
const union = wipeMarks(page, [square.id, circle.id], 'in');
console.log(union.problem, union.changed.has(circle.id), union.removed.has(square.id));
// → null true true
```

### Faces and stacking: arrangeFaces, stackFaces

`arrangeFaces(regions)` cuts regions into their faces: every piece some of
them cover and the rest do not, each `{ contours, covers }`, `covers` the
indices of the regions it lies in. It is what the Shape Stacker shows under
the pointer, and what `clean` makes marks of. Past `WIPE_FACE_LIMIT` faces it
gives none, with `problem` saying why.

`stackFaces(sketch, ids, at, mode)` is the Shape Stacker's drag as one call:
the faces of the marks of `ids` under the points `at` are merged into one
shape (`merge`), painted as the topmost mark over the first point's face, or
taken away from every mark (`remove`). It gives back a wipe's edit, with
`missed`, the points on no face. `stackArrangement`, `faceAt`, `facesAlong`,
`facesInBox` and `stackEdit` are its steps, for a caller that picks faces
itself.

```js
import { arrangeFaces, evaluate, stackFaces } from '@isocialpractice/napkin-sketch';

const square = (x, y, size) => [[{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }]];
const { faces } = arrangeFaces([square(0, 0, 100), square(50, 0, 100)]);
console.log(faces.map((face) => face.covers.join('+')).join(' '));
// → 0+1 0 1
const page = evaluate('napkin 1\nfill #d0342c\nrect 0 0 100 100\nfill #27486d\nrect 50 0 100 100\n').book.sketches[0];
const taken = stackFaces(page, page.strokes.map((s) => s.id), [{ x: 75, y: 50 }], 'remove');
console.log(taken.changed.size, taken.missed.length);
// → 2 0
```

The overlap taken away leaves both squares with a notch where they met.

### Splitting: splitMark

`nearestOnMark(mark, point, options?)` finds where on a mark's path a point
lands, `{ subpath, segment, t, point, distance }`, or null for a mark with no
path; with `anchorReach`, an anchor that near wins over any segment, so a cut
there adds none. `splitMark(mark, at)` cuts the mark there, as the app's Split
does, into `{ first, second }`: an open path becomes two marks, the first
keeping the mark's id, and a closed one opens there, `second` null. It is null
where there is nothing to cut, such as the end of an open path.
`splitTarget(marks, point, reach)` finds the topmost of marks given in paint
order whose path passes within `reach` of a point, and `SPLIT_REACH_PX` is the
reach a script's `split` uses.

```js
import { evaluate, nearestOnMark, splitMark } from '@isocialpractice/napkin-sketch';

const line = evaluate('napkin 1\nline 0 0 200 0\n').book.sketches[0].strokes[0];
const at = nearestOnMark(line, { x: 80, y: 3 });
const { first, second } = splitMark(line, at);
console.log(first.vector.anchors.map((a) => a.p.x).join(','), second.vector.anchors.map((a) => a.p.x).join(','));
// → 0,80 80,200
```

### Clipping masks

A clip group is a group layer whose `clip` names a closed mark inside it: the
group shows only inside that mark, which shows nowhere while it clips.

| Function | What it gives |
| --- | --- |
| `makeClip(sketch, ids)` | What Make Clipping Mask does with the marks of `ids`: `{ clip, layers }` - the topmost of them, which clips, and the layers to group - or `{ problem }`, `too-few` or `open` |
| `releaseClip(sketch, layerId)` | The clip group Release Clipping Mask takes the clip off for a layer, or null |
| `canClip(mark)` | Whether a mark can clip: a closed path the Eraser can cut |
| `clipIndex(sketch)` | Every clip on a page, worked out once: `marks`, the clip marks, and `of(layer)`, the clips a layer sits under, innermost first |
| `clippedAt(sketch, mark, point, index?)` | Whether a mark is clipped away at a point |
| `clipMarkOf`, `clipRegionOf(sketch, group)` | A group's clip mark, and its inside as a region |
| `shownBounds(sketch, mark, bounds, index?)` | A mark's box cut to every clip it sits under, or null |
| `normalizeClips(sketch)` | Takes `clip` off every layer it does not name a closed mark inside; says whether it took any off |

`CLIP_GROUP_NAME` is the name Make Clipping Mask gives the group.

```js
import { clipIndex, clippedAt, evaluate, makeClip } from '@isocialpractice/napkin-sketch';

const page = evaluate('napkin 1\nclip "Window" {\n  rect 0 0 200 100\n  circle 100 50 40\n}\n').book.sketches[0];
const [rect] = page.strokes;
const index = clipIndex(page);
console.log(clippedAt(page, rect, { x: 100, y: 50 }, index), clippedAt(page, rect, { x: 10, y: 10 }, index));
// → false true
const loose = evaluate('napkin 1\nrect 0 0 200 100\nline 0 0 10 10\n').book.sketches[0];
console.log(JSON.stringify(makeClip(loose, loose.strokes.map((s) => s.id))));
// → {"problem":"open"}
```

The line is on top, and an open path cannot clip.

### Pencils: PENCIL_GRADES, pencilPaint, grainTile

`PENCIL_GRADES` is the drawing kit, 30 pencils by hardness: graphite 9H to
9B, charcoal pencils, and vine and compressed charcoal. Each grade has its
`label` and script `name`, the `tone` it lays down at its darkest, its `lead`
width, `density`, `grain` and `soft`ness, and the `response` of its pressure.
`pencilPaint(choice)` gives the grade a choice names - `{ medium, grade }`, or
a name as a script writes it - and graphite HB for one it does not know;
`parsePencil(name)` gives the choice or null. `pencilCoverage(grade, tooth,
pressure)` is what one pass lays down on paper of a tooth height.

`grainTile(seed?)` is the paper's tooth: a `GRAIN_TILE_SIZE` square of
heights, 0 a valley and 255 a peak, that wraps without a seam; the same seed
gives the same bytes everywhere. `pencilRegion(mark, scale)` is the box a
mark's picture covers, and `rasterizePencil(mark, region)` its pixels through
that tooth, straight RGBA; `pencilPicture` adds the mark's Smear passes.

```js
import { GRAIN_TILE_SIZE, PENCIL_GRADES, grainTile, pencilPaint } from '@isocialpractice/napkin-sketch';

console.log(PENCIL_GRADES.length, pencilPaint('2B').label, '|', pencilPaint('vine-soft').label);
// → 30 Graphite 2B | Vine charcoal, soft
console.log(pencilPaint('nonsense').label, grainTile().length === GRAIN_TILE_SIZE ** 2);
// → Graphite HB true
```

### Smearing: smudgeBuffer

`smudgeBuffer(data, region, pass, rgb, from?)` runs one pass of the Smear's
stump over a pencil mark's picture, in place: `pass` is `{ points, width,
strength }`, the drag in page pixels, the stump's width and its strength from
0 to 1, and `rgb` the color the graphite is. It trades graphite with the
paper as density, so the darkness is kept and tone moves along the drag. It
gives back where it got to, which a later call takes as `from` to go on with
a drag that has grown. `smudgeFor(mark, drag, width, strength)` is the pass a
drag leaves on one mark, which the app keeps in the mark's `smudges`, and
`DEFAULT_SMEAR_STRENGTH` the strength a new stump has.

```js
import { evaluate, rasterizePencil, smudgeBuffer } from '@isocialpractice/napkin-sketch';

const mark = evaluate('napkin 1\npencil 4B\nline 50 0 50 100\n').book.sketches[0].strokes[0];
const region = { scale: 1, x: 20, y: 0, width: 70, height: 100 };
const picture = rasterizePencil(mark, region);
const reached = () => picture.filter((value, i) => i % 4 === 3 && value > 0).length;
const before = reached();
smudgeBuffer(picture, region, { points: [{ x: 30, y: 50 }, { x: 80, y: 50 }], width: 16, strength: 0.6 }, [0x4a, 0x4d, 0x52]);
console.log(reached() > before);
// → true
```

The stump carried graphite off the line along the drag, so more of the
picture holds some.

### Liquify: liquifyField, liquifyMarks

`liquifyField(dab)` is a Liquify brush's field: where it takes each point,
`point(p)`, and how far it turns the plane there, `rotation(p)`. A dab is
`{ mode, x, y, radius, amount?, dx?, dy? }`: `warp` pushes by `dx`, `dy`;
`twirl` turns by `amount` degrees, clockwise on the screen; `pucker` and
`bloat` draw in or push out by `amount`, 0 to 1, of a point's distance. The
effect falls off smoothly to nothing at the radius, as `liquifyFalloff` says,
and a point past it comes back exactly.

`liquifyMarks(marks, dabs, options?)` is a drag: each dab bends the marks it
reaches, and the next bends what the last left. It gives back the marks bent,
by id; pencil marks, text, pictures and eraser marks are left alone
(`liquifiable`). With `options.refit`, each bent mark is fitted again within
that many pixels so its anchors stay few, as `refitLiquified` does.

```js
import { evaluate, liquifyField, liquifyMarks } from '@isocialpractice/napkin-sketch';

const twirl = liquifyField({ mode: 'twirl', x: 100, y: 100, radius: 50, amount: 90 });
const p = twirl.point({ x: 120, y: 100 });
console.log(Math.round(Math.hypot(p.x - 100, p.y - 100)), JSON.stringify(twirl.point({ x: 200, y: 100 })));
// → 20 {"x":200,"y":100}
const page = evaluate('napkin 1\nrect 20 20 160 100\n').book.sketches[0];
const bent = liquifyMarks(page.strokes, [{ mode: 'warp', x: 100, y: 20, radius: 30, dx: 0, dy: 20 }], { refit: 0.5 });
const [rect] = bent.values();
console.log(bent.size, Math.round(Math.max(...rect.points.filter((q) => q.y < 60).map((q) => q.y))));
// → 1 40
```

A twirl keeps every point's distance from its centre; the warp pushed the
rectangle's top down by its 20 at the brush's centre.

### Applying an edit

`eraseMarks`, `wipeMarks` and `stackFaces` give back an edit and change
nothing. The app applies one as one undo step; a program applies it to a page
the same way: changed marks in their place, keeping their ids and layers,
removed ones gone, and added ones on the layer `above` names.

```js
import { evaluate, wipeMarks } from '@isocialpractice/napkin-sketch';

/** A page with an edit made: what the app's store does with one, as one undo step. */
function applyEdit(page, edit) {
  const kept = page.strokes
    .filter((mark) => !edit.removed.has(mark.id))
    .map((mark) => (edit.changed.has(mark.id) ? { ...edit.changed.get(mark.id), id: mark.id, layer: mark.layer } : mark));
  const added = edit.added.map(({ stroke, above }, i) => ({ ...stroke, id: stroke.id || `added-${i}`, layer: above }));
  return { ...page, strokes: [...kept, ...added] };
}

const page = evaluate('napkin 1\nfill #27486d\nrect 0 0 100 100\ncircle 100 50 50\n').book.sketches[0];
const after = applyEdit(page, wipeMarks(page, page.strokes.map((s) => s.id), 'clean'));
console.log(page.strokes.length, after.strokes.length);
// → 2 3
```

The app puts each added mark on a new layer of its own above `above`; here
they join that layer.

### Blending: BLEND_MODES, blendPixel

The sixteen blend modes of a vector editor's Transparency panel, under
napkin's names - Stack for Multiply, Sheer for Screen - as the canvas, the PNG
and every file draw them. `blendModeOf` reads any of a mode's names, napkin's,
a vector editor's or CSS's; `blendPixel` mixes two straight RGBA pixels,
channels 0 to 1, the source over the backdrop, as `blendColor` mixes two
colors and `blendChannel` one channel of a separable mode.

```js
import { BLEND_MODES, blendModeOf, blendPixel } from '@isocialpractice/napkin-sketch';

console.log(BLEND_MODES.length, blendModeOf('multiply'), blendModeOf('Color Dodge'));
// → 16 stack bleach
console.log(blendPixel('stack', [1, 0.8, 0.4, 1], [0.5, 0.5, 0.5, 1]));
// → [0.5,0.4,0.2,1]
```

### The appearance stack: addEffect, appearanceSections

A mark's effects are one list, in the order they apply; the Appearance panel
shows it in three sections - those aimed at the stroke, at the fill, and at
the whole - and edits it with pure calls that give a new list and never
change the one given: `addEffect`, `replaceEffect`, `removeEffect`,
`duplicateEffect`, `toggleEffect`, `retargetEffect` and `moveEffect`.
`defaultEffect(type)` is an effect with a vector editor's defaults, and
`effectsAfterTransform` is a list scaled, turned or mirrored with its mark.

```js
import { addEffect, appearanceSections, defaultEffect, toggleEffect } from '@isocialpractice/napkin-sketch';

let effects = addEffect([], defaultEffect('outer-glow'));
effects = addEffect(effects, defaultEffect('bevel'), 'fill');
effects = toggleEffect(effects, 0);
const sections = appearanceSections(effects);
console.log(sections.fill.length, sections.object.length, effects[0].on);
// → 1 1 false
```

### Effects as pixels: runEffects

An effect list drawn over a picture as the PNG draws it. `fromRgba8` reads
8-bit pixels into the engine's image; `runEffects` works on that image in
place - the matrix is the one the picture is drawn under, which sizes a blur
and turns a shadow's offset - and gives back what is laid under it apart, an
Outer Shadow or Glow that blends; `toRgba8` writes the image back.
`blankImage` and `layOnto` make a picture and lay one on another in a blend
mode.

```js
import { fromRgba8, runEffects, toRgba8 } from '@isocialpractice/napkin-sketch';

// A 9 by 9 picture: its middle pixel white, the rest clear.
const data = new Uint8ClampedArray(9 * 9 * 4);
data.set([255, 255, 255, 255], (4 * 9 + 4) * 4);
const img = fromRgba8(data, 9, 9);
const under = runEffects(img, [{ type: 'blur', radius: 1 }], [1, 0, 0, 1, 0, 0], () => {});
const out = toRgba8(img);
console.log(under.length, out[(4 * 9 + 4) * 4 + 3] < 255, out[(4 * 9 + 5) * 4 + 3] > 0);
// → 0 true true
```

### Splatter: splatterPaths

A region's fill redrawn as a loose hatch, as a pen scribbles a shape in: the
region is closed contours, and the options a vector editor's Scribble Options,
which `SPLATTER_PRESETS` gives by name, and a seed that draws the same hatch
every time. Each path is cubic anchors.

```js
import { SPLATTER_PRESETS, splatterPaths } from '@isocialpractice/napkin-sketch';

const square = [[{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }]];
const paths = splatterPaths(square, { ...SPLATTER_PRESETS.sharp, seed: 1 });
console.log(paths.length, paths[0].length);
// → 1 16
```

### Warp: warpStyleMap

One of the twelve Warp styles laid over a box: where a point goes, how far
the map turns there and its derivative, which the Warp effect bends a mark's
anchors and handles by. `WARP_STYLES` names them; the options are a vector
editor's Warp Options.

```js
import { WARP_STYLES, warpStyleMap } from '@isocialpractice/napkin-sketch';

const box = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
const arc = warpStyleMap('arc', box, { orientation: 'horizontal', bend: 50, distortH: 0, distortV: 0, part: 'whole' });
const at = (p) => {
  const q = arc.point(p);
  return [Math.round(q.x), Math.round(q.y)];
};
console.log(WARP_STYLES.length, at({ x: 0, y: 0 }), at({ x: 100, y: 0 }), at({ x: 200, y: 0 }));
// → 12 [-25,52] [100,0] [225,52]
```

The arc keeps the box's middle where it was and swings its corners out and
down, as the top of an arch does.

### 3D: extrudeMesh, revolveMesh, render3d

An outline built in depth, pushed back into a solid or turned round an axis,
and a mark's 3D effect drawn as shaded faces, far ones first: each a flat fill
a renderer draws as it draws any shape. `triangulate` cuts a polygon with
holes into triangles; `threeDView` and `projectPoint` put a point of the solid
on the page.

```js
import { defaultEffect, extrudeMesh, render3d, revolveMesh } from '@isocialpractice/napkin-sketch';

const square = { rings: [[{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]], closed: true };
const block = extrudeMesh(square, 20, true);
console.log(block.faces.length, block.faces.filter((face) => face.kind === 'cap').length, block.closed);
// → 6 2 true
const ring = revolveMesh(square, { angle: 360, offset: 10, axis: 'left', segments: 12 }, 0.5);
console.log(ring.faces.length);
// → 48
const mark = { id: 'm', tool: 'pen', color: '#27486d', width: 2, fill: '#ffcc00', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }, { x: 0, y: 0 }] };
const faces = render3d(mark, defaultEffect('3d'));
console.log(faces.length > 0, faces.every((face) => face.points.length > 0));
// → true true
```

The block is six faces, two of them its caps; turned round an axis 10 off
its left edge, the square is a ring of 48 faces, its four edges at twelve
steps.

### Measuring along a path: lengthTable, pointAtLength

A path walked by distance rather than by its curves' own parameter: a table
of a path's lengths, then the point, the direction, the normal and the bend
so far along, and the nearest length to a point. Text on a path, Splatter and
Warp measure by it.

```js
import { lengthTable, pointAtLength, tangentAtLength } from '@isocialpractice/napkin-sketch';

const line = lengthTable([{ p: { x: 0, y: 0 } }, { p: { x: 100, y: 0 } }]);
console.log(line.total, pointAtLength(line, 25), tangentAtLength(line, 25));
// → 100 {"x":25,"y":0} {"x":1,"y":0}
const arch = lengthTable([
  { p: { x: 0, y: 0 }, hOut: { x: 0, y: -55 } },
  { p: { x: 100, y: 0 }, hIn: { x: 100, y: -55 } },
]);
const middle = pointAtLength(arch, arch.total / 2);
console.log(Math.round(arch.total), Math.round(middle.x), Math.round(middle.y));
// → 145 50 -41
```

Halfway along the arch by distance is its top, 41 above the line it stands
on.

### Setting type: layoutType, hyphenate

A text mark set as the app sets it - point, area or path type, horizontal or
vertical - into lines and glyphs, each glyph placed by its own matrix, with
whatever did not fit said in `overset`. With no measure it is set in the
built-in face; the app passes the canvas's. `hyphenate` breaks a word where
the en-US patterns allow, as a paragraph with hyphenation on does.

```js
import { hyphenate, layoutType } from '@isocialpractice/napkin-sketch';

const text = { id: 't', tool: 'text', color: '#1f2328', width: 1, points: [{ x: 20, y: 40 }], text: 'Acme Corp\nannual report', fontSize: 24 };
const layout = layoutType(text);
console.log(layout.lines.length, layout.glyphs.length, layout.overset);
// → 2 22 false
console.log(hyphenate('composition').join('-'));
// → com-po-si-tion
```

### Fonts as shapes: openSfnt, glyphOutline, outlineText

A font file read with no dependency - TrueType and CFF outlines, the
character map, advances and kerning - and a text drawn as its glyphs'
outlines, a mark a glyph, as Expand Text to Shape and a PNG with fonts given
draw it. `fileOutlineSource` turns font files by family into the measure a
text is set by and the faces it is drawn from.

```js
import { HEADLESS_MEASURE, fileOutlineSource, glyphOutline, isSfntProblem, layoutType, openSfnt, outlineText } from '@isocialpractice/napkin-sketch';
import { readFile } from 'node:fs/promises';

const bytes = new Uint8Array(await readFile('fonts/acme-sans.ttf'));
const face = openSfnt(bytes);
if (isSfntProblem(face)) throw new Error(face.problem);
const a = glyphOutline(face, face.glyphId('A'.codePointAt(0)));
console.log(face.format, a.contours.length > 0);
// → truetype true
const source = fileOutlineSource({ 'Acme Sans': bytes }, HEADLESS_MEASURE);
const text = { id: 't', tool: 'text', color: '#1f2328', width: 1, points: [{ x: 20, y: 60 }], text: 'AVTo', fontSize: 48, fontFamily: 'Acme Sans' };
const shapes = outlineText(text, layoutType(text, source.measure), source);
console.log(shapes.marks.map((made) => made.label).join(' '));
// → A V T o
```

### Text Configurations: applyTextConfig, resolveRunAttrs

A book's named character attributes: a run follows one by its id, and what
it sets beyond it is its own, an override. `newTextConfig` makes one,
`applyTextConfig` puts a stretch of a text on it - the text carrying a copy
of its definition - and `resolveRunAttrs` is what a run draws as: its base,
then the configuration, then its overrides.

```js
import { applyTextConfig, baseAttrs, newTextConfig, resolveRunAttrs, styleSegments } from '@isocialpractice/napkin-sketch';

const heading = newTextConfig([], { fontSize: 40, fontStyle: 'Bold' }, 'tc_heading', 'Heading');
const text = { id: 't', tool: 'text', color: '#1f2328', width: 1, points: [{ x: 20, y: 60 }], text: 'Acme Corp', fontSize: 24 };
const styled = applyTextConfig(text, { start: 0, end: 4 }, heading);
console.log(styleSegments(styled).map((segment) => `${segment.end}:${segment.attrs.fontSize}`).join(' '));
// → 4:40 9:24
console.log(resolveRunAttrs(baseAttrs(text), heading, { color: '#c0392b' }).fontStyle);
// → Bold
```

### Composition styles on a page: applyCompositionStyle

A page restyled by its layers' names, as the Composition Styles panel does
it, with the report of what did not match. `captureCompositionStyle` records
a page's named layers as a style; the
[compose reference](../compose/README.md#composition-styles) has the format.

```js
import { applyCompositionStyle, captureCompositionStyle, compositionReportTitle, evaluate } from '@isocialpractice/napkin-sketch';

const page = evaluate('napkin 1\nlayer "Background"\nfill #f4f1ea\nrect 0 0 200 100\nlayer "Title"\ntext "Acme Corp" at 20 50\n').book.sketches[0];
const day = captureCompositionStyle(page, 'Day');
console.log(Object.keys(day.layers), Object.keys(day.text));
// → ["Title","Background"] ["Title"]
const night = { napkinCompositionStyle: 1, name: 'Night', strokes: { Background: { fill: '#000133' } }, text: { Titel: { color: '#ffffff' } } };
const { report } = applyCompositionStyle(page, night);
console.log(compositionReportTitle(report), report.items[0].suggestions);
// → Night: 1 rule did not match ["Title"]
```

## Worked examples

A gap through every line on a page: the Eraser's cut made with a program, and
the page written out as SVG.

```js
import { eraseMarks, eraseRegionOf, evaluate, renderSketch } from '@isocialpractice/napkin-sketch';

const page = evaluate('napkin 1\npage 240 160\nwidth 4\nrepeat 4 as i {\n  line 20 (30 + i * 30) 220 (30 + i * 30)\n}\n').book.sketches[0];
const swath = eraseRegionOf({ id: 'gap', tool: 'eraser', color: '#000000', width: 24, points: [{ x: 120, y: 0 }, { x: 120, y: 160 }] });
const cut = eraseMarks(page, page.strokes.map((s) => s.id), swath);
const strokes = page.strokes.map((mark) => cut.changed.get(mark.id) ?? mark).filter((mark) => !cut.removed.has(mark.id));
const svg = renderSketch({ ...page, strokes }, { format: 'svg' });
console.log(cut.changed.size, svg.startsWith('<?xml'));
// → 4 true
```

A Liquify drag from a program: a Warp pushed across a circle in ten small
dabs, as a pointer moving across it gives them, then fitted again once.

```js
import { evaluate, liquifyMarks } from '@isocialpractice/napkin-sketch';

const page = evaluate('napkin 1\ncircle 100 100 60\n').book.sketches[0];
const dabs = Array.from({ length: 10 }, (_, k) => ({ mode: 'warp', x: 40 + k * 4, y: 100, radius: 40, dx: 4, dy: 0 }));
const [circle] = liquifyMarks(page.strokes, dabs, { refit: 0.5 }).values();
console.log(Math.round(Math.min(...circle.points.map((p) => p.x))), circle.vector.closed);
// → 52 true
```

The left of the circle was pushed in toward its middle - its leftmost point,
once at 40, is at 52 - and the circle is still one closed path.

## Limits

- **Edits are not made.** Every engine that edits marks gives the edit back;
  nothing changes until the caller applies it ([Applying an edit](#applying-an-edit)).
- **A cut can fail.** `booleanOp` gives null past `BOOLEAN_EDGE_LIMIT` edges
  (40,000) or where floating point leaves pieces that will not close; an
  erase lists the marks it could not cut in `raster`; a wipe or a stack says
  `failed`. The app draws an older-style eraser mark where an erase cannot
  cut.
- **Wipes take at most `WIPE_OPERAND_LIMIT` marks** (32) and
  `WIPE_FACE_LIMIT` faces (512), and say `too-many` past them.
- **Text, pictures and placed files are not cut, wiped or bent**: an eraser
  passes over them, a wipe lists them in `skipped`, and Liquify leaves them,
  with pencil marks, which are the Smear's.
- **A pencil picture costs its pixels.** A region is worked out pixel by
  pixel at its scale, and a smear works on all of it: keep a region to the
  mark and its passes, as `pencilRegion` gives it.
- **Liquify's amounts are held** to 0 to 1 for Pucker and Bloat, where neither
  folds the plane; a long push or a wide turn is taken in steps.

## For agents

- **Every call is DOM-free, and nearly every one is pure.** `smudgeBuffer`,
  `runEffects`, `blurPixels` and `layOnto` work on the picture they are
  given in place. `registerGeometryEffect`, `bindGeometry`,
  `setOutlineSource` and `setAccentPage` set state every later call reads,
  and `layoutType` and `render3d` keep what they worked out for a mark that
  has not changed.
- **Get marks from `evaluate`**, or from a `.skbk`, and pass ids, not marks,
  to the calls that take a page: they look the marks up and take them in paint
  order.
- **Check what came back before using it**: null from `booleanOp` and
  `splitMark`, `problem` from a wipe, a stack or `makeClip`, `raster` and
  `skipped` from an erase.
- **Apply an edit as one step**, with the [helper above](#applying-an-edit):
  changed marks keep their ids and layers.
- **Prefer the verbs in a script** when the drawing is written as one:
  [`tool eraser`, `wipe`, `stack`, `split`, `clip`, `pencil`, `smear`,
  `warp`, `twirl`, `pucker` and `bloat`](../drawing/README.md#erasing) run
  these same engines and keep the drawing one file.

## See also

- [Drawing with napkin script](../drawing/README.md): the verbs that run these
  engines - [erasing](../drawing/README.md#erasing),
  [combining](../drawing/README.md#combining-shapes),
  [stacking](../drawing/README.md#stacking-shapes),
  [splitting](../drawing/README.md#splitting-paths),
  [clipping](../drawing/README.md#clipping-masks),
  [pencils](../drawing/README.md#pencils),
  [smearing](../drawing/README.md#smearing) and
  [Liquify](../drawing/README.md#liquify).
- [Using napkin-sketch from code](../node/README.md): the package's entries, and the
  result `evaluate` gives.
- [Writing a drawing out](../output/README.md): what a page with its edits
  made is written as.
- [`src/core/boolean.ts`](../../../src/core/boolean.ts),
  [`erase.ts`](../../../src/core/erase.ts),
  [`wipe.ts`](../../../src/core/wipe.ts),
  [`split.ts`](../../../src/core/split.ts),
  [`clip.ts`](../../../src/core/clip.ts),
  [`pencil.ts`](../../../src/core/pencil.ts),
  [`smudge.ts`](../../../src/core/smudge.ts),
  [`liquify.ts`](../../../src/core/liquify.ts),
  [`blend.ts`](../../../src/core/blend.ts),
  [`appearance.ts`](../../../src/core/appearance.ts),
  [`appearance-fx.ts`](../../../src/core/appearance-fx.ts),
  [`splatter.ts`](../../../src/core/splatter.ts),
  [`warp-styles.ts`](../../../src/core/warp-styles.ts),
  [`three-d/`](../../../src/core/three-d/),
  [`arc-length.ts`](../../../src/core/arc-length.ts),
  [`type/`](../../../src/core/type/) and
  [`composition-style.ts`](../../../src/core/composition-style.ts): the
  engines.
