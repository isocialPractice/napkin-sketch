/**
 * Measures the illustrated frame assets and writes the movement budgets a
 * drawn frame is held to.
 *
 * `character-wireframes.svg` gives joint *angles*: how far a limb turns. It
 * says nothing about how far anything actually travels on the page, and a
 * frame can satisfy every angle in the cycle table while the figure reads as a
 * mannequin with flapping limbs - the torso pinned, the clothing rigid, the
 * legs scissoring twice as far as a person's ever do.
 *
 * The two illustrated assets are finished drawings of the same animations, so
 * they answer the question the wireframes cannot: in a frame a person drew,
 * how far does each part of the figure move between one frame and the next?
 * This script reads that off them.
 *
 *   npm run illustrated-frames              # rewrite the JSON asset
 *   npm run illustrated-frames -- --print   # measure and print, writing nothing
 *   npm run illustrated-frames -- --check <file.svg> [frameId ...]
 *                                           # measure any SVG against the budgets
 *
 * `--check` is the one to reach for when a generated animation looks wrong: it
 * prints the same numbers for frames the app produced, beside what the drawn
 * studies do, so "the legs swing too far" stops being a matter of opinion.
 *
 * Re-run the plain form whenever either illustrated asset changes.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * This file's own URL, or '' when there is none.
 *
 * The test suite bundles this module to CommonJS to exercise the measuring
 * functions, and a bundle has no `import.meta`. Everything that needs a path
 * on disk belongs to the command line, which does not run in that case, so an
 * empty string here is a fine answer rather than a failure.
 */
const selfUrl = typeof import.meta === 'undefined' ? '' : (import.meta.url ?? '');
const root = selfUrl ? resolve(dirname(fileURLToPath(selfUrl)), '..') : process.cwd();
const ASSET_DIR = join(root, 'ai-helper', 'vectors', 'skills', 'vector-animations', 'assets');
const SINGLE = 'illustrated-single-character-actions.svg';
const MULTIPLE = 'illustrated-multiple-character-actions.svg';
const OUT = join(ASSET_DIR, 'illustrated-frames.json');

/** Below this much movement, as a percent of figure height, a layer held still. */
const STILL = 0.05;

// ---------------------------------------------------------------- geometry

/**
 * Every absolute point a path `d` traces, control points included.
 *
 * Control points overstate a curve's extent slightly, but the same shape is
 * overstated the same way in every frame, so a difference between frames is
 * unaffected - which is all this script measures.
 */
export function pathPoints(d) {
  const tok = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const pts = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  const num = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
    if (i >= tok.length) break;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        cx = num() + ox;
        cy = num() + oy;
        sx = cx;
        sy = cy;
        pts.push([cx, cy]);
        // A second coordinate pair after a moveto is a lineto, per the spec.
        cmd = rel ? 'l' : 'L';
        break;
      case 'L':
        cx = num() + ox;
        cy = num() + oy;
        pts.push([cx, cy]);
        break;
      case 'H':
        cx = num() + ox;
        pts.push([cx, cy]);
        break;
      case 'V':
        cy = num() + oy;
        pts.push([cx, cy]);
        break;
      case 'C': {
        const ax = num() + ox;
        const ay = num() + oy;
        const bx = num() + ox;
        const by = num() + oy;
        cx = num() + ox;
        cy = num() + oy;
        pts.push([ax, ay], [bx, by], [cx, cy]);
        break;
      }
      case 'S':
      case 'Q': {
        const ax = num() + ox;
        const ay = num() + oy;
        cx = num() + ox;
        cy = num() + oy;
        pts.push([ax, ay], [cx, cy]);
        break;
      }
      case 'T':
        cx = num() + ox;
        cy = num() + oy;
        pts.push([cx, cy]);
        break;
      case 'A':
        // rx ry rotation large-arc sweep are not coordinates; only the end is.
        num();
        num();
        num();
        num();
        num();
        cx = num() + ox;
        cy = num() + oy;
        pts.push([cx, cy]);
        break;
      case 'Z':
        cx = sx;
        cy = sy;
        break;
      default:
        i++;
    }
  }
  return pts;
}

/** The box every path inside a chunk of markup falls in, or null for no paths. */
export function boundsOf(markup) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of markup.matchAll(/\sd="([^"]+)"/g)) {
    for (const [x, y] of pathPoints(m[1])) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Direct child `<g id="...">` elements of a chunk, with their inner markup. */
