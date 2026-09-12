/**
 * matlib-script.js - a dependency-free Bezier curve library and command line
 * tool for the `vector-graphics` skill.
 *
 * It turns a list of control points of any degree into evaluated points, a
 * parametric polynomial equation, an SVG path `d` string, or a complete SVG
 * document, so a curve can be derived from its formula rather than dragged
 * into place by hand.
 *
 * Run it:
 *
 *   node matlib-script.js --points "0,0 1,3 2,-2 3,0" --equation --svg --poly
 *   node matlib-script.js --points "0,1 1,2 2,0" --through --path
 *   node matlib-script.js --circle "50,50,40" --svg
 *   node matlib-script.js --help
 *
 * Reuse it: the file uses no imports, so it loads under both CommonJS and ESM
 * projects. From CommonJS, `require('./matlib-script.js')` returns the
 * function table below. From ESM, reach it with `createRequire`.
 *
 * Conventions: the parameter is `t` on [0, 1]. Points are `[x, y]` pairs.
 * Nothing here mutates its arguments.
 */

'use strict';

/* ------------------------------------------------------------------ *
 * Core evaluation
 * ------------------------------------------------------------------ */

/** Linear interpolation between two points. The base case of every degree. */
function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * De Casteljau's algorithm: evaluates the curve at `t` by repeated linear
 * interpolation, and returns the split halves as a by-product.
 *
 * @param {number[][]} points control points, lowest index first
 * @param {number} t parameter on [0, 1]
 * @returns {{point: number[], left: number[][], right: number[][]}}
 */
function deCasteljau(points, t) {
  if (!points.length) throw new Error('deCasteljau: no control points');
  let level = points.map((p) => [p[0], p[1]]);
  const left = [level[0]];
  const right = [level[level.length - 1]];

  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length - 1; i++) next.push(lerp(level[i], level[i + 1], t));
    level = next;
    left.push(level[0]);
    right.unshift(level[level.length - 1]);
  }

  return { point: level[0], left, right };
}

/** The point on the curve at `t`. */
function pointAt(points, t) {
  return deCasteljau(points, t).point;
}

/**
 * Splits the curve at `t` into two curves of the same degree that together
 * trace the original exactly.
 */
function split(points, t) {
  const { left, right } = deCasteljau(points, t);
  return { left, right };
}

/**
 * The hodograph: the control points of the derivative curve, which is one
 * degree lower. Evaluating it gives the tangent vector.
 */
function derivativePoints(points) {
  const n = points.length - 1;
  if (n < 1) return [[0, 0]];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push([n * (points[i + 1][0] - points[i][0]), n * (points[i + 1][1] - points[i][1])]);
  }
  return out;
}

/** The tangent vector at `t` (not normalized). */
function tangentAt(points, t) {
  return pointAt(derivativePoints(points), t);
}

/** The unit normal at `t`, rotated 90 degrees from the tangent. */
function normalAt(points, t) {
  const [dx, dy] = tangentAt(points, t);
  const len = Math.hypot(dx, dy);
  if (!len) return [0, 0];
  return [-dy / len, dx / len];
}

/** Raises the curve one degree without changing its shape. */
function elevate(points) {
  const n = points.length - 1;
  const out = [points[0]];
  for (let i = 1; i <= n; i++) {
    const w = i / (n + 1);
    out.push([
      points[i - 1][0] * w + points[i][0] * (1 - w),
      points[i - 1][1] * w + points[i][1] * (1 - w),
    ]);
  }
  out.push(points[n]);
  return out;
}

/* ------------------------------------------------------------------ *
 * Polynomial form
 * ------------------------------------------------------------------ */

function factorial(n) {
  let out = 1;
  for (let i = 2; i <= n; i++) out *= i;
  return out;
}

/** Binomial coefficient C(n, i). */
function binomial(n, i) {
  return factorial(n) / (factorial(i) * factorial(n - i));
}

