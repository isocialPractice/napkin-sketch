/**
 * Napkin Blends (src/core/blend.ts): the sixteen modes of Illustrator's
 * Transparency panel under napkin names, and the W3C math the headless
 * rasterizer mixes with.
 *
 * The expected colors are worked by hand from the W3C Compositing and
 * Blending Level 1 formulas, one channel at a time, and every channel is
 * checked on its own: a mix that read one channel for another - green from
 * blue, say - would pass a test that only looked at the sum.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BLEND_MODE_IDS,
  BLEND_MODES,
  blendColor,
  blendModeInfo,
  blendModeOf,
  blendPixel,
  compositeOperation,
  isBlended,
  isSeparable,
  type BlendModeId,
  type Rgb,
  type Rgba,
} from '../src/core/blend.js';

const close = (actual: readonly number[], expected: readonly number[], label: string, eps = 1e-6): void => {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((value, i) => {
    assert.ok(Math.abs(value - expected[i]) <= eps, `${label}, channel ${i}: got ${value}, want ${expected[i]}`);
  });
};

test('the sixteen modes, in Illustrator order, under napkin names', () => {
  assert.equal(BLEND_MODES.length, 16);
  assert.equal(new Set(BLEND_MODE_IDS).size, 16, 'every id is its own');
  assert.equal(new Set(BLEND_MODES.map((mode) => mode.label)).size, 16, 'every label is its own');
  assert.deepEqual(
    BLEND_MODES.map((mode) => mode.illustrator),
    ['Normal', 'Darken', 'Multiply', 'Color Burn', 'Lighten', 'Screen', 'Color Dodge', 'Overlay', 'Soft Light', 'Hard Light', 'Difference', 'Exclusion', 'Hue', 'Saturation', 'Color', 'Luminosity'],
  );
  // The brief's eleven, by the names it gave them.
  const brief: Array<[string, string]> = [
    ['Stack Blend', 'Multiply'],
    ['Soak Blend', 'Darken'],
    ['Dry Blend', 'Lighten'],
    ['Fold Blend', 'Overlay'],
    ['Light Blend', 'Soft Light'],
    ['Heavy Blend', 'Hard Light'],
    ['Messy Blend', 'Difference'],
    ['Avoidance Blend', 'Exclusion'],
    ['Tidy Blend', 'Hue'],
    ['Bright Blend', 'Saturation'],
    ['Cover Blend', 'Luminosity'],
  ];
  for (const [label, illustrator] of brief) {
    assert.equal(BLEND_MODES.find((mode) => mode.label === label)?.illustrator, illustrator, label);
  }
  assert.deepEqual(
    BLEND_MODES.map((mode) => mode.family),
    ['normal', 'darken', 'darken', 'darken', 'lighten', 'lighten', 'lighten', 'contrast', 'contrast', 'contrast', 'comparative', 'comparative', 'component', 'component', 'component', 'component'],
  );
});

test('a mode is read by any of its names, in any case', () => {
  const cases: Array<[unknown, BlendModeId | undefined]> = [
    ['stack', 'stack'],
    ['Stack Blend', 'stack'],
    ['Multiply', 'stack'],
    ['multiply', 'stack'],
    ['color-burn', 'scorch'],
    ['ColorBurn', 'scorch'],
    ['COLOR BURN', 'scorch'],
    ['soft-light', 'light'],
    ['SoftLight', 'light'],
    ['Saturation', 'bright'],
    ['luminosity', 'cover'],
    ['source-over', 'normal'],
    ['Normal', 'normal'],
    ['plaid', undefined],
    ['', undefined],
    [42, undefined],
    [null, undefined],
  ];
  for (const [value, want] of cases) assert.equal(blendModeOf(value), want, String(value));
});

test('each mode names its CSS, PDF and Illustrator script spelling', () => {
  assert.equal(compositeOperation('stack'), 'multiply');
  assert.equal(compositeOperation('cover'), 'luminosity');
  assert.equal(compositeOperation('normal'), 'source-over', 'the canvas calls normal source-over');
  assert.equal(compositeOperation(undefined), 'source-over');
  assert.equal(blendModeInfo('bright').jsx, 'SATURATIONBLEND');
  assert.equal(blendModeInfo('dye').jsx, 'COLORBLEND');
  assert.equal(blendModeInfo('scorch').pdf, 'ColorBurn');
  assert.equal(isBlended('normal'), false);
  assert.equal(isBlended(undefined), false);
  assert.equal(isBlended('messy'), true);
  assert.deepEqual(
    BLEND_MODE_IDS.filter((id) => !isSeparable(id)),
    ['tidy', 'bright', 'dye', 'cover'],
  );
});

// Backdrop and source: one channel under a half, one at it, one over, so every
// branch a separable mode has is taken somewhere.
const CB: Rgb = [0.2, 0.5, 0.8];
const CS: Rgb = [0.6, 0.3, 0.9];

test('every separable mode, channel by channel', () => {
  const want: Record<string, Rgb> = {
    normal: [0.6, 0.3, 0.9],
    stack: [0.12, 0.15, 0.72],
    sheer: [0.68, 0.65, 0.98],
    soak: [0.2, 0.3, 0.8],
    dry: [0.6, 0.5, 0.9],
    messy: [0.4, 0.2, 0.1],
    avoidance: [0.56, 0.5, 0.26],
    // Hard light reads the source: 0.6 screens, 0.3 multiplies, 0.9 screens.
    heavy: [0.36, 0.3, 0.96],
    // Overlay is hard light with the two swapped, so it reads the backdrop.
    fold: [0.24, 0.3, 0.96],
    // Soft light: D(0.2) = 0.448 below a quarter; 0.3 darkens; D(0.8) = sqrt(0.8).
    light: [0.2496, 0.4, 0.8 + 0.8 * (Math.sqrt(0.8) - 0.8)],
    bleach: [0.5, 0.5 / 0.7, 1],
    scorch: [0, 0, 1 - 0.2 / 0.9],
  };
  for (const [mode, rgb] of Object.entries(want)) close(blendColor(mode as BlendModeId, CB, CS), rgb, mode);
});

test('the four that mix the color as a whole, and both ways of pulling it back into gamut', () => {
  // Lum(CB) = 0.443 and Lum(CS) = 0.456; both saturations are 0.6.
  close(blendColor('cover', CB, CS), [0.213, 0.513, 0.813], 'luminosity');
  close(blendColor('dye', CB, CS), [0.587, 0.287, 0.887], 'color');
  close(blendColor('tidy', CB, CS), [0.587, 0.287, 0.887], 'hue');
  close(blendColor('bright', CB, CS), [0.2, 0.5, 0.8], 'saturation');
  // A light yellow under a deep blue: Lum 0.812 against 0.247.
  const yellow: Rgb = [0.9, 0.9, 0.1];
  const blue: Rgb = [0.1, 0.2, 0.9];
  // The blue raised to the yellow's lightness runs past 1, and is pulled back.
  const k = 0.188 / 0.653;
  close(blendColor('dye', yellow, blue), [0.812 - 0.147 * k, 0.812 - 0.047 * k, 1], 'color, clipped over 1');
  // The yellow lowered to the blue's lightness runs under 0, and is pulled back.
  const j = 0.247 / 0.712;
  close(blendColor('cover', yellow, blue), [0.247 + 0.088 * j, 0.247 + 0.088 * j, 0], 'luminosity, clipped under 0');
});

test('every mode stays in gamut, whatever it is given', () => {
  let seed = 7;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const mode of BLEND_MODE_IDS) {
    for (let i = 0; i < 400; i++) {
      const out = blendColor(mode, [rnd(), rnd(), rnd()], [rnd(), rnd(), rnd()]);
      for (const v of out) assert.ok(v >= -1e-9 && v <= 1 + 1e-9, `${mode} gave ${v}`);
    }
  }
});

test('a pixel mixes where the backdrop is, and lays down source-over', () => {
  // Opaque over opaque: the mix itself.
  close(blendPixel('stack', [...CB, 1] as Rgba, [...CS, 1] as Rgba), [0.12, 0.15, 0.72, 1], 'opaque');
  // Half over half: Cs' = 0.5 Cs + 0.5 B, co = 0.5 Cs' + 0.25 Cb, over 0.75.
  close(
    blendPixel('stack', [0.2, 0.5, 0.8, 0.5], [0.6, 0.3, 0.9, 0.5]),
    [0.23 / 0.75, 0.2375 / 0.75, 0.605 / 0.75, 0.75],
    'half over half',
  );
  // Nothing under it: the source as it is, whatever the mode.
  close(blendPixel('messy', [0.2, 0.5, 0.8, 0], [0.6, 0.3, 0.9, 1]), [0.6, 0.3, 0.9, 1], 'over nothing');
  // Nothing in it: the backdrop as it was.
  close(blendPixel('messy', [0.2, 0.5, 0.8, 1], [0.6, 0.3, 0.9, 0]), [0.2, 0.5, 0.8, 1], 'nothing over');
  close(blendPixel('stack', [0, 0, 0, 0], [0, 0, 0, 0]), [0, 0, 0, 0], 'nothing at all');
});
