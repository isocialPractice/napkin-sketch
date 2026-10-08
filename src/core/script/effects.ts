/**
 * The `effect` verb: an effect as a script writes it, turned into the model's
 * {@link Effect}, in page pixels.
 *
 * An effect waits for the next layer, group or mark the script makes, and
 * several wait together, in order; the evaluator keeps them and hands them
 * over. What is decided here is what one `effect` line means: its lengths are
 * read in the units in force where the line is and scaled by the transform in
 * force there, as a mark's width is; a shadow's offset turns with that
 * transform, as a mark's anchors do, and so does a bevel's light. What a line
 * leaves out is the effect's default (core/effects.ts's EFFECT_DEFAULTS), a
 * length among them measured in the same units.
 */

import { blendModeOf, type BlendModeId } from '../blend.js';
import { EFFECT_DEFAULTS, type Effect, type EffectShade } from '../effects.js';
import { SPLATTER_PRESETS, splatterPresetOf } from '../splatter.js';
import { warpPartFor, warpStyleOf } from '../warp-styles.js';
import { meanScale, type Matrix } from '../graphic-design/geometry.js';
import type { EffectInstruction, LengthArg, NumberArg, PercentAxis } from './instructions.js';

/** How an `effect` line's values are read and checked, each where the line is. */
export interface EffectReader {
  length(value: LengthArg, axis: PercentAxis): number;
  number(value: NumberArg): number;
  /** The value, or a diagnostic when it is below 0. */
  nonNegative(value: number, what: string): number;
  /** The value, or a diagnostic when it is outside 0 to 1. */
  fraction(value: number, what: string): number;
  /** The value, or a diagnostic when it is outside `lo` to `hi`. */
  between(value: number, lo: number, hi: number, what: string): number;
}

/** Whether a transform's linear part leaves a direction as it is. */
function straight(m: Matrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1;
}

/**
 * A light's angle - Photoshop's, counterclockwise from the right on a page
 * whose y runs down - turned by the transform, as a shadow's offset is.
 */
function turnedAngle(angle: number, m: Matrix): number {
  if (straight(m)) return ((angle % 360) + 360) % 360;
  const r = (angle * Math.PI) / 180;
  const x = Math.cos(r);
  const y = -Math.sin(r);
  const turned = (Math.atan2(-(m[1] * x + m[3] * y), m[0] * x + m[2] * y) * 180) / Math.PI;
  return Math.round((((turned % 360) + 360) % 360) * 1e6) / 1e6;
}

/** A hatch's direction turned by the transform, as a vector editor shows it: past -180, up to 180. */
function turnedHatch(angle: number, m: Matrix): number {
  const turned = turnedAngle(angle, m);
  return turned > 180 ? turned - 360 : turned;
}

/** A blend's name, read: the choice slot holds a name of a mode, so it is one. */
function blendOf(name: string | undefined, fallback: BlendModeId): BlendModeId {
  return blendModeOf(name) ?? fallback;
}

/**
 * The effect an `effect` line asks for, under the transform `matrix`. Not for
 * `effect none`, which asks for none.
 */
export function effectOf(instruction: EffectInstruction, read: EffectReader, matrix: Matrix): Effect {
  const own = ownEffect(instruction, read, matrix);
  return {
    ...own,
    ...(instruction.target ? { target: instruction.target } : {}),
    ...(instruction.hidden ? { on: false } : {}),
  } as Effect;
}

