/**
 * Measurement units for the properties panel.
 *
 * The canvas works entirely in CSS pixels; every other unit here is a printing
 * unit converted through the CSS reference of 96 pixels per inch, which is the
 * same ratio the SVG and PDF exports assume. Conversions are exact ratios, so
 * a value typed in millimetres and read back in millimetres round-trips.
 */

/** A length unit offered by the properties panel. */
export type LengthUnit = 'px' | 'in' | 'mm' | 'pt';

/** Scale units: a percentage of the current size, or an absolute length. */
export type ScaleUnit = '%' | LengthUnit;

/** CSS reference resolution - the ratio every print unit converts through. */
export const CSS_PX_PER_INCH = 96;

const PX_PER_UNIT: Record<LengthUnit, number> = {
  px: 1,
  in: CSS_PX_PER_INCH,
  mm: CSS_PX_PER_INCH / 25.4,
  pt: CSS_PX_PER_INCH / 72,
};

/** Every length unit, in the order the panel lists them. */
export const LENGTH_UNITS: LengthUnit[] = ['px', 'in', 'mm', 'pt'];

/** Every scale unit, in the order the panel lists them. */
export const SCALE_UNITS: ScaleUnit[] = ['%', 'px', 'in', 'mm', 'pt'];

/** Type guard for a length unit read back from the DOM or a settings file. */
export function isLengthUnit(value: unknown): value is LengthUnit {
  return typeof value === 'string' && value in PX_PER_UNIT;
}

/** Type guard for a scale unit (a length unit, or a percentage). */
export function isScaleUnit(value: unknown): value is ScaleUnit {
  return value === '%' || isLengthUnit(value);
}

/** Converts a value expressed in `unit` to canvas pixels. */
export function toPx(value: number, unit: LengthUnit): number {
  return value * PX_PER_UNIT[unit];
}

/** Converts canvas pixels to `unit`. */
export function fromPx(px: number, unit: LengthUnit): number {
  return px / PX_PER_UNIT[unit];
}

/**
 * Decimals worth showing for a unit. One canvas pixel is a third of a
 * millimetre, so the small print units need more places than pixels do before
 * a typed value stops surviving a round-trip through the field.
 */
export function unitPrecision(unit: LengthUnit): number {
  if (unit === 'px') return 1;
  if (unit === 'in') return 3;
  return 2;
}

/** Formats a pixel measurement for display in `unit`, without trailing zeros. */
export function formatLength(px: number, unit: LengthUnit): string {
  const value = fromPx(px, unit);
  if (!Number.isFinite(value)) return '0';
  const rounded = Number(value.toFixed(unitPrecision(unit)));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * The step a number input should use for a unit: one display increment at the
 * unit's precision, so the spinner arrows move by a visible amount.
 */
export function unitStep(unit: LengthUnit): number {
  return 1 / 10 ** unitPrecision(unit);
}