export function childGroups(s) {
  const out = [];
  const open = /<g\b[^>]*?\bid="([^"]+)"[^>]*?>/g;
  let m;
  while ((m = open.exec(s))) {
    if (m[0].endsWith('/>')) continue;
    let depth = 1;
    const scan = /<g\b[^>]*?>|<\/g>/g;
    scan.lastIndex = open.lastIndex;
    let t;
    while (depth > 0 && (t = scan.exec(s))) {
      if (t[0] === '</g>') depth--;
      else if (!t[0].endsWith('/>')) depth++;
    }
    // The opening tag comes too: a caller resolving transforms needs the
    // group's own `transform`, which is not part of its inside.
    out.push({
      id: m[1],
      open: m[0],
      inner: s.slice(open.lastIndex, scan.lastIndex - '</g>'.length),
    });
    open.lastIndex = scan.lastIndex;
  }
  return out;
}

// ------------------------------------------------------------------- parts

/** The editor uniquifier an export appends, removed: `head-63` -> `head`. */
const baseName = (id) => id.replace(/-\d+$/, '').toLowerCase();

/**
 * What part of a figure a layer name describes.
 *
 * Deliberately loose, because the assets are the evidence that names are
 * loose: `dress`, `upper-body`, `left-vest`, `jacket-keft` (a typo the artist
 * left in) and `upperarm` all have to land somewhere sensible. A name that
 * matches nothing is 'other' and is measured but not budgeted.
 */
export function partOf(id) {
  const n = baseName(id);
  if (/leg|shoe|foot|thigh|shin|knee/.test(n)) return 'leg';
  if (/arm|glove|hand|elbow|fist/.test(n)) return 'arm';
  if (/head|hair|face|hat/.test(n)) return 'head';
  if (/jacket|keft|vest|skirt|dress|shirt|coat|cape|scarf|belt/.test(n)) return 'clothing';
  if (/body|torso|chest|hip|pelvis/.test(n)) return 'torso';
  return 'other';
}

const round = (v) => Math.round(v * 10) / 10;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
};

/** Every point a layer draws, relative to the layer's own top-left corner. */
function layerShape(inner, b) {
  const pts = [];
  for (const m of inner.matchAll(/\sd="([^"]+)"/g)) {
    for (const [x, y] of pathPoints(m[1])) pts.push(x - b.minX, y - b.minY);
  }
  return pts;
}

/**
 * How far the furthest point of a layer moved within the layer itself, as a
 * percent of figure height - the difference between a part that was posed and
 * one that was picked up and set down somewhere else unchanged.
 *
 * A different number of points means the artist added or removed strokes, so
 * the layer was certainly redrawn; that returns Infinity rather than a
 * measurement, and reads as "redrawn" everywhere it is used.
 */
function reshapeOf(a, b, height) {
  if (a.length !== b.length) return Infinity;
  let max = 0;
  for (let i = 0; i < a.length; i += 2) {
    max = Math.max(max, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]));
  }
  return (max / height) * 100;
}

/**
 * One frame, measured: its height, where its layers sit, and the horizontal
 * anchor everything is read against.
 *
 * The anchor is the median of the layer centres rather than the figure's own
 * box, because the box's left edge is set by whichever limb happens to swing
 * widest - so anchoring on it would report the whole figure lurching sideways
 * every time an arm moved.
 */
export function measureFrame(inner) {
  const fig = boundsOf(inner);
  if (!fig) return null;
  const layers = childGroups(inner)
    .map((l) => {
      const b = boundsOf(l.inner);
      if (!b) return null;
      return {
        id: baseName(l.id),
        part: partOf(l.id),
        cx: (b.minX + b.maxX) / 2,
        cy: (b.minY + b.maxY) / 2,
        // Every point the layer draws, moved to the layer's own origin. Two
        // frames of the same layer can then be compared shape to shape,
        // whatever the layer's position is.
        shape: layerShape(l.inner, b),
      };
    })
    .filter(Boolean);
  if (layers.length === 0) return null;
  const trunk = layers.filter((l) => l.part === 'torso');
  // The trunk is what the figure's height is carried by, so the bob is read
  // off it. With no torso layer at all - a character in a dress - the
  // clothing and head that cover the trunk stand in for it.
  const stand = trunk.length ? trunk : layers.filter((l) => l.part === 'clothing' || l.part === 'head');
  return {
    height: fig.maxY - fig.minY,
    anchorX: median(layers.map((l) => l.cx)),
    trunkY: median((stand.length ? stand : layers).map((l) => l.cy)),
    layers,
  };
}

/**
 * The step from one measured frame to the next.
 *
 * `bob` is the whole figure rising or falling. Everything else is measured
 * after the bob is taken out, so a part that only moved because the figure
 * dropped does not read as having been posed.
 */