function ownEffect(instruction: EffectInstruction, read: EffectReader, matrix: Matrix): Effect {
  const scale = meanScale(matrix);
  const size = (value: LengthArg | undefined, fallback: number, what: string): number =>
    read.nonNegative(read.length(value ?? fallback, 'min'), what) * scale;
  const offset = (fallback: { dx: number; dy: number }): { dx: number; dy: number } => {
    const dx = read.length(instruction.dx ?? fallback.dx, 'x');
    const dy = read.length(instruction.dy ?? fallback.dy, 'y');
    return { dx: matrix[0] * dx + matrix[2] * dy, dy: matrix[1] * dx + matrix[3] * dy };
  };
  const share = (value: NumberArg | undefined, fallback: number, what: string): number =>
    value === undefined ? fallback : read.fraction(read.number(value), what);
  const percent = (value: NumberArg | undefined, what: string): number =>
    value === undefined ? 0 : read.between(read.number(value), 0, 100, what);
  switch (instruction.type) {
    case 'blur':
      return { type: 'blur', radius: read.nonNegative(read.length(instruction.radius ?? 0, 'min'), 'A blur') * scale };
    case 'brightness':
    case 'contrast':
    case 'saturate':
      return {
        type: instruction.type,
        amount: read.nonNegative(read.number(instruction.amount ?? 1), `A ${instruction.type} amount`),
      };
    case 'grayscale':
    case 'sepia':
    case 'invert':
    case 'opacity':
      return {
        type: instruction.type,
        amount: read.fraction(read.number(instruction.amount ?? 1), `A ${instruction.type} amount`),
      };
    case 'hue-rotate':
      return { type: 'hue-rotate', angle: read.number(instruction.angle ?? 0) };
    case 'drop-shadow': {
      const { dx, dy } = offset({ dx: 0, dy: 0 });
      const spread = percent(instruction.spread, 'A shadow spread');
      const opacity = share(instruction.opacity, 1, 'A shadow opacity');
      const blend = blendOf(instruction.blend, 'normal');
      return {
        type: 'drop-shadow',
        dx,
        dy,
        blur: size(instruction.blur, 0, 'A shadow blur'),
        color: instruction.color ?? '#000000',
        ...(spread > 0 ? { spread } : {}),
        ...(opacity < 1 ? { opacity } : {}),
        ...(blend !== 'normal' ? { blend } : {}),
      };
    }
    case 'feather':
      return { type: 'feather', radius: size(instruction.radius, EFFECT_DEFAULTS.feather.radius, 'A feather') };
    case 'inner-shadow': {
      const d = EFFECT_DEFAULTS['inner-shadow'];
      return {
        type: 'inner-shadow',
        ...offset(d),
        blur: size(instruction.blur, d.blur, 'A shadow blur'),
        choke: percent(instruction.choke, 'A shadow choke'),
        color: instruction.color ?? d.color,
        blend: blendOf(instruction.blend, d.blend),
        opacity: share(instruction.opacity, d.opacity, 'A shadow opacity'),
      };
    }
    case 'outer-glow': {
      const d = EFFECT_DEFAULTS['outer-glow'];
      return {
        type: 'outer-glow',
        blur: size(instruction.blur, d.blur, 'A glow blur'),
        spread: percent(instruction.spread, 'A glow spread'),
        color: instruction.color ?? d.color,
        blend: blendOf(instruction.blend, d.blend),
        opacity: share(instruction.opacity, d.opacity, 'A glow opacity'),
      };
    }
    case 'inner-glow': {
      const d = EFFECT_DEFAULTS['inner-glow'];
      return {
        type: 'inner-glow',
        blur: size(instruction.blur, d.blur, 'A glow blur'),
        choke: percent(instruction.choke, 'A glow choke'),
        source: instruction.source ?? d.source,
        color: instruction.color ?? d.color,
        blend: blendOf(instruction.blend, d.blend),
        opacity: share(instruction.opacity, d.opacity, 'A glow opacity'),
      };
    }
    case 'bevel':
    case 'emboss': {
      const d = EFFECT_DEFAULTS[instruction.type];
      const what = instruction.type === 'bevel' ? 'A bevel' : 'An emboss';
      const shade = (color: string | undefined, opacity: NumberArg | undefined, blend: string | undefined, fallback: EffectShade, part: string): EffectShade => ({
        color: color ?? fallback.color,
        blend: blendOf(blend, fallback.blend),
        opacity: share(opacity, fallback.opacity, `${what}'s ${part} opacity`),
      });
      const relief = {
        depth: instruction.depth === undefined ? d.depth : read.between(read.number(instruction.depth as NumberArg), 1, 1000, `${what}'s depth`),
        direction: instruction.direction ?? d.direction,
        size: size(instruction.size, d.size, `${what}'s size`),
        soften: size(instruction.soften, d.soften, `${what}'s softening`),
        angle: turnedAngle(instruction.angle === undefined ? d.angle : read.number(instruction.angle), matrix),
        altitude: instruction.altitude === undefined ? d.altitude : read.between(read.number(instruction.altitude), 0, 90, `${what}'s altitude`),
        highlight: shade(instruction.lightColor, instruction.lightOpacity, instruction.lightBlend, d.highlight, 'light'),
        shadow: shade(instruction.shadeColor, instruction.shadeOpacity, instruction.shadeBlend, d.shadow, 'shade'),
      };
      return instruction.type === 'bevel'
        ? { type: 'bevel', style: instruction.style === 'outer' ? 'outer' : 'inner', ...relief }
        : { type: 'emboss', style: instruction.style === 'pillow' ? 'pillow' : 'emboss', ...relief };
    }
    case 'splatter': {
      // A preset is where the line starts; what it names besides overrides it.
      const preset = splatterPresetOf(instruction.preset);
      const d = { ...EFFECT_DEFAULTS.splatter, ...(preset ? SPLATTER_PRESETS[preset] : {}) };
      const number = (value: NumberArg | undefined, fallback: number, lo: number, hi: number, what: string): number =>
        value === undefined ? fallback : read.between(read.number(value), lo, hi, what);
      const length = (value: LengthArg | undefined, fallback: number, lo: number, hi: number, what: string): number =>
        value === undefined ? fallback * scale : read.between(read.length(value, 'min'), lo, hi, what) * scale;
      return {
        type: 'splatter',
        angle: turnedHatch(instruction.angle === undefined ? d.angle : read.number(instruction.angle), matrix),
        overlap: length(instruction.overlap, d.overlap, -1000, 1000, 'A splatter overlap'),
        overlapVariation: length(instruction.overlapVariation, d.overlapVariation, 0, 1000, 'A splatter overlap variation'),
        width: length(instruction.width, d.width, 0.01, 1000, 'A splatter width'),
        curviness: number(instruction.curviness, d.curviness, 0, 100, 'A splatter curviness'),
        curvinessVariation: number(instruction.curvinessVariation, d.curvinessVariation, 0, 100, 'A splatter curviness variation'),
        spacing: length(instruction.spacing, d.spacing, 0.1, 10000, 'A splatter spacing'),
        spacingVariation: length(instruction.spacingVariation, d.spacingVariation, 0, 10000, 'A splatter spacing variation'),
        seed: Math.trunc(number(instruction.seed, d.seed, 0, 2 ** 31 - 1, 'A splatter seed')),
      };
    }
    case 'warp': {
      // A style by this app's name or a vector editor's; Arc Lower and the
      // like name their part, which `part` overrides. A Warp bends what it is
      // on over its box on the page, whatever the transform: it has no lengths.
      const d = EFFECT_DEFAULTS.warp;
      const named = warpStyleOf(instruction.style) ?? { style: d.style };
      const percent = (value: NumberArg | undefined, fallback: number, what: string): number =>
        value === undefined ? fallback : read.between(read.number(value), -100, 100, what);
      return {
        type: 'warp',
        style: named.style,
        orientation: instruction.orientation === 'vertical' ? 'vertical' : 'horizontal',
        bend: percent(instruction.bend, d.bend, "A warp's bend"),
        distortH: percent(instruction.distortH, d.distortH, "A warp's horizontal distortion"),
        distortV: percent(instruction.distortV, d.distortV, "A warp's vertical distortion"),
        part: warpPartFor(named.style, instruction.part ?? named.part),
      };
    }
    case 'extrude':
    case 'revolve': {
      // Lengths in the units and the scale in force; the turns, the light and
      // the scales as written: the 3D view has its own axes.
      const d = EFFECT_DEFAULTS['3d'];
      const number = (value: NumberArg | undefined, fallback: number, lo: number, hi: number, what: string): number =>
        value === undefined ? fallback : read.between(read.number(value), lo, hi, what);
      const length = (value: LengthArg | undefined, fallback: number, lo: number, hi: number, what: string): number =>
        value === undefined ? fallback * scale : read.between(read.length(value, 'min'), lo, hi, what) * scale;
      const kind = instruction.type;
      return {
        type: '3d',
        kind,
        depth: length(instruction.depth, d.depth, 0, 10000, "An extrude's depth"),
        caps: instruction.hollow !== true,
        angle: number(instruction.angle, d.angle, 0, 360, "A revolve's angle"),
        offset: length(instruction.offset, d.offset, -10000, 10000, "A revolve's offset"),
        axis: instruction.axis === 'right' ? 'right' : 'left',
        rotation: [
          number(instruction.rotateX, d.rotation[0], -360, 360, `An ${kind}'s turn about X`),
          number(instruction.rotateY, d.rotation[1], -360, 360, `An ${kind}'s turn about Y`),
          number(instruction.rotateZ, d.rotation[2], -360, 360, `An ${kind}'s turn about Z`),
        ],
        position: [
          length(instruction.positionX, 0, -100000, 100000, `An ${kind}'s position`),
          length(instruction.positionY, 0, -100000, 100000, `An ${kind}'s position`),
          length(instruction.positionZ, 0, -100000, 100000, `An ${kind}'s position`),
        ],
        scale: [
          number(instruction.scaleX, 1, 0.01, 100, `An ${kind}'s scale`),
          number(instruction.scaleY, 1, 0.01, 100, `An ${kind}'s scale`),
          number(instruction.scaleZ, 1, 0.01, 100, `An ${kind}'s scale`),
        ],
        perspective: number(instruction.perspective, d.perspective, 0, 160, `An ${kind}'s perspective`),
        shading: instruction.shading ?? d.shading,
        light: {
          azimuth: number(instruction.lightAzimuth, d.light.azimuth, -360, 360, `An ${kind}'s light`),
          elevation: number(instruction.lightElevation, d.light.elevation, -90, 90, `An ${kind}'s light`),
          intensity: number(instruction.lightIntensity, d.light.intensity, 0, 1, `An ${kind}'s light intensity`),
          ambient: number(instruction.lightAmbient, d.light.ambient, 0, 1, `An ${kind}'s ambient light`),
        },
        segments: Math.round(number(instruction.segments, d.segments, 0, 256, "A revolve's steps")),
      };
    }
    default:
      throw new Error(`effectOf: \`effect ${instruction.type}\` asks for no effect`);
  }
}
