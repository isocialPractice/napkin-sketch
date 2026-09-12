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

const KEYWORDS: Record<string, string> = {
  transparent: '#00000000',
  none: '#00000000',
  black: '#000000',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  white: '#ffffff',
  maroon: '#800000',
  red: '#ff0000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  green: '#008000',
  lime: '#00ff00',
  olive: '#808000',
  yellow: '#ffff00',
  navy: '#000080',
  blue: '#0000ff',
  teal: '#008080',
  aqua: '#00ffff',
  cyan: '#00ffff',
  orange: '#ffa500',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gold: '#ffd700',
  beige: '#f5f5dc',
  ivory: '#fffff0',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  whitesmoke: '#f5f5f5',
  gainsboro: '#dcdcdc',
  crimson: '#dc143c',
  coral: '#ff7f50',
  salmon: '#fa8072',
  khaki: '#f0e68c',
  indigo: '#4b0082',
  violet: '#ee82ee',
  turquoise: '#40e0d0',
  tan: '#d2b48c',
};

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
