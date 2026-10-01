# The drawing engines: cheatsheet

[API hub](../../../API.md) · [Reference](README.md) · [Quickstart](QUICKSTART.md) · **Cheatsheet**

Reminders for the engines: what each call takes, what it gives back, and where it stops.

## Regions

| Call | Gives |
| --- | --- |
| `booleanOp(a, b, op, { ruleA, ruleB })` | The contours of `union`, `difference` or `intersection`, or null |
| `booleanRegions(a, b, op, options)` | The same, with `junctions`: the corners a cut made |
| A region | Closed contours of `{ x, y }`, page pixels, filled non-zero unless `evenodd` |

## Erasing

| Call | Gives |
| --- | --- |
| `eraseRegionOf(eraser)` | An eraser mark's swath as a region, round at the ends |
| `eraseMarks(page, ids, region)` | `{ changed, removed, skipped, raster }` |
| `eraseKind(mark)` | `area` (a shape, a Copic or a profiled stroke), `line` or `skip` |

## Wipes and stacks

| Call | Gives |
| --- | --- |
| `wipeMarks(page, ids, op)` | An edit: `changed`, `removed`, `added`, `skipped`, `problem`, `empty` |
| `WIPE_OPS` | `in`, `out-front`, `out-back`, `mid`, `outer`, `clean` |
| `wipeOperand(mark)` | What a wipe takes a mark as - its inside or its ink - or null |
| `arrangeFaces(regions)` | `{ faces: [{ contours, covers }], junctions, problem }` |
| `stackFaces(page, ids, points, mode)` | A wipe's edit for `merge` or `remove`, with `missed` |
| `stackArrangement`, `faceAt`, `facesAlong`, `facesInBox`, `stackEdit` | The Shape Stacker's steps, one at a time |

## Splitting

| Call | Gives |
| --- | --- |
| `nearestOnMark(mark, point, { anchorReach })` | `{ subpath, segment, t, point, distance }`, or null |
| `splitMark(mark, at)` | `{ first, second }`: `second` null when a closed path opened |
| `splitTarget(marks, point, reach)` | The topmost mark a point reaches, and where, or null |
| `isSplittable(mark)` | Whether a mark has a path to cut |

## Clipping masks

| Call | Gives |
| --- | --- |
| `makeClip(page, ids)` | `{ clip, layers }`, or `{ problem }`: `too-few` or `open` |
| `releaseClip(page, layerId)` | The clip group to take the clip off, or null |
| `canClip(mark)` | Whether a mark is a closed path that can clip |
| `clipIndex(page)` | `{ marks, any, byGroup, of(layer) }`, worked out once |
| `clippedAt(page, mark, point, index)` | Whether the mark is clipped away there |
| `clipMarkOf`, `clipRegionOf(page, group)` | A group's clip mark, and its inside |
| `shownBounds(page, mark, bounds, index)` | The box cut to its clips, or null |
| `normalizeClips(page)` | Takes off clips that name no closed mark inside |

## Pencils and the Smear

| Call | Gives |
| --- | --- |
| `PENCIL_GRADES`, `PENCIL_KIT` | The 30 grades; the kit as the panel shows it |
| `pencilPaint(choice)` | The grade a choice or a name gives, graphite HB for none |
| `parsePencil(name)` | `{ medium, grade }`, or null |
| `pencilCoverage(grade, tooth, pressure)` | What one pass lays down on that tooth |
| `grainTile(seed)`, `GRAIN_TILE_SIZE` | The paper's tooth, 128 by 128 heights, seamless |
| `pencilRegion(mark, scale)` | The box a mark's picture covers |
| `rasterizePencil(mark, region)`, `pencilPicture` | Its pixels, straight RGBA; with its smears |
| `smudgeBuffer(data, region, pass, rgb, from)` | One stump pass over a picture, in place; where it got to |
| `smudgeFor(mark, drag, width, strength)` | The pass a drag leaves on a mark, or null |

## Liquify

| Call | Gives |
| --- | --- |
| `liquifyField(dab)` | `{ point(p), rotation(p) }` for one dab |
| A dab | `{ mode, x, y, radius, amount, dx, dy }`: `warp`, `twirl`, `pucker` or `bloat` |
| `liquifyMarks(marks, dabs, { tolerance, refit })` | The marks bent, by id |
| `refitLiquified(mark, tolerance, before)` | A bent mark fitted again, its meant lines kept |
| `liquifiable(mark)`, `liquifyReaches(mark, dab)` | Whether it bends; whether a dab reaches it |
| `liquifyFalloff(distance, radius)` | 1 at the centre to 0 at the rim |

## Limits

| Limit | Value |
| --- | --- |
| `BOOLEAN_EDGE_LIMIT` | 40,000 edges, past which `booleanOp` gives null |
| `WIPE_OPERAND_LIMIT` | 32 marks a wipe or a stack takes |
| `WIPE_FACE_LIMIT` | 512 faces an arrangement holds |
| `SPLIT_REACH_PX` | 4 px: how near a script's `split` must land |
| Pucker and Bloat | `amount` held to 0 to 1 |

## One line each

| Want | Write |
| --- | --- |
| Two shapes as one | `wipeMarks(page, [a.id, b.id], 'in')` |
| The top shape cut out of the bottom | `wipeMarks(page, ids, 'out-front')` |
| A gap through the marks under a line | `eraseMarks(page, ids, eraseRegionOf(eraser))` |
| A path cut where a point lands | `splitMark(mark, nearestOnMark(mark, point))` |
| Is it clipped here | `clippedAt(page, mark, point, clipIndex(page))` |
| A pencil's tone | `pencilPaint('2B').tone` |
| A dent pushed into the marks | `liquifyMarks(marks, [{ mode: 'warp', x, y, radius, dx, dy }], { refit: 0.5 })` |
| An edit made | changed in place, removed gone, added on `above` ([the helper](README.md#applying-an-edit)) |