/** The Bernstein basis polynomial B(i, n) evaluated at `t`. */
function bernstein(i, n, t) {
  return binomial(n, i) * Math.pow(t, i) * Math.pow(1 - t, n - i);
}

/**
 * Converts control points into power-basis coefficients, one array per axis,
 * ordered from the constant term upward:
 *
 *   c[j] = (n! / (n-j)!) * sum(i = 0..j) of (-1)^(i+j) * P[i] / (i! * (j-i)!)
 *
 * For the four points [0,0] [1,3] [2,-2] [3,0] this yields x = 3t and
 * y = 9t - 24t^2 + 15t^3, matching the textbook derivation.
 */
function coefficients(points) {
  const n = points.length - 1;
  const cx = [];
  const cy = [];

  for (let j = 0; j <= n; j++) {
    const scale = factorial(n) / factorial(n - j);
    let sx = 0;
    let sy = 0;
    for (let i = 0; i <= j; i++) {
      const term = Math.pow(-1, i + j) / (factorial(i) * factorial(j - i));
      sx += term * points[i][0];
      sy += term * points[i][1];
    }
    cx.push(scale * sx);
    cy.push(scale * sy);
  }

  return { x: cx, y: cy };
}

/** Formats one axis of coefficients as a readable polynomial in `param`. */
function polynomialString(coeffs, param, precision) {
  const parts = [];
  for (let j = coeffs.length - 1; j >= 0; j--) {
    const c = round(coeffs[j], precision);
    if (c === 0) continue;
    const joining = parts.length > 0;
    const sign = c < 0 ? (joining ? '- ' : '-') : joining ? '+ ' : '';
    const mag = Math.abs(c);
    const showMag = mag !== 1 || j === 0;
    const power = j === 0 ? '' : j === 1 ? param : `${param}^${j}`;
    parts.push(`${sign}${showMag ? mag : ''}${power}`);
  }
  return parts.length ? parts.join(' ') : '0';
}

/** Both axes as `x = ..., y = ...` parametric equations. */
function equation(points, param, precision) {
  const c = coefficients(points);
  return {
    x: polynomialString(c.x, param, precision),
    y: polynomialString(c.y, param, precision),
  };
}

/* ------------------------------------------------------------------ *
 * Fitting and construction
 * ------------------------------------------------------------------ */

/**
 * Converts points that lie ON the curve into the control points that draw it.
 *
 * - 2 points: the segment itself.
 * - 3 points: the middle one is taken at t = 1/2.
 * - 4 points: the middle two are taken at t = 1/3 and t = 2/3.
 */
function throughPoints(points) {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);

  if (points.length === 3) {
    const [p0, q, p2] = points;
    return [
      [p0[0], p0[1]],
      [2 * q[0] - (p0[0] + p2[0]) / 2, 2 * q[1] - (p0[1] + p2[1]) / 2],
      [p2[0], p2[1]],
    ];
  }

  if (points.length === 4) {
    const [p0, q1, q2, p3] = points;
    const c1 = (a, b, c, d) => (-5 * a + 18 * b - 9 * c + 2 * d) / 6;
    const c2 = (a, b, c, d) => (2 * a - 9 * b + 18 * c - 5 * d) / 6;
    return [
      [p0[0], p0[1]],
      [c1(p0[0], q1[0], q2[0], p3[0]), c1(p0[1], q1[1], q2[1], p3[1])],
      [c2(p0[0], q1[0], q2[0], p3[0]), c2(p0[1], q1[1], q2[1], p3[1])],
      [p3[0], p3[1]],
    ];
  }

  throw new Error('throughPoints: supports 2, 3, or 4 on-curve points');
}

/**
 * The four-cubic approximation of a circle. No Bezier of finite degree is a
 * true circle; handles of length k*r with k = 4/3 * (sqrt(2) - 1) land within
 * about 0.02 percent of the radius, which is below one device pixel at any
 * ordinary size.
 */
const KAPPA = (4 / 3) * (Math.SQRT2 - 1);