export function measureStep(a, b) {
  const H = (a.height + b.height) / 2 || 1;
  const bob = ((b.trunkY - a.trunkY) / H) * 100;
  const parts = {};
  const reshapes = {};
  const still = [];
  const frozen = [];
  const rigid = [];
  let redrawn = 0;
  let compared = 0;
  for (const la of a.layers) {
    const lb = b.layers.find((x) => x.id === la.id);
    if (!lb) continue;
    compared++;
    const dx = ((lb.cx - b.anchorX - (la.cx - a.anchorX)) / H) * 100;
    const absDy = ((lb.cy - la.cy) / H) * 100;
    const dy = absDy - bob;
    const moved = Math.hypot(dx, dy);
    const reshape = reshapeOf(la.shape, lb.shape, H);
    // Still relative to the trunk but carried by the bob is a part riding
    // along, which is ordinary. Still in absolute terms is a part that was
    // not touched at all.
    if (Math.hypot(dx, absDy) < STILL && reshape < STILL) frozen.push(la.id);
    if (moved < STILL && reshape < STILL) still.push(la.id);
    else if (reshape < STILL) rigid.push(la.id);
    else redrawn++;
    (parts[la.part] ??= []).push(moved);
    if (Number.isFinite(reshape)) (reshapes[la.part] ??= []).push(reshape);
  }
  return {
    bob: round(bob),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(Math.max(...v))])),
    reshape: Object.fromEntries(
      Object.entries(reshapes).map(([k, v]) => [k, round(Math.max(...v))]),
    ),
    layersRedrawn: redrawn,
    // Carried to a new place with every point in the same relative spot: a
    // pure translation. A rotation moves the points against each other, so a
    // turned limb counts as redrawn here, which is what it is - the drawing
    // changed.
    layersMovedRigidly: rigid,
    layersHeldStill: still,
    layersFrozen: frozen,
    layersCompared: compared,
  };
}

/** Frames of a sequence in playing order: `_0`, `_1`, ... with a bare base first. */
function inFrameOrder(groups) {
  return groups
    .map((g) => ({ n: Number(/_(\d+)$/.exec(g.id)?.[1] ?? 0), ...g }))
    .sort((x, y) => x.n - y.n);
}

/** Every measurable step of one named sequence of frames. */
function measureSequence(source, label, type, groups) {
  const frames = inFrameOrder(groups)
    .map((g) => ({ id: g.id, m: measureFrame(g.inner) }))
    .filter((f) => f.m);
  if (frames.length < 2) return null;
  const steps = [];
  for (let i = 1; i < frames.length; i++) {
    steps.push({
      from: frames[i - 1].id,
      to: frames[i].id,
      ...measureStep(frames[i - 1].m, frames[i].m),
    });
  }
  return {
    source,
    sequence: label,
    type,
    frames: frames.map((f) => f.id),
    // The names exactly as drawn: this is the corpus of what real documents
    // call their layers, and half of them do not match the rig.
    layersAsDrawn: [...new Set(frames.flatMap((f) => f.m.layers.map((l) => l.id)))],
    steps,
  };
}

// ------------------------------------------------------------------ budgets

/**
 * Low, typical and high of a set of readings, as a percent of figure height.
 *
 * The typical value is the one to aim at. A three-frame sequence covers the
 * same movement in fewer steps than an eight-frame one, so its steps are
 * larger, and the high end of a range is usually one of those rather than
 * anything a frame should copy.
 */
function span(values) {
  const v = values.filter((n) => Number.isFinite(n));
  return v.length
    ? { low: round(Math.min(...v)), typical: round(median(v)), high: round(Math.max(...v)) }
    : null;
}

/**
 * What one animation type's drawn frames do, per step - the range a generated
 * frame should land inside.
 */
function budgetFor(sequences) {
  const steps = sequences.flatMap((s) => s.steps);
  if (!steps.length) return null;
  const part = (k) => span(steps.map((s) => s.parts[k]).filter((n) => n !== undefined));
  const shape = (k) => span(steps.map((s) => s.reshape[k]).filter((n) => n !== undefined));
  const compared = steps.reduce((n, s) => n + s.layersCompared, 0);
  return {
    steps: steps.length,
    bob: span(steps.map((s) => Math.abs(s.bob))),
    leg: part('leg'),
    arm: part('arm'),
    head: part('head'),
    clothing: part('clothing'),
    torso: part('torso'),
    // How much each part is redrawn rather than repositioned. A generated
    // frame that only applies transforms scores zero here by construction.
    reshape: {
      leg: shape('leg'),
      arm: shape('arm'),
      head: shape('head'),
      clothing: shape('clothing'),
      torso: shape('torso'),
    },
    layersCompared: compared,
    layersRedrawn: steps.reduce((n, s) => n + s.layersRedrawn, 0),
    layersMovedRigidly: steps.reduce((n, s) => n + s.layersMovedRigidly.length, 0),
    layersHeldStill: steps.reduce((n, s) => n + s.layersHeldStill.length, 0),
    layersFrozen: steps.reduce((n, s) => n + s.layersFrozen.length, 0),
  };
}

