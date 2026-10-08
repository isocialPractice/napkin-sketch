/**
 * Napkin Blends: the sixteen blend modes of Illustrator's Transparency panel,
 * under napkin names.
 *
 * A blend mode decides how a layer's colors mix with what is already painted
 * under it. The math is the W3C's Compositing and Blending Level 1, which
 * Illustrator, Photoshop, CSS `mix-blend-mode`, SVG, PDF's `/BM` and the
 * canvas's `globalCompositeOperation` all implement, so one table names a
 * mode for every output and one function mixes it for the outputs that have
 * no blending of their own (the headless rasterizer).
 *
 * The napkin name is what a person reads; the Illustrator name is shown beside
 * it, and either is accepted wherever a mode is read - a file, a script, an
 * SVG's `mix-blend-mode`.
 *
 * Nothing here touches the DOM.
 */

/** Where a mode sits in Illustrator's list, which the menus and the select follow. */
export type BlendFamily = 'normal' | 'darken' | 'lighten' | 'contrast' | 'comparative' | 'component';

/** One blend mode: its napkin id and name, and what every output calls it. */
export interface BlendMode {
  /** The napkin id: what a file, a script and the code use. */
  id: string;
  /** What a person reads: "Stack Blend". */
  label: string;
  /** Illustrator's name for it, shown beside the label. */
  illustrator: string;
  /** CSS `mix-blend-mode` and canvas `globalCompositeOperation` (`source-over` for normal). */
  css: string;
  /** PDF's `/BM` name. */
  pdf: string;
  /** Illustrator's `BlendModes` member. */
  jsx: string;
  family: BlendFamily;
}

/**
 * Every mode, in Illustrator's order: Normal, then the modes that darken, that
 * lighten, that add contrast, that compare, and that mix one component of a
 * color with the others of what is under it.
 */
export const BLEND_MODES = [
  { id: 'normal', label: 'Normal', illustrator: 'Normal', css: 'normal', pdf: 'Normal', jsx: 'NORMAL', family: 'normal' },
  { id: 'soak', label: 'Soak Blend', illustrator: 'Darken', css: 'darken', pdf: 'Darken', jsx: 'DARKEN', family: 'darken' },
  { id: 'stack', label: 'Stack Blend', illustrator: 'Multiply', css: 'multiply', pdf: 'Multiply', jsx: 'MULTIPLY', family: 'darken' },
  { id: 'scorch', label: 'Scorch Blend', illustrator: 'Color Burn', css: 'color-burn', pdf: 'ColorBurn', jsx: 'COLORBURN', family: 'darken' },
  { id: 'dry', label: 'Dry Blend', illustrator: 'Lighten', css: 'lighten', pdf: 'Lighten', jsx: 'LIGHTEN', family: 'lighten' },
  { id: 'sheer', label: 'Sheer Blend', illustrator: 'Screen', css: 'screen', pdf: 'Screen', jsx: 'SCREEN', family: 'lighten' },
  { id: 'bleach', label: 'Bleach Blend', illustrator: 'Color Dodge', css: 'color-dodge', pdf: 'ColorDodge', jsx: 'COLORDODGE', family: 'lighten' },
  { id: 'fold', label: 'Fold Blend', illustrator: 'Overlay', css: 'overlay', pdf: 'Overlay', jsx: 'OVERLAY', family: 'contrast' },
  { id: 'light', label: 'Light Blend', illustrator: 'Soft Light', css: 'soft-light', pdf: 'SoftLight', jsx: 'SOFTLIGHT', family: 'contrast' },
  { id: 'heavy', label: 'Heavy Blend', illustrator: 'Hard Light', css: 'hard-light', pdf: 'HardLight', jsx: 'HARDLIGHT', family: 'contrast' },
  { id: 'messy', label: 'Messy Blend', illustrator: 'Difference', css: 'difference', pdf: 'Difference', jsx: 'DIFFERENCE', family: 'comparative' },
  { id: 'avoidance', label: 'Avoidance Blend', illustrator: 'Exclusion', css: 'exclusion', pdf: 'Exclusion', jsx: 'EXCLUSION', family: 'comparative' },
  { id: 'tidy', label: 'Tidy Blend', illustrator: 'Hue', css: 'hue', pdf: 'Hue', jsx: 'HUE', family: 'component' },
  { id: 'bright', label: 'Bright Blend', illustrator: 'Saturation', css: 'saturation', pdf: 'Saturation', jsx: 'SATURATIONBLEND', family: 'component' },
  { id: 'dye', label: 'Dye Blend', illustrator: 'Color', css: 'color', pdf: 'Color', jsx: 'COLORBLEND', family: 'component' },
  { id: 'cover', label: 'Cover Blend', illustrator: 'Luminosity', css: 'luminosity', pdf: 'Luminosity', jsx: 'LUMINOSITY', family: 'component' },
] as const satisfies readonly BlendMode[];