function circle(cx, cy, r) {
  const k = KAPPA * r;
  return [
    [[cx, cy - r], [cx + k, cy - r], [cx + r, cy - k], [cx + r, cy]],
    [[cx + r, cy], [cx + r, cy + k], [cx + k, cy + r], [cx, cy + r]],
    [[cx, cy + r], [cx - k, cy + r], [cx - r, cy + k], [cx - r, cy]],
    [[cx - r, cy], [cx - r, cy - k], [cx - k, cy - r], [cx, cy - r]],
  ];
}

/* ------------------------------------------------------------------ *
 * Sampling and measurement
 * ------------------------------------------------------------------ */

/** `count` points along the curve, evenly spaced in `t` (not in distance). */
function sample(points, count) {
  const out = [];
  const steps = Math.max(1, count - 1);
  for (let i = 0; i < count; i++) out.push(pointAt(points, i / steps));
  return out;
}

/**
 * Approximate arc length, by summing a dense chord walk. Equal steps in `t`
 * are not equal steps in distance, so anything that needs even spacing has to
 * go through a length table like this one.
 */
function length(points, steps) {
  const n = Math.max(2, steps || 200);
  let total = 0;
  let prev = pointAt(points, 0);
  for (let i = 1; i <= n; i++) {
    const next = pointAt(points, i / n);
    total += Math.hypot(next[0] - prev[0], next[1] - prev[1]);
    prev = next;
  }
  return total;
}

/**
 * Bounding box of the drawn curve, from a dense sample. The control polygon's
 * box is always at least as large (the convex hull property), so use this one
 * when the box has to be tight.
 */
function bounds(points, steps) {
  const pts = sample(points, Math.max(2, steps || 256));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/* ------------------------------------------------------------------ *
 * SVG output
 * ------------------------------------------------------------------ */

/** Rounds to `precision` decimals and drops the trailing zeros. */
function round(value, precision) {
  const p = precision == null ? 3 : precision;
  const factor = Math.pow(10, p);
  const out = Math.round(value * factor) / factor;
  return Object.is(out, -0) ? 0 : out;
}

function fmt(value, precision) {
  return String(round(value, precision));
}

/**
 * The SVG `d` string for one curve. Degree picks the command: `L` for a
 * straight segment, `Q` for one handle, `C` for two. Degree 4 and above has
 * no SVG command, so the curve is subdivided into cubics that follow it
 * within `tolerance`.
 */
function toPathData(points, options) {
  const opts = options || {};
  const precision = opts.precision;
  const n = points.length - 1;
  const p = (pt) => `${fmt(pt[0], precision)} ${fmt(pt[1], precision)}`;
  const head = `M ${p(points[0])}`;

  if (n === 1) return `${head} L ${p(points[1])}`;
  if (n === 2) return `${head} Q ${p(points[1])} ${p(points[2])}`;
  if (n === 3) return `${head} C ${p(points[1])} ${p(points[2])} ${p(points[3])}`;

  const pieces = toCubics(points, opts.tolerance);
  const tail = pieces
    .map((c) => `C ${p(c[1])} ${p(c[2])} ${p(c[3])}`)
    .join(' ');
  return `${head} ${tail}`;
}

/**
 * Reduces a curve of degree 4 or higher to a chain of cubics by halving until
 * each piece is flat enough that its cubic stand-in is within `tolerance`.
 */
function toCubics(points, tolerance) {
  const tol = tolerance == null ? 0.1 : tolerance;
  if (points.length - 1 <= 3) return [padToCubic(points)];

  const out = [];
  const walk = (curve, depth) => {
    if (depth > 16 || flatness(curve) <= tol) {
      const ends = { start: curve[0], end: curve[curve.length - 1] };
      const t1 = pointAt(curve, 1 / 3);
      const t2 = pointAt(curve, 2 / 3);
      out.push(throughPoints([ends.start, t1, t2, ends.end]));
      return;
    }
    const halves = split(curve, 0.5);
    walk(halves.left, depth + 1);
    walk(halves.right, depth + 1);
  };
  walk(points, 0);
  return out;
}

/** Widens a curve of degree below 3 into an equivalent cubic. */
function padToCubic(points) {
  let curve = points.map((p) => [p[0], p[1]]);
  while (curve.length < 4) curve = elevate(curve);
  return curve;
}

/** How far the control points stray from the chord: the flatness measure. */
function flatness(points) {
  const [x0, y0] = points[0];
  const [x1, y1] = points[points.length - 1];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  let worst = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d = len
      ? Math.abs(dy * px - dx * py + x1 * y0 - y1 * x0) / len
      : Math.hypot(px - x0, py - y0);
    if (d > worst) worst = d;
  }
  return worst;
}