// -------------------------------------------------------------- collection

/** The animation type a sequence label names, or null when it names none. */
function typeOf(label) {
  const n = label.toLowerCase();
  if (/walk-run|transition/.test(n)) return 'walk-run-transition';
  if (/walk/.test(n)) return 'walk';
  if (/run/.test(n)) return 'run';
  if (/ideal|stance/.test(n)) return 'ideal';
  if (/getup/.test(n)) return 'get-up';
  if (/predefeat|defeat|knock/.test(n)) return 'knocked-down';
  if (/damage|hurt/.test(n)) return 'damage';
  if (/attack|punch|kick|combo|jump/.test(n)) return 'attack';
  return null;
}

/**
 * The single-character asset: one group per action, each holding a strip of
 * numbered frames.
 */
function fromSingle(text) {
  const out = [];
  for (const character of childGroups(text)) {
    for (const action of childGroups(character.inner)) {
      const frames = childGroups(action.inner);
      if (frames.length < 2) continue;
      const seq = measureSequence(SINGLE, `${character.id}/${action.id}`, typeOf(action.id), frames);
      if (seq) out.push(seq);
    }
  }
  return out;
}

/**
 * The multi-character asset: one group per character, holding every frame of
 * every one of that character's animations, named `<Character>_<action>_<n>`.
 * A frame named for the character alone is that animation's first frame.
 */
function fromMultiple(text) {
  const out = [];
  for (const character of childGroups(text)) {
    const frames = childGroups(character.inner);
    if (!frames.length) continue;
    const name = /^([A-Za-z]+)/.exec(frames[0].id)?.[1] ?? character.id;
    /** action name -> the frames drawn for it */
    const byAction = new Map();
    for (const f of frames) {
      // `SassyGirl_attack_powerAttack_1` -> `attack_powerAttack`; a bare
      // `BadGirl` is the base pose every action starts from.
      const rest = f.id.startsWith(`${name}_`) ? f.id.slice(name.length + 1) : '';
      const action = rest.replace(/_?\d+(-\d+)?$/, '') || 'walk';
      if (!byAction.has(action)) byAction.set(action, []);
      byAction.get(action).push(f);
    }
    for (const [action, group] of byAction) {
      if (group.length < 2) continue;
      const seq = measureSequence(MULTIPLE, `${character.id}/${name}_${action}`, typeOf(action), group);
      if (seq) out.push(seq);
    }
  }
  return out;
}

// ------------------------------------------------------------------ report

function printSequences(sequences) {
  for (const s of sequences) {
    console.log(`\n## ${s.sequence}${s.type ? `  [${s.type}]` : ''}  (${s.frames.length} frames)`);
    console.log(`   layers as drawn: ${s.layersAsDrawn.join(', ')}`);
    for (const st of s.steps) {
      const parts = Object.entries(st.parts)
        .map(([k, v]) => `${k} ${v.toFixed(1)}%`)
        .join('  ');
      const still = st.layersHeldStill.length ? `  still: ${st.layersHeldStill.join(', ')}` : '';
      const stiff = st.layersMovedRigidly.length ? `  rigid: ${st.layersMovedRigidly.join(', ')}` : '';
      console.log(
        `   ${st.from} -> ${st.to}:  bob ${st.bob.toFixed(1)}%  ${parts}` +
          `  [${st.layersRedrawn}/${st.layersCompared} redrawn]${stiff}${still}`,
      );
    }
  }
}

function printBudgets(budgets) {
  console.log('\n=== movement per step, percent of figure height: typical (low-high) ===');
  for (const [type, b] of Object.entries(budgets)) {
    const f = (s) => (s ? `${s.typical} (${s.low}-${s.high})` : '--').padStart(18);
    console.log(
      `  ${type.padEnd(21)} ${String(b.steps).padStart(3)} steps  bob ${f(b.bob)}  leg ${f(b.leg)}` +
        `  arm ${f(b.arm)}  clothing ${f(b.clothing)}`,
    );
  }
  console.log('\n=== redrawn vs repositioned, layers across all steps ===');
  for (const [type, b] of Object.entries(budgets)) {
    const pct = (n) => `${Math.round((n / b.layersCompared) * 100)}%`.padStart(4);
    console.log(
      `  ${type.padEnd(21)} ${String(b.layersCompared).padStart(4)} layers   ` +
        `redrawn ${pct(b.layersRedrawn)}   moved rigidly ${pct(b.layersMovedRigidly)}   ` +
        `riding the bob ${pct(b.layersHeldStill)}   frozen ${pct(b.layersFrozen)}`,
    );
  }
}