/** A blend mode's napkin id. */
export type BlendModeId = (typeof BLEND_MODES)[number]['id'];

/** The ids, in Illustrator's order. */
export const BLEND_MODE_IDS: readonly BlendModeId[] = BLEND_MODES.map((mode) => mode.id);

/**
 * Every name a script may write a mode by: the napkin ids, then the CSS names
 * Illustrator's modes go by - `multiply`, `color-burn` - for the ones whose
 * name is not its id.
 */
export const BLEND_MODE_NAMES: readonly string[] = [
  ...BLEND_MODE_IDS,
  ...BLEND_MODES.map((mode) => mode.css).filter((css) => !(BLEND_MODE_IDS as readonly string[]).includes(css)),
];

const BY_ID = new Map<string, BlendMode>(BLEND_MODES.map((mode) => [mode.id, mode]));

/** Every name a mode answers to, folded: its id, its label, Illustrator's name, CSS's and PDF's. */
const BY_NAME = new Map<string, BlendModeId>();
const fold = (name: string): string => name.toLowerCase().replace(/[\s_-]+/g, '');
for (const mode of BLEND_MODES) {
  for (const name of [mode.id, mode.label, mode.illustrator, mode.css, mode.pdf]) BY_NAME.set(fold(name), mode.id);
}
// The canvas spells Normal its own way.
BY_NAME.set(fold('source-over'), 'normal');

/**
 * The mode a value names, by any of its names - `stack`, `Stack Blend`,
 * `Multiply`, `multiply`, `ColorBurn`, `color-burn` - in any case; undefined
 * when it names none.
 */
export function blendModeOf(value: unknown): BlendModeId | undefined {
  return typeof value === 'string' ? BY_NAME.get(fold(value)) : undefined;
}

/** A mode's row of {@link BLEND_MODES}. */
export function blendModeInfo(id: BlendModeId): BlendMode {
  return BY_ID.get(id) ?? BLEND_MODES[0];
}

/** Whether a layer's blend mixes at all: anything but Normal, or none. */
export function isBlended(id: BlendModeId | undefined): id is Exclude<BlendModeId, 'normal'> {
  return id !== undefined && id !== 'normal';
}

/** The canvas's `globalCompositeOperation` for a mode. */
export function compositeOperation(id: BlendModeId | undefined): GlobalCompositeOperationName {
  return isBlended(id) ? (blendModeInfo(id).css as GlobalCompositeOperationName) : 'source-over';
}

/** The canvas's composite operations a blend uses, spelled out so this module needs no DOM types. */
export type GlobalCompositeOperationName =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

/** The modes the W3C mixes channel by channel. */
export type SeparableBlendModeId = Exclude<BlendModeId, 'tidy' | 'bright' | 'dye' | 'cover'>;

/** Whether a mode mixes each channel on its own. Hue, Saturation, Color and Luminosity mix the color as a whole. */
export function isSeparable(id: BlendModeId): id is SeparableBlendModeId {
  return id !== 'tidy' && id !== 'bright' && id !== 'dye' && id !== 'cover';
}

const screen = (cb: number, cs: number): number => cb + cs - cb * cs;
const hardLight = (cb: number, cs: number): number => (cs <= 0.5 ? cb * 2 * cs : screen(cb, 2 * cs - 1));

/**
 * B(Cb, Cs) for one channel of a separable mode: `cb` the backdrop's channel,
 * `cs` the source's, both 0 to 1 and not premultiplied.
 */
export function blendChannel(mode: SeparableBlendModeId, cb: number, cs: number): number {
  switch (mode) {
    case 'normal':
      return cs;
    case 'stack':
      return cb * cs;
    case 'sheer':
      return screen(cb, cs);
    case 'fold':
      return hardLight(cs, cb);
    case 'soak':
      return Math.min(cb, cs);
    case 'dry':
      return Math.max(cb, cs);
    case 'bleach':
      return cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs));
    case 'scorch':
      return cb >= 1 ? 1 : cs === 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs);
    case 'heavy':
      return hardLight(cb, cs);
    case 'light': {
      if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
      const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cb + (2 * cs - 1) * (d - cb);
    }
    case 'messy':
      return Math.abs(cb - cs);
    case 'avoidance':
      return cb + cs - 2 * cb * cs;
  }
}

/** An RGB color with channels from 0 to 1. */
export type Rgb = [number, number, number];

