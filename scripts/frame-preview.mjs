/**
 * Renders an animation frame to a PNG so the thing that drew it can look at it.
 *
 * Animation Mode's helper works blind. It sets transforms on assemblies, saves,
 * and never sees the picture - so a frame can satisfy every instruction and
 * still have a leg through the skirt, an arm off its shoulder, or a stride that
 * reads as a stumble. Those are failures of the drawing, and no amount of
 * measuring the layer tree finds them.
 *
 * This turns the frame into an image. It uses the rasterizer already in the
 * repository - `parsePathData`, the matrix stack and the anti-aliased scanline
 * fill behind the graphic-design API - so nothing is installed to get it, and
 * the PNG encoder is the dependency-free one the API already ships.
 *
 *   npm run frame-preview -- <file.svg>
 *   npm run frame-preview -- <file.svg> --out look.png --scale 6
 *   npm run frame-preview -- <file.svg> --frame BadGirl-walk_2
 *   npm run frame-preview -- <new.svg> --against <previous.svg>
 *
 * `--against` is the one that matters mid-run: it measures the step from the
 * frame you started with to the frame you just drew, and says whether the
 * travel falls where a drawn frame's does. Picture and numbers from one call.
 *
 * Requires `npm run build` first - the rasterizer is read from `dist/api/`,
 * the same way the graphic-design skill's own render script reads it.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { boundsOf, childGroups, measureFrame, measureStep } from './illustrated-frames.mjs';

/**
 * This file's own URL, or '' when there is none - the test suite bundles this
 * module to CommonJS to exercise the parsing, and a bundle has no
 * `import.meta`. Only the command line needs a path on disk.
 */
const selfUrl = typeof import.meta === 'undefined' ? '' : (import.meta.url ?? '');
const root = selfUrl ? resolve(dirname(fileURLToPath(selfUrl)), '..') : process.cwd();

/** The built graphic-design API, found the way the skills find it. */
async function loadApi() {
  const built = join(root, 'dist', 'api', 'index.js');
  try {
    return await import(pathToFileURL(built).href);
  } catch {
    throw new Error('graphic-design API not found at dist/api. Run `npm run build` first.');
  }
}

// ----------------------------------------------------------------- matrices

/** `[a, b, c, d, e, f]`, the same six numbers an SVG matrix() carries. */
const IDENTITY = [1, 0, 0, 1, 0, 0];

function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const applyM = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * One SVG `transform` attribute as a matrix.
 *
 * Only the forms a frame actually carries are handled - the app writes
 * `rotate(angle cx cy)` and nothing else - but translate, scale and matrix cost
 * three lines each and a hand-edited document may hold them.
 */