/** The `d` string for the control polygon, drawn as straight segments. */
function polygonPathData(points, precision) {
  return points
    .map((pt, i) => `${i ? 'L' : 'M'} ${fmt(pt[0], precision)} ${fmt(pt[1], precision)}`)
    .join(' ');
}

/**
 * A complete, self-contained SVG document around one or more curves.
 *
 * @param {number[][][]} curves one array of control points per curve
 * @param {object} [options] pad, precision, stroke, strokeWidth, fill, polygon, flipY
 */
function toSvg(curves, options) {
  const opts = options || {};
  const precision = opts.precision;
  const pad = opts.pad == null ? 8 : opts.pad;
  const stroke = opts.stroke || 'currentColor';
  const strokeWidth = opts.strokeWidth == null ? 1 : opts.strokeWidth;
  const fill = opts.fill || 'none';

  const boxes = curves.map((c) => bounds(opts.polygon ? [...c] : c));
  let minX = Math.min(...boxes.map((b) => b.minX));
  let minY = Math.min(...boxes.map((b) => b.minY));
  let maxX = Math.max(...boxes.map((b) => b.maxX));
  let maxY = Math.max(...boxes.map((b) => b.maxY));

  if (opts.polygon) {
    for (const curve of curves) {
      for (const [x, y] of curve) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  const width = Math.max(maxX - minX + pad * 2, 1);
  const height = Math.max(maxY - minY + pad * 2, 1);
  const viewBox = [minX - pad, minY - pad, width, height]
    .map((v) => fmt(v, precision))
    .join(' ');

  const body = [];

  if (opts.polygon) {
    for (const curve of curves) {
      body.push(
        `  <path d="${polygonPathData(curve, precision)}" fill="none" ` +
          `stroke="${stroke}" stroke-width="${round(strokeWidth * 0.5, 3)}" ` +
          `stroke-dasharray="4 3" opacity="0.45" />`
      );
      for (const [x, y] of curve) {
        body.push(
          `  <circle cx="${fmt(x, precision)}" cy="${fmt(y, precision)}" ` +
            `r="${round(strokeWidth * 1.5, 3)}" fill="${stroke}" opacity="0.65" />`
        );
      }
    }
  }

  for (const curve of curves) {
    body.push(
      `  <path d="${toPathData(curve, { precision })}" fill="${fill}" ` +
        `stroke="${stroke}" stroke-width="${strokeWidth}" ` +
        `stroke-linecap="round" stroke-linejoin="round" />`
    );
  }

  const inner = opts.flipY
    ? [`  <g transform="translate(0 ${fmt(minY + maxY, precision)}) scale(1 -1)">`]
        .concat(body.map((line) => `  ${line}`), ['  </g>'])
    : body;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ` +
      `width="${fmt(width, precision)}" height="${fmt(height, precision)}">`,
    ...inner,
    '</svg>',
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * Command line
 * ------------------------------------------------------------------ */

const USAGE = `matlib-script.js - Bezier curves from their formulas

Usage:
  node matlib-script.js --points "<x,y x,y ...>" [options]
  node matlib-script.js --circle "<cx,cy,r>" [options]

Input:
  --points "0,0 1,3 2,-2 3,0"  control points, any degree (space or ; separated)
  --through                    read the points as lying ON the curve and solve
                               for the control points (2, 3, or 4 points)
  --circle "50,50,40"          four-cubic circle approximation at cx,cy,r
  --elevate                    raise the degree by one without changing shape

Output (default prints a summary):
  --path                       print only the SVG path d string
  --svg                        print a complete SVG document
  --poly                       include the control polygon and its points
  --equation                   print the parametric polynomial equations
  --at <t>                     print the point, tangent, and normal at t
  --split <t>                  print the control points of both halves
  --samples <n>                print n points sampled evenly in t

Style:
  --stroke <color>             stroke color (default currentColor)
  --stroke-width <n>           stroke width (default 1)
  --fill <color>               fill (default none)
  --pad <n>                    padding around the viewBox (default 8)
  --flip-y                     flip the y axis, for math-space coordinates
  --precision <n>              decimals in the output (default 3)
  --param <name>               parameter letter in equations (default t)

Examples:
  node matlib-script.js --points "0,1 1,3.5 2,0" --equation --path
  node matlib-script.js --points "0,1 1,2 2,0" --through --path
  node matlib-script.js --points "0,0 1,3 2,-2 3,0" --svg --poly > curve.svg
  node matlib-script.js --circle "50,50,40" --svg > circle.svg
`;

function parsePoints(text) {
  const pairs = String(text)
    .split(/[;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const points = pairs.map((pair) => {
    const parts = pair.split(',').map((n) => Number(n));
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`bad point "${pair}" - expected the form x,y`);
    }
    return parts;
  });

  if (points.length < 2) throw new Error('need at least 2 points');
  return points;
}

function parseArgs(argv) {
  const flags = {
    precision: 3,
    pad: 8,
    strokeWidth: 1,
    param: 't',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };

    switch (arg) {
      case '--help':
      case '-h': flags.help = true; break;
      case '--points': flags.points = next(); break;
      case '--circle': flags.circle = next(); break;
      case '--through': flags.through = true; break;
      case '--elevate': flags.elevate = true; break;
      case '--path': flags.path = true; break;
      case '--svg': flags.svg = true; break;
      case '--poly': flags.poly = true; break;
      case '--equation': flags.equation = true; break;
      case '--at': flags.at = Number(next()); break;
      case '--split': flags.split = Number(next()); break;
      case '--samples': flags.samples = Number(next()); break;
      case '--stroke': flags.stroke = next(); break;
      case '--stroke-width': flags.strokeWidth = Number(next()); break;
      case '--fill': flags.fill = next(); break;
      case '--pad': flags.pad = Number(next()); break;
      case '--flip-y': flags.flipY = true; break;
      case '--precision': flags.precision = Number(next()); break;
      case '--param': flags.param = next(); break;
      default:
        if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
        flags.points = flags.points ? `${flags.points} ${arg}` : arg;
    }
  }

  return flags;
}

const DEGREE_NAMES = ['point', 'linear', 'quadratic', 'cubic', 'quartic', 'quintic'];

function describe(points) {
  const n = points.length - 1;
  return `${DEGREE_NAMES[n] || `degree ${n}`} (${points.length} control points)`;
}

function main(argv) {
  const flags = parseArgs(argv);

  if (flags.help || (!flags.points && !flags.circle)) {
    process.stdout.write(USAGE);
    return 0;
  }

  let curves;
  if (flags.circle) {
    const [cx, cy, r] = String(flags.circle).split(',').map(Number);
    if (![cx, cy, r].every(Number.isFinite)) throw new Error('--circle needs cx,cy,r');
    curves = circle(cx, cy, r);
  } else {
    let points = parsePoints(flags.points);
    if (flags.through) points = throughPoints(points);
    if (flags.elevate) points = elevate(points);
    curves = [points];
  }

  const svgOptions = {
    precision: flags.precision,
    pad: flags.pad,
    stroke: flags.stroke,
    strokeWidth: flags.strokeWidth,
    fill: flags.fill,
    polygon: flags.poly,
    flipY: flags.flipY,
  };

  if (flags.svg) {
    process.stdout.write(toSvg(curves, svgOptions));
    return 0;
  }

  const lines = [];
  const pathLines = curves.map((c) => toPathData(c, { precision: flags.precision }));

  if (flags.path) {
    process.stdout.write(`${pathLines.join('\n')}\n`);
    return 0;
  }

  for (const points of curves) {
    if (curves.length > 1) lines.push('');
    lines.push(describe(points));
    lines.push(
      `  control points: ${points
        .map((p) => `[${fmt(p[0], flags.precision)}, ${fmt(p[1], flags.precision)}]`)
        .join(' ')}`
    );

    if (flags.equation) {
      const eq = equation(points, flags.param, flags.precision);
      lines.push(`  x(${flags.param}) = ${eq.x}`);
      lines.push(`  y(${flags.param}) = ${eq.y}`);
    }

    lines.push(`  path: ${toPathData(points, { precision: flags.precision })}`);
    if (flags.poly) {
      lines.push(`  polygon: ${polygonPathData(points, flags.precision)}`);
    }

    const box = bounds(points);
    lines.push(
      `  bounds: ${fmt(box.minX, flags.precision)} ${fmt(box.minY, flags.precision)} ` +
        `${fmt(box.width, flags.precision)} ${fmt(box.height, flags.precision)}`
    );
    lines.push(`  length: ${fmt(length(points), flags.precision)} (approximate)`);

    if (Number.isFinite(flags.at)) {
      const t = flags.at;
      const pt = pointAt(points, t);
      const tan = tangentAt(points, t);
      const nor = normalAt(points, t);
      lines.push(
        `  at ${flags.param}=${t}: point [${fmt(pt[0], flags.precision)}, ${fmt(pt[1], flags.precision)}]` +
          ` tangent [${fmt(tan[0], flags.precision)}, ${fmt(tan[1], flags.precision)}]` +
          ` normal [${fmt(nor[0], flags.precision)}, ${fmt(nor[1], flags.precision)}]`
      );
    }

    if (Number.isFinite(flags.split)) {
      const halves = split(points, flags.split);
      const show = (c) =>
        c.map((p) => `[${fmt(p[0], flags.precision)}, ${fmt(p[1], flags.precision)}]`).join(' ');
      lines.push(`  split ${flags.param}=${flags.split} left:  ${show(halves.left)}`);
      lines.push(`  split ${flags.param}=${flags.split} right: ${show(halves.right)}`);
    }

    if (Number.isFinite(flags.samples) && flags.samples > 1) {
      lines.push(`  samples (${flags.samples}, even in ${flags.param}, not in distance):`);
      for (const [x, y] of sample(points, flags.samples)) {
        lines.push(`    [${fmt(x, flags.precision)}, ${fmt(y, flags.precision)}]`);
      }
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

/* ------------------------------------------------------------------ *
 * Entry point and exports
 * ------------------------------------------------------------------ */

const API = {
  KAPPA,
  bernstein,
  binomial,
  bounds,
  circle,
  coefficients,
  deCasteljau,
  derivativePoints,
  elevate,
  equation,
  flatness,
  length,
  lerp,
  normalAt,
  pointAt,
  polygonPathData,
  polynomialString,
  round,
  sample,
  split,
  tangentAt,
  toCubics,
  toPathData,
  toSvg,
  throughPoints,
};

// Works whether the host project is CommonJS or ESM: `module` is simply
// undefined under an ESM loader, and the argv check does not depend on it.
if (typeof module !== 'undefined' && module.exports) module.exports = API;

const invoked = String(process.argv[1] || '').replace(/\\/g, '/');
if (/\/matlib-script\.js$/.test(invoked)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`matlib-script: ${err.message}\n`);
    process.exitCode = 1;
  }
}
