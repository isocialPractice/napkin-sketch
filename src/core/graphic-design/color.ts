/**
 * CSS color parsing for the graphic-design renderers.
 *
 * The SVG writer passes colors through untouched - a browser is a better CSS
 * parser than anything written here. The rasterizer cannot, because it has to
 * put numbers in a framebuffer, so this module turns the subset of CSS that a
 * composition realistically names into straight (non-premultiplied) RGBA bytes:
 * hex in three, four, six and eight digits, `rgb()`/`rgba()`, `hsl()`/`hsla()`,
 * `transparent`, and the sixteen HTML color keywords plus the handful of greys
 * that come up constantly in design work.
 *
 * An unrecognised color raises rather than silently painting black: a
 * composition that misspells a swatch should fail where the swatch is written,
 * not ship a graphic with one wrong rectangle in it.
 */

/** Straight (non-premultiplied) RGBA, each component 0-255. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Fully transparent black - what `none` and `transparent` resolve to. */
export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/**
 * Every CSS named color, with the two keywords that mean no paint. The full
 * list rather than a common subset, because a composition that names
 * `steelblue` writes a valid SVG either way, and the PNG has to agree with it.
 */
const KEYWORDS: Record<string, string> = {
  transparent: '#00000000',
  none: '#00000000',
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  black: '#000000',
  blanchedalmond: '#ffebcd',
  blue: '#0000ff',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkgrey: '#a9a9a9',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  gray: '#808080',
  green: '#008000',
  greenyellow: '#adff2f',
  grey: '#808080',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgreen: '#90ee90',
  lightgrey: '#d3d3d3',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  magenta: '#ff00ff',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  rebeccapurple: '#663399',
  red: '#ff0000',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  yellow: '#ffff00',
  yellowgreen: '#9acd32',
};

/** Every color name {@link parseColor} reads, for suggestions and documentation. */
export const COLOR_NAMES: readonly string[] = Object.keys(KEYWORDS).filter((name) => name !== 'none');

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Reads one `rgb()`/`hsl()` component, honouring a trailing percent sign. */
function component(token: string, scale: number): number {
  const t = token.trim();
  if (t.endsWith('%')) return (parseFloat(t) / 100) * scale;
  return parseFloat(t);
}

/** Converts an HSL triple (h in degrees, s and l in 0-1) to RGB bytes. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s <= 0) {
    const v = clampByte(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [
    clampByte(channel(hue + 1 / 3) * 255),
    clampByte(channel(hue) * 255),
    clampByte(channel(hue - 1 / 3) * 255),
  ];
}

/**
 * Parses a CSS color into RGBA bytes.
 *
 * @throws if the color is not one of the supported forms.
 */
export function parseColor(input: string): Rgba {
  const raw = String(input).trim().toLowerCase();
  const value = KEYWORDS[raw] ?? raw;

  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    const h = hex[1];
    const expand = (c: string): number => parseInt(c + c, 16);
    if (h.length === 3 || h.length === 4) {
      return {
        r: expand(h[0]),
        g: expand(h[1]),
        b: expand(h[2]),
        a: h.length === 4 ? expand(h[3]) / 255 : 1,
      };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
  }

  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(value);
  if (fn) {
    // Both the legacy comma form and the modern space form, with an optional
    // slash before the alpha, reduce to the same list of numbers.
    const parts = fn[2]
      .replace(/\//g, ' ')
      .split(/[\s,]+/)
      .filter((p) => p.length > 0);
    if (parts.length >= 3) {
      const alpha = parts.length > 3 ? clamp01(component(parts[3], 1)) : 1;
      if (fn[1].startsWith('rgb')) {
        return {
          r: clampByte(component(parts[0], 255)),
          g: clampByte(component(parts[1], 255)),
          b: clampByte(component(parts[2], 255)),
          a: alpha,
        };
      }
      const [r, g, b] = hslToRgb(
        parseFloat(parts[0]),
        clamp01(component(parts[1], 1)),
        clamp01(component(parts[2], 1)),
      );
      return { r, g, b, a: alpha };
    }
  }

  throw new Error(`graphic-design: unsupported color "${input}"`);
}

/** Parses a color, returning `null` for the paints that mean "do not paint". */
export function parsePaint(input: string | null | undefined): Rgba | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim().toLowerCase();
  if (raw === '' || raw === 'none' || raw === 'transparent') return null;
  const rgba = parseColor(raw);
  return rgba.a <= 0 ? null : rgba;
}

/** Formats RGBA back to the shortest CSS form that carries it exactly. */
export function formatColor({ r, g, b, a }: Rgba): string {
  const hex = (n: number): string => clampByte(n).toString(16).padStart(2, '0');
  const base = `#${hex(r)}${hex(g)}${hex(b)}`;
  return a >= 1 ? base : `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${Number(a.toFixed(3))})`;
}