export function parseTransform(text) {
  let m = IDENTITY;
  if (!text) return m;
  for (const part of text.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const n = (part[2].match(/-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    switch (part[1]) {
      case 'translate':
        m = multiply(m, [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0]);
        break;
      case 'scale':
        m = multiply(m, [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0]);
        break;
      case 'rotate': {
        const r = ((n[0] ?? 0) * Math.PI) / 180;
        const [cos, sin] = [Math.cos(r), Math.sin(r)];
        const [cx, cy] = [n[1] ?? 0, n[2] ?? 0];
        // About a centre: move it to the origin, turn, move it back.
        m = multiply(m, [1, 0, 0, 1, cx, cy]);
        m = multiply(m, [cos, sin, -sin, cos, 0, 0]);
        m = multiply(m, [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'matrix':
        if (n.length >= 6) m = multiply(m, n.slice(0, 6));
        break;
      default:
        break;
    }
  }
  return m;
}

// --------------------------------------------------------------- path data

/**
 * A path `d`, rewritten with every point carried through a matrix.
 *
 * A rotation or a scale is affine, so moving the anchors and the control points
 * moves the curve they describe exactly - no flattening, no loss. Relative
 * commands are resolved to absolute first, because a relative offset means
 * something different once the frame it is measured in has turned.
 */
export function transformPathData(d, m, onArc = () => {}) {
  const tok = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  const num = () => Number(tok[i++]);
  const emit = (letter, pts) => {
    out.push(letter + pts.map((v) => (Math.round(v * 1000) / 1000).toString()).join(' '));
  };

  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
    const upper = cmd.toUpperCase();
    if (upper !== 'Z' && i >= tok.length) break;
    const rel = cmd !== upper;
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;

    switch (upper) {
      case 'M': {
        cx = num() + ox;
        cy = num() + oy;
        sx = cx;
        sy = cy;
        emit('M', applyM(m, cx, cy));
        // A further pair after a moveto is a lineto, per the spec.
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': {
        cx = num() + ox;
        cy = num() + oy;
        emit('L', applyM(m, cx, cy));
        break;
      }
      case 'H': {
        cx = num() + ox;
        emit('L', applyM(m, cx, cy));
        break;
      }
      case 'V': {
        cy = num() + oy;
        emit('L', applyM(m, cx, cy));
        break;
      }
      case 'C': {
        const a = applyM(m, num() + ox, num() + oy);
        const b = applyM(m, num() + ox, num() + oy);
        cx = num() + ox;
        cy = num() + oy;
        emit('C', [...a, ...b, ...applyM(m, cx, cy)]);
        break;
      }
      case 'S':
      case 'Q': {
        const a = applyM(m, num() + ox, num() + oy);
        cx = num() + ox;
        cy = num() + oy;
        emit(upper, [...a, ...applyM(m, cx, cy)]);
        break;
      }
      case 'T': {
        cx = num() + ox;
        cy = num() + oy;
        emit('T', applyM(m, cx, cy));
        break;
      }
      case 'A': {
        // An elliptical arc's radii and sweep do not survive an arbitrary
        // matrix without being re-solved. No frame this repository draws holds
        // one, so rather than mangle it quietly the endpoint is kept and the
        // caller is told.
        num();
        num();
        num();
        num();
        num();
        cx = num() + ox;
        cy = num() + oy;
        emit('L', applyM(m, cx, cy));
        onArc();
        break;
      }
      case 'Z': {
        cx = sx;
        cy = sy;
        out.push('Z');
        break;
      }
      default:
        i++;
    }
  }
  return out.join('');
}

// ------------------------------------------------------------------- parse

/** The value of one attribute on an opening tag. */
function attr(tag, name) {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

/**
 * The paint each class in the document's `<style>` block carries.
 *
 * The app writes `fill` and `stroke` as attributes, but an illustrator's export
 * writes `class="cls-30"` and puts the colour in a stylesheet - and the goal
 * frames a run is compared against are exactly those exports. Without this they
 * render as an empty page, which is a confusing way to be told the preview
 * cannot read the file.
 *
 * Only flat class selectors are read, which is all these exports contain.
 */
export function styleClasses(svg) {
  const map = new Map();
  for (const block of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const rule of block[1].matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = {};
      for (const decl of rule[2].split(';')) {
        const [prop, raw] = decl.split(':').map((s) => s && s.trim());
        if (!prop || !raw) continue;
        const value = raw.replace(/px$/, '');
        if (prop === 'fill') body.fill = value;
        else if (prop === 'stroke') body.stroke = value;
        else if (prop === 'stroke-width') body.strokeWidth = Number(value);
        else if (prop === 'fill-rule') body.fillRule = value;
      }
      // `.cls-6,.cls-7{fill:none}` names several at once.
      for (const selector of rule[1].split(',')) {
        const name = selector.trim().replace(/^\./, '');
        if (!name || selector.includes(' ')) continue;
        map.set(name, { ...(map.get(name) ?? {}), ...body });
      }
    }
  }
  return map;
}

/** A path's paint: its own attributes first, then its classes, then the spec. */
export function paintOf(tag, classes) {
  const style = {};
  for (const name of (attr(tag, 'class') ?? '').split(/\s+/)) {
    if (name && classes.has(name)) Object.assign(style, classes.get(name));
  }
  const fill = attr(tag, 'fill') ?? style.fill ?? '#000000';
  const stroke = attr(tag, 'stroke') ?? style.stroke ?? 'none';
  const width = attr(tag, 'stroke-width') ?? style.strokeWidth ?? 1;
  return {
    // SVG paints black when nothing says otherwise, and a preview that differs
    // from what a browser draws is worse than no preview at all.
    fill: fill === 'none' ? null : fill,
    stroke: stroke === 'none' ? null : stroke,
    strokeWidth: Number(width) || 1,
    fillRule: (attr(tag, 'fill-rule') ?? style.fillRule) === 'evenodd' ? 'evenodd' : 'nonzero',
  };
}

/**
 * Every `<path>` in the document as a flat list, with each one's accumulated
 * group transform already folded into its `d`.
 *
 * The frames are nested a dozen groups deep and only some of those groups
 * carry a transform, so the walk has to keep a stack rather than look at the
 * path's own parent.
 */
function flattenPaths(svg, base, onArc, classes = new Map()) {
  const out = [];
  // A single pass over the markup, keeping a matrix stack: `<g ...>` pushes,
  // `</g>` pops, and a `<path>` is emitted with whatever is on top.
  const stack = [base];
  const token = /<g\b([^>]*)>|<\/g>|<path\b([^>]*)\/?>/g;
  let t;
  while ((t = token.exec(svg))) {
    if (t[0].startsWith('</g')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (t[0].startsWith('<g')) {
      const m = parseTransform(attr(t[0], 'transform'));
      stack.push(multiply(stack[stack.length - 1], m));
      continue;
    }
    const tag = t[0];
    const d = attr(tag, 'd');
    if (!d) continue;
    const own = parseTransform(attr(tag, 'transform'));
    const m = multiply(stack[stack.length - 1], own);
    const paint = paintOf(tag, classes);
    out.push({
      type: 'path',
      d: transformPathData(d, m, onArc),
      fill: paint.fill,
      stroke: paint.stroke,
      // The matrix can scale, so a stroke drawn through it thickens with it.
      strokeWidth: paint.strokeWidth * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]) || 1),
      fillRule: paint.fillRule,
    });
  }
  return out;
}

/** The chunk of markup for one frame group, or the whole document. */
function selectFrame(svg, id) {
  if (!id) return svg;
  let groups = childGroups(svg);
  if (groups.length === 1) groups = childGroups(groups[0].inner);
  const found = groups.find((g) => g.id === id);
  if (!found) {
    const names = groups.map((g) => g.id).join(', ');
    throw new Error(`no frame named ${id}. This file holds: ${names || '(no groups)'}`);
  }
  return found.inner;
}

// ------------------------------------------------------------------ render

async function renderToPng(file, { frame, scale, out }) {
  const api = await loadApi();
  const svg = await readFile(resolve(file), 'utf-8');
  const markup = selectFrame(svg, frame);
  // The stylesheet lives on the document, not inside the frame group.
  const classes = styleClasses(svg);

  let sawArc = false;
  const elements = flattenPaths(markup, IDENTITY, () => {
    sawArc = true;
  }, classes);
  if (!elements.length) throw new Error(`${file} draws nothing`);

  // The drawing decides the page: a frame's own box, with a small margin, so
  // the figure fills the picture whatever the document's viewBox says.
  const box = boundsOf(elements.map((e) => ` d="${e.d}"`).join(''));
  const margin = Math.max(2, (box.maxY - box.minY) * 0.04);
  const width = box.maxX - box.minX + margin * 2;
  const height = box.maxY - box.minY + margin * 2;
  const shift = [1, 0, 0, 1, margin - box.minX, margin - box.minY];
  for (const el of elements) el.d = transformPathData(el.d, shift, () => {});

  const doc = {
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(height)),
    units: 'px',
    // White, not transparent: a preview is looked at, and a figure drawn in
    // black line on a checkerboard is harder to judge than it needs to be.
    background: '#ffffff',
    useGuiCanvas: false,
    elements,
    clips: [],
  };

  const render = api.renderPng(doc, { scale });
  const target = out ?? resolve(file).replace(/\.svg$/i, '') + '.png';
  await writeFile(target, render.data);
  return { target, render, elements: elements.length, sawArc, doc };
}

// ------------------------------------------------------------------ verdict

/** The budget band for a type, read back out of the generated asset. */
async function budgets() {
  const file = join(
    root,
    'ai-helper',
    'vectors',
    'skills',
    'vector-animations',
    'assets',
    'illustrated-frames.json',
  );
  try {
    return JSON.parse(await readFile(file, 'utf-8')).budgets ?? null;
  } catch {
    return null;
  }
}

/** One line per part, saying whether the travel lands where a drawn frame's does. */
function verdict(step, band) {
  const rows = [];
  const say = (name, value, span) => {
    if (!span) {
      rows.push(`   ${name.padEnd(9)} ${value.toFixed(1).padStart(6)}%   (no drawn band to compare)`);
      return;
    }
    const low = span.low;
    const high = span.high;
    const mark = value < low ? 'UNDER' : value > high ? 'OVER ' : '  ok ';
    rows.push(
      `   ${name.padEnd(9)} ${value.toFixed(1).padStart(6)}%   ${mark}  drawn frames: ` +
        `${span.typical} typical (${low}-${high})`,
    );
  };
  say('bob', Math.abs(step.bob), band?.bob);
  for (const part of ['leg', 'arm', 'head', 'clothing']) {
    if (step.parts[part] === undefined) continue;
    say(part, step.parts[part], band?.[part]);
  }
  return rows.join('\n');
}

/**
 * Path data as it is written in the file, in document order.
 *
 * Compared as strings on purpose. A frame that was *posed* carries its pose in
 * `transform` attributes and leaves the `d` of every path exactly as it found
 * it, so the strings match byte for byte. A frame that was *redrawn* has new
 * numbers everywhere, and no tolerance is needed to see the difference.
 */
function pathData(text) {
  return (text.match(/\sd\s*=\s*"([^"]*)"/g) ?? []).map((s) => s.slice(s.indexOf('"') + 1, -1));
}

/**
 * Was this frame posed, or was it drawn again from scratch?
 *
 * This is the failure that costs a whole run, and it is invisible to every
 * other check here: the figure is complete, every layer is present, the file
 * opens - and the geometry has been re-emitted rather than moved, so limbs
 * drift off their joints and proportions wander between frames. It reads as a
 * bad drawing rather than as a broken process, which is why it survives a
 * review by eye.
 *
 * The signature is exact. Posing sets `transform` on an assembly and touches no
 * path data; redrawing rewrites the path data and sets no transform. A frame
 * with neither a single transform nor a single shared path is the second thing,
 * with no room for doubt.
 */
export function poseCheck(posedText, fromText) {
  const posed = pathData(posedText);
  const from = new Set(pathData(fromText));
  const shared = posed.filter((d) => from.has(d)).length;
  const transforms = (posedText.match(/\stransform\s*=\s*"/g) ?? []).length;
  const kept = posed.length === 0 ? 1 : shared / posed.length;
  return {
    transforms,
    shared,
    total: posed.length,
    kept,
    // Both halves have to hold. A frame posed by transform keeps its paths; one
    // that kept its paths and also carries no transform simply did not move,
    // which the frozen-layer check reports in its own words.
    redrawn: transforms === 0 && kept < 0.5,
  };
}

/**
 * The findings, in the order they are worth fixing.
 *
 * Ordered rather than listed because a run has a budget: the first entry is the
 * one to spend the next pass on, and a defect further down is often a symptom
 * of the one above it. A redrawn frame, for instance, produces wild travel
 * numbers and frozen layers at the same time, and fixing those two directly
 * would be treating the smoke.
 *
 * What is deliberately not a finding is how large this step is against the one
 * before it. A cycle winding down - legs travelling 6.9%, then 4.8%, then 4.5%
 * - is a real defect and an obvious thing to want caught, but the drawn frames
 * refuse to support the rule: across the 22 consecutive steps of the drawn
 * walks and runs the leg travel ratio runs from 0.32x to 4.14x, and one drawn
 * walk shrinks all the way down across four steps (9.7, 8.9, 4.8, 3.5). A walk
 * has a contact frame and a passing frame and they are not the same size. Bob
 * direction is the same story - seven of those 22 pairs keep their sign, and
 * twice a drawn run keeps it for three steps together - so alternation is put
 * to the helper in the form, as a rule to apply with judgement, rather than
 * asserted here as a verdict.
 */
export function findings(step, band, pose) {
  const out = [];

  if (pose.redrawn) {
    out.push({
      severity: 'redrawn',
      text:
        `the geometry was re-emitted, not posed: ${pose.shared} of ${pose.total} paths match the ` +
        `frame it came from, and no group carries a transform.\n` +
        `      Pose the source instead - one \`transform\` per assembly group, path data untouched. ` +
        `Everything below is a symptom of this and will settle once it is fixed.`,
    });
    // The travel numbers are measured against geometry that was never posed, so
    // reporting them as pose defects would send the next pass after a ghost.
    return out;
  }

  for (const [part, value] of [
    ['bob', Math.abs(step.bob)],
    ...['leg', 'arm', 'head', 'clothing']
      .filter((p) => step.parts[p] !== undefined)
      .map((p) => [p, step.parts[p]]),
  ]) {
    const span = band?.[part];
    if (!span) continue;
    if (value > span.high) {
      out.push({
        severity: 'over',
        text:
          `${part} travelled ${value.toFixed(1)}%, past the ${span.high}% a drawn frame reaches. ` +
          `Scale that rotation back toward ${span.typical}%.`,
      });
    } else if (value < span.low) {
      out.push({
        severity: 'under',
        text:
          `${part} travelled ${value.toFixed(1)}%, short of the ${span.low}% a drawn frame moves. ` +
          `A part that barely moves reads as pinned; aim for ${span.typical}%.`,
      });
    }
  }

  if (step.layersFrozen.length) {
    out.push({
      severity: 'frozen',
      text:
        `${step.layersFrozen.length} layer(s) never moved: ${step.layersFrozen.join(', ')}.\n` +
        `      A walk carries the whole figure. A torso held still while the legs swing is the ` +
        `pose that reads as a stretch rather than a stride.`,
    });
  }

  return out;
}

/**
 * The grade, and whether there is budget left to act on it.
 *
 * `passes` is the stop flag, and it is a flag rather than a suggestion: a run
 * that keeps revising is a run the app kills at five minutes with nothing
 * saved, and a decent frame on disk beats a perfect one that never arrives. On
 * the last pass the verdict says `save` rather than `revise` - the findings are
 * still printed, because what is wrong with the frame belongs in the reply.
 */
export function grade(step, band, pose, { pass = 1, passes = 2 } = {}) {
  const list = findings(step, band, pose);
  const clean = list.length === 0;
  const last = pass >= passes;
  return {
    findings: list,
    verdict: clean ? 'pass' : last ? 'save' : 'revise',
    pass,
    passes,
  };
}

/** The grade as the lines a caller reads. */
function gradeReport(result) {
  const lines = [];
  const { verdict, pass, passes, findings: list } = result;
  lines.push('');
  lines.push(`   GRADE  ${verdict}  (pass ${pass} of ${passes})`);
  if (list.length === 0) {
    lines.push('   Every part moved, and moved as far as a drawn frame does. Save it.');
  } else {
    list.forEach((f, i) => lines.push(`   ${i + 1}. ${f.text}`));
    if (verdict === 'save') {
      lines.push(
        '   No passes left. Save the better of what you have and say in your reply what is',
        '   still wrong with it - an unreported defect is worse than a reported one.',
      );
    } else {
      lines.push('   Fix finding 1, render again, and grade again.');
    }
  }
  lines.push(`VERDICT: ${verdict}`);
  return lines.join('\n');
}

/**
 * A frame's layers with every group transform already resolved into the path
 * data, as markup the measuring code can read.
 *
 * A frame the helper has just posed carries its pose in `transform` attributes,
 * and the measuring in `illustrated-frames.mjs` reads path data alone - so
 * without this step a freshly posed frame measures as though nothing moved,
 * which is the one answer it must never give. The app bakes these transforms
 * when it imports a frame; this does the same thing a little earlier.
 */
function bakedFrameMarkup(inner, classes) {
  return childGroups(inner)
    .map((layer) => {
      const m = parseTransform(attr(layer.open, 'transform'));
      const paths = flattenPaths(layer.inner, m, () => {}, classes)
        .map((el) => `<path d="${el.d}"/>`)
        .join('');
      return `<g id="${layer.id}">${paths}</g>`;
    })
    .join('');
}

async function compare(fromFile, toFile, type) {
  const texts = {};
  const read = async (f) => {
    const text = await readFile(resolve(f), 'utf-8');
    texts[f] = text;
    const top = childGroups(text);
    // A saved frame is one root group wrapping the assemblies, and it is the
    // assemblies that have to be measured - so the frame's own inside is the
    // subject. A file holding several groups at the top is already that.
    const inner = top.length === 1 ? top[0].inner : text;
    return measureFrame(bakedFrameMarkup(inner, styleClasses(text)));
  };
  const a = await read(fromFile);
  const b = await read(toFile);
  if (!a || !b) return null;
  const step = measureStep(a, b);
  const all = await budgets();
  // The pose check reads the files as text rather than as measurements: what it
  // is looking for is whether the path data survived, and a measurement of the
  // drawing cannot tell you that.
  const pose = poseCheck(texts[toFile], texts[fromFile]);
  return { step, band: all?.[type] ?? null, pose };
}

// --------------------------------------------------------------------- cli

function parseArgs(argv) {
  const opts = { scale: 4 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--scale') opts.scale = Number(argv[++i]);
    else if (a === '--frame') opts.frame = argv[++i];
    else if (a === '--against') opts.against = argv[++i];
    else if (a === '--type') opts.type = argv[++i];
    else if (a === '--grade') opts.grade = true;
    else if (a === '--strict') { opts.grade = true; opts.strict = true; }
    else if (a === '--pass') opts.pass = Number(argv[++i]);
    else if (a === '--passes') opts.passes = Number(argv[++i]);
    else rest.push(a);
  }
  opts.file = rest[0];
  return opts;
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file) {
    console.error('frame-preview: name an SVG to render.');
    console.error('  npm run frame-preview -- <file.svg> [--out p.png] [--scale 4]');
    console.error('                          [--frame <id>] [--against <previous.svg>]');
    console.error('                          [--grade] [--strict] [--pass 1] [--passes 2]');
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(opts.scale) || opts.scale <= 0) opts.scale = 4;

  const { target, render, elements, sawArc } = await renderToPng(opts.file, opts);
  console.log(
    `frame-preview: ${elements} paths -> ${target} (${render.width}x${render.height} px)`,
  );
  if (sawArc) {
    console.log(
      'frame-preview: WARNING an elliptical arc was drawn as a straight line.' +
        '\n  The preview is wrong there; the saved frame is untouched.',
    );
  }

  if (opts.against) {
    const result = await compare(opts.against, opts.file, opts.type ?? 'walk');
    if (!result) {
      console.log('frame-preview: could not measure the two files against each other.');
      return;
    }
    console.log(`\n   movement from ${opts.against} to this frame, as a percent of figure height:`);
    console.log(verdict(result.step, result.band));
    const frozen = result.step.layersFrozen;
    if (frozen.length) {
      console.log(
        `\n   ${frozen.length} layer(s) did not move at all: ${frozen.join(', ')}.` +
          '\n   A part left at the same place in every frame was copied, not posed.',
      );
    }

    if (opts.grade) {
      const graded = grade(result.step, result.band, result.pose, {
        pass: Number.isFinite(opts.pass) ? opts.pass : 1,
        passes: Number.isFinite(opts.passes) ? opts.passes : 2,
      });
      console.log(gradeReport(graded));
      // `--strict` is for a caller that branches on the exit code. On its own,
      // `--grade` stays quiet in that channel: a non-zero exit from a preview
      // reads as "the tool broke" to whatever is watching, and the tool did
      // not - the frame did.
      if (opts.strict && graded.verdict !== 'pass') process.exitCode = 2;
    }
  }
}

/** Only run the CLI when this file is the entry point, not when imported. */
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const selfPath = selfUrl ? resolve(fileURLToPath(selfUrl)) : '';
const sameFile =
  selfPath !== '' &&
  (process.platform === 'win32'
    ? invokedPath.toLowerCase() === selfPath.toLowerCase()
    : invokedPath === selfPath);
if (sameFile) {
  run().catch((err) => {
    console.error(`frame-preview: ${err.message}`);
    process.exit(1);
  });
}