/** An RGBA color with channels and alpha from 0 to 1, not premultiplied. */
export type Rgba = [number, number, number, number];

const lum = (r: number, g: number, b: number): number => 0.3 * r + 0.59 * g + 0.11 * b;

/** SetLum with ClipColor: the color moved to luminosity `l`, its hue kept, pulled back into gamut. */
function setLum(r: number, g: number, b: number, l: number, out: Rgb): Rgb {
  const d = l - lum(r, g, b);
  let cr = r + d;
  let cg = g + d;
  let cb = b + d;
  const ll = lum(cr, cg, cb);
  const n = Math.min(cr, cg, cb);
  const x = Math.max(cr, cg, cb);
  if (n < 0) {
    const k = ll - n;
    cr = ll + ((cr - ll) * ll) / k;
    cg = ll + ((cg - ll) * ll) / k;
    cb = ll + ((cb - ll) * ll) / k;
  }
  if (x > 1) {
    const k = x - ll;
    cr = ll + ((cr - ll) * (1 - ll)) / k;
    cg = ll + ((cg - ll) * (1 - ll)) / k;
    cb = ll + ((cb - ll) * (1 - ll)) / k;
  }
  out[0] = cr;
  out[1] = cg;
  out[2] = cb;
  return out;
}

/** SetSat: the color given saturation `s` (max minus min), its hue kept. */
function setSat(r: number, g: number, b: number, s: number, out: Rgb): Rgb {
  const c: Rgb = [r, g, b];
  // The indices of the smallest, middle and largest channel.
  let lo = 0;
  let mid = 1;
  let hi = 2;
  if (c[lo] > c[mid]) [lo, mid] = [mid, lo];
  if (c[mid] > c[hi]) [mid, hi] = [hi, mid];
  if (c[lo] > c[mid]) [lo, mid] = [mid, lo];
  const span = c[hi] - c[lo];
  const middle = span > 0 ? ((c[mid] - c[lo]) * s) / span : 0;
  out[lo] = 0;
  out[mid] = middle;
  out[hi] = span > 0 ? s : 0;
  return out;
}

const sat = (r: number, g: number, b: number): number => Math.max(r, g, b) - Math.min(r, g, b);

/**
 * B(Cb, Cs) for any mode: the color a source mixes to over a backdrop,
 * channels 0 to 1 and not premultiplied. Written into `out` when one is given,
 * so a rasterizer's inner loop allocates nothing.
 */
export function blendColor(mode: BlendModeId, cb: Readonly<Rgb>, cs: Readonly<Rgb>, out: Rgb = [0, 0, 0]): Rgb {
  if (isSeparable(mode)) {
    out[0] = blendChannel(mode, cb[0], cs[0]);
    out[1] = blendChannel(mode, cb[1], cs[1]);
    out[2] = blendChannel(mode, cb[2], cs[2]);
    return out;
  }
  const tmp: Rgb = [0, 0, 0];
  switch (mode) {
    case 'tidy':
      setSat(cs[0], cs[1], cs[2], sat(cb[0], cb[1], cb[2]), tmp);
      return setLum(tmp[0], tmp[1], tmp[2], lum(cb[0], cb[1], cb[2]), out);
    case 'bright':
      setSat(cb[0], cb[1], cb[2], sat(cs[0], cs[1], cs[2]), tmp);
      return setLum(tmp[0], tmp[1], tmp[2], lum(cb[0], cb[1], cb[2]), out);
    case 'dye':
      return setLum(cs[0], cs[1], cs[2], lum(cb[0], cb[1], cb[2]), out);
    case 'cover':
      return setLum(cb[0], cb[1], cb[2], lum(cs[0], cs[1], cs[2]), out);
  }
}

/**
 * A source composited over a backdrop through a mode, both straight (not
 * premultiplied) RGBA from 0 to 1, and the result the same: the source's color
 * mixed where the backdrop is there to mix with, `Cs' = (1 - ab) Cs + ab B(Cb, Cs)`,
 * then laid source-over.
 */
export function blendPixel(mode: BlendModeId, backdrop: Readonly<Rgba>, source: Readonly<Rgba>): Rgba {
  const ab = backdrop[3];
  const as = source[3];
  const ao = as + ab * (1 - as);
  if (ao <= 0) return [0, 0, 0, 0];
  const mixed = blendColor(mode, [backdrop[0], backdrop[1], backdrop[2]], [source[0], source[1], source[2]]);
  const out: Rgba = [0, 0, 0, ao];
  for (let i = 0; i < 3; i++) {
    const cs = (1 - ab) * source[i] + ab * mixed[i];
    out[i] = (as * cs + ab * backdrop[i] * (1 - as)) / ao;
  }
  return out;
}