/** Measures an arbitrary SVG the same way, for `--check`. */
async function check(file, only) {
  const text = await readFile(resolve(file), 'utf-8');
  let frames = childGroups(text);
  // A wrapper group holding the frames is as common as frames at the top
  // level; if the top level holds exactly one group, look inside it.
  if (frames.length === 1) frames = childGroups(frames[0].inner);
  if (only.length) frames = only.map((id) => frames.find((f) => f.id === id)).filter(Boolean);
  const seq = measureSequence(file, file.split(/[\\/]/).pop(), null, frames);
  if (!seq) {
    console.error(`illustrated-frames: could not measure two or more frames in ${file}`);
    process.exitCode = 1;
    return;
  }
  printSequences([seq]);
  const asset = JSON.parse(await readFile(OUT, 'utf-8').catch(() => 'null'));
  if (asset?.budgets) {
    console.log('\n   measured against the drawn studies:');
    printBudgets(asset.budgets);
  }
  // A part held still for one step is ordinary; the same part frozen in place
  // for every step of the sequence was never posed at all.
  const stuck = seq.steps.filter((s) => s.layersFrozen.length > 0);
  if (stuck.length > 0 && stuck.length === seq.steps.length) {
    const always = stuck[0].layersFrozen.filter((id) =>
      stuck.every((s) => s.layersFrozen.includes(id)),
    );
    if (always.length) {
      console.log(
        `\n   WARNING: ${always.length} layer(s) never move in any step - ${always.join(', ')}.` +
          '\n   A part that is identical in every frame was copied, not posed.',
      );
    }
  }
}

async function run() {
  const args = process.argv.slice(2);
  const checkAt = args.indexOf('--check');
  if (checkAt >= 0) {
    const [file, ...only] = args.slice(checkAt + 1);
    if (!file) {
      console.error('illustrated-frames: --check needs a file');
      process.exitCode = 1;
      return;
    }
    await check(file, only);
    return;
  }

  const sequences = [
    ...fromSingle(await readFile(join(ASSET_DIR, SINGLE), 'utf-8')),
    ...fromMultiple(await readFile(join(ASSET_DIR, MULTIPLE), 'utf-8')),
  ].filter((s) => s.steps.length);

  const budgets = {};
  for (const type of [...new Set(sequences.map((s) => s.type).filter(Boolean))].sort()) {
    const b = budgetFor(sequences.filter((s) => s.type === type));
    if (b) budgets[type] = b;
  }

  if (args.includes('--print')) {
    printSequences(sequences);
    printBudgets(budgets);
    return;
  }

  const asset = {
    generatedFrom: [SINGLE, MULTIPLE],
    note:
      'Measured from finished illustrated frames: how far each part of a figure moves between one drawn frame and the next, as a percent of the figure height. ' +
      'The wireframe cycles give joint angles; these give travel. `bob` is the whole figure rising or falling, and every other number is measured after the bob is removed. ' +
      'Run `npm run illustrated-frames -- --check <file.svg>` to measure a generated animation the same way.',
    stillThresholdPercent: STILL,
    budgets,
    sequences,
  };
  await writeFile(OUT, `${JSON.stringify(asset, null, 2)}\n`, 'utf-8');
  console.log(
    `illustrated-frames: wrote ${sequences.length} sequences ` +
      `(${sequences.reduce((n, s) => n + s.steps.length, 0)} steps) to`,
  );
  console.log('  ai-helper/vectors/skills/vector-animations/assets/illustrated-frames.json');
  printBudgets(budgets);
}

/**
 * Only run the CLI when this file is the entry point, not when imported.
 *
 * The test suite bundles this file to CommonJS, where `import.meta.url` is not
 * defined at all - so its absence is itself a sign that nothing here was
 * invoked from a command line.
 */
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const selfPath = selfUrl ? resolve(fileURLToPath(selfUrl)) : '';
const sameFile =
  selfPath !== '' &&
  (process.platform === 'win32'
    ? invokedPath.toLowerCase() === selfPath.toLowerCase()
    : invokedPath === selfPath);
if (sameFile) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
