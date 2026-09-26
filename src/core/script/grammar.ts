/**
 * Reading the verb table: the helpers the text parser, the JSON validator and
 * the formatter share, so all three understand `verbs.json` the same way.
 *
 * The central one is {@link formFor}: which way of writing a verb can express
 * a given instruction. The formatter writes an instruction in that form, and
 * the validator refuses a JSON instruction that has none - which is what makes
 * every valid script, however it was built, one that can be written as text.
 */

import { COLOR_NAMES } from '../graphic-design/color.js';
import { parseExpression } from './expr.js';
import {
  VERB_NAMES,
  type BlockPart,
  type ClausePart,
  type DiagnosticCode,
  type FlagPart,
  type FormPart,
  type SlotPart,
  type SlotType,
  type VerbForm,
  type VerbSpec,
  type WordPart,
} from './instructions.js';
import { isColor, isExpr, isIdentifier, isKnownUnit, readLengthLiteral, RESERVED_NAMES, UNITS_SENTENCE } from './values.js';

export const isSlotPart = (part: FormPart): part is SlotPart => 'slot' in part;
export const isWordPart = (part: FormPart): part is WordPart => 'word' in part;
export const isClausePart = (part: FormPart): part is ClausePart => 'clause' in part;
export const isFlagPart = (part: FormPart): part is FlagPart => 'flag' in part;
export const isBlockPart = (part: FormPart): part is BlockPart => 'block' in part;

/** One slot of a form, with whether the form can leave it out and the clause it sits in. */
export interface FormSlot {
  slot: SlotPart;
  optional: boolean;
  clause?: ClausePart;
}

/** Every slot a form reads, clause slots included, in the order they are written. */
export function formSlots(form: VerbForm): FormSlot[] {
  const out: FormSlot[] = [];
  for (const part of form.parts) {
    if (isSlotPart(part)) out.push({ slot: part, optional: part.optional === true });
    if (isClausePart(part)) {
      for (const slot of part.parts) {
        out.push({ slot, optional: part.optional === true || slot.optional === true, clause: part });
      }
    }
  }
  return out;
}

/** The block a form opens, if it opens one. */
export function formBlock(form: VerbForm): BlockPart | undefined {
  return form.parts.find(isBlockPart);
}

/** Every way of writing a verb, as a message shows them. */
export function signaturesOf(spec: VerbSpec): string {
  return spec.forms.map((form) => form.signature).join(' | ');
}

/** What a slot takes, as a message words it. */
export function describeSlot(slot: SlotPart): string {
  switch (slot.type) {
    case 'length':
      return slot.axis === 'none'
        ? 'a length, such as `400` or `210mm`'
        : 'a length, such as `120`, `10mm` or `50%`';
    case 'number':
      return slot.literal ? 'a number' : 'a number, or an expression in parentheses';
    case 'integer':
      return slot.literal ? 'a whole number' : 'a whole number, or an expression in parentheses';
    case 'string':
      return 'a string in double quotes';
    case 'identifier':
      return 'a name: letters, digits and underscores, starting with a letter';
    case 'color':
      return 'a color, such as `#1f2328`, `steelblue` or `rgb(31, 35, 40)`';
    case 'choice':
      return `one of ${(slot.choices ?? []).map((c) => `\`${c}\``).join(', ')}`;
    case 'switch':
      return '`on` or `off`';
    case 'points':
      return 'a list of points, `x y, x y, ...`';
    case 'stops':
      return 'gradient stops, `(color offset, color offset, ...)`';
  }
}

/** The code a slot reports when it is handed something of the wrong kind. */
export const EXPECTED_CODES: Readonly<Record<SlotType, DiagnosticCode>> = {
  length: 'expected-length',
  number: 'expected-number',
  integer: 'expected-number',
  string: 'expected-string',
  identifier: 'expected-identifier',
  color: 'expected-color',
  choice: 'expected-choice',
  switch: 'expected-choice',
  points: 'expected-points',
  stops: 'expected-stops',
};

/** What went wrong with a value, when something did. */
export interface ValueProblem {
  code: DiagnosticCode;
  message: string;
}

function checkExpr(value: { expr: string }): ValueProblem | null {
  const parsed = parseExpression(value.expr);
  return parsed.ok ? null : { code: parsed.code, message: `\`(${value.expr})\`: ${parsed.message}` };
}

function checkLength(value: unknown, axis: SlotPart['axis']): ValueProblem | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? null : { code: 'expected-length', message: 'A length has to be a finite number.' };
  }
  if (typeof value === 'string') {
    const literal = readLengthLiteral(value);
    if (!literal) return { code: 'expected-length', message: `\`${value}\` is not a length, such as \`120\`, \`"10mm"\` or \`"50%"\`.` };
    if (literal.unit !== null && !isKnownUnit(literal.unit)) {
      return { code: 'unit-unknown', message: `\`${value}\`: \`${literal.unit}\` is not a unit. ${UNITS_SENTENCE}` };
    }
    if (literal.unit === '%' && axis === 'none') {
      return { code: 'invalid-value', message: `\`${value}\`: a percentage cannot be used here, where there is no page to measure it against.` };
    }
    return null;
  }
  if (isExpr(value)) return checkExpr(value);
  return { code: 'expected-length', message: 'A length is a number, a string such as `"10mm"` or `"50%"`, or `{ "expr": "..." }`.' };
}

function checkNumber(value: unknown, slot: SlotPart): ValueProblem | null {
  const code = EXPECTED_CODES[slot.type];
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { code, message: 'A number has to be finite.' };
    if (slot.type === 'integer' && !Number.isInteger(value)) return { code, message: `\`${value}\` is not a whole number.` };
    return null;
  }
  if (isExpr(value)) {
    if (slot.literal) return { code, message: 'An expression is not accepted here, only a plain number.' };
    return checkExpr(value);
  }
  return { code, message: `${describeSlot(slot)[0].toUpperCase()}${describeSlot(slot).slice(1)} was expected.` };
}

function checkPoint(value: unknown): ValueProblem | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { code: 'expected-points', message: 'A point is an object, `{ "x": ..., "y": ... }`.' };
  }
  const point = value as Record<string, unknown>;
  return checkLength(point.x, 'x') ?? checkLength(point.y, 'y');
}

function checkStop(value: unknown): ValueProblem | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { code: 'expected-stops', message: 'A gradient stop is an object, `{ "color": ..., "offset": ... }`.' };
  }
  const stop = value as Record<string, unknown>;
  if (typeof stop.color !== 'string' || !isColor(stop.color)) {
    return { code: 'expected-color', message: `\`${String(stop.color)}\` is not a color a gradient stop can take.` };
  }
  const offset = stop.offset;
  if (typeof offset === 'number') return Number.isFinite(offset) ? null : { code: 'expected-stops', message: 'A stop offset has to be finite.' };
  if (isExpr(offset)) return checkExpr(offset);
  return { code: 'expected-stops', message: 'Every gradient stop needs an `offset` from 0 to 1.' };
}

/**
 * Checks a value against a slot: its type and shape, and no more. Ranges -
 * an opacity above 1, a negative radius - are the evaluator's to judge, since
 * an expression can only be judged once it has been run.
 */
export function checkValue(slot: SlotPart, value: unknown): ValueProblem | null {
  switch (slot.type) {
    case 'length':
      return checkLength(value, slot.axis);
    case 'number':
    case 'integer':
      return checkNumber(value, slot);
    case 'string':
      return typeof value === 'string' ? null : { code: 'expected-string', message: 'A string was expected.' };
    case 'identifier':
      if (typeof value === 'string' && isIdentifier(value)) return null;
      if (typeof value === 'string' && RESERVED_NAMES.has(value)) {
        return { code: 'invalid-value', message: `\`${value}\` already means something in an expression and cannot be used as a name.` };
      }
      return { code: 'expected-identifier', message: `${describeSlot(slot)} was expected.` };
    case 'color':
      return typeof value === 'string' && isColor(value)
        ? null
        : { code: 'expected-color', message: `\`${String(value)}\` is not ${describeSlot(slot)}.` };
    case 'choice':
      return typeof value === 'string' && (slot.choices ?? []).includes(value)
        ? null
        : { code: 'expected-choice', message: `\`${String(value)}\` is not ${describeSlot(slot)}.` };
    case 'switch':
      return typeof value === 'boolean' ? null : { code: 'expected-choice', message: '`true` or `false` was expected.' };
    case 'points': {
      if (!Array.isArray(value)) return { code: 'expected-points', message: 'A list of points was expected.' };
      const min = slot.minItems ?? 1;
      if (value.length < min) return { code: 'invalid-value', message: `At least ${min} points are needed, and there ${value.length === 1 ? 'is' : 'are'} ${value.length}.` };
      for (const point of value) {
        const problem = checkPoint(point);
        if (problem) return problem;
      }
      return null;
    }
    case 'stops': {
      if (!Array.isArray(value)) return { code: 'expected-stops', message: 'A list of gradient stops was expected.' };
      if (value.length < 2) return { code: 'expected-stops', message: 'A gradient needs at least two stops.' };
      for (const stop of value) {
        const problem = checkStop(stop);
        if (problem) return problem;
      }
      return null;
    }
  }
}

/**
 * The way of writing a verb that can express an instruction: its implied
 * fields match, everything it requires is present, and every field present is
 * one it can write, with a value it can write. `null` when no form can.
 */
export function formFor(spec: VerbSpec, instruction: Readonly<Record<string, unknown>>): VerbForm | null {
  outer: for (const form of spec.forms) {
    const implied = form.set ?? {};
    for (const [field, value] of Object.entries(implied)) {
      if (instruction[field] !== value) continue outer;
    }
    const slots = formSlots(form);
    for (const { slot, optional } of slots) {
      if (!optional && instruction[slot.slot] === undefined) continue outer;
    }
    // A clause is written whole or not at all.
    for (const part of form.parts) {
      if (!isClausePart(part)) continue;
      const given = part.parts.some((slot) => instruction[slot.slot] !== undefined);
      if (given && part.parts.some((slot) => !slot.optional && instruction[slot.slot] === undefined)) continue outer;
    }
    const block = formBlock(form);
    if (block && !Array.isArray(instruction[block.field])) continue outer;
    for (const [field, value] of Object.entries(instruction)) {
      if (field === 'verb' || field === 'at' || value === undefined || field in implied) continue;
      const slot = slots.find((s) => s.slot.slot === field);
      if (slot) {
        if (checkValue(slot.slot, value)) continue outer;
        continue;
      }
      const flags = form.parts.filter(isFlagPart).filter((flag) => flag.field === field);
      if (flags.length > 0) {
        if (!flags.some((flag) => flag.value === value)) continue outer;
        continue;
      }
      if (block && block.field === field) continue;
      continue outer;
    }
    return form;
  }
  return null;
}

/**
 * Words people reach for that are not verbs, and the verb they meant. Used
 * only to suggest: `rectangle` is still an error, one that names `rect`.
 */
export const VERB_ALIASES: Readonly<Record<string, string>> = {
  rectangle: 'rect',
  square: 'rect',
  box: 'rect',
  oval: 'ellipse',
  triangle: 'polygon',
  colour: 'color',
  ink: 'color',
  stroke_width: 'width',
  linewidth: 'width',
  thickness: 'width',
  alpha: 'opacity',
  transparency: 'opacity',
  dash: 'style',
  dashes: 'style',
  lineto: 'to',
  moveto: 'move',
  curveto: 'curve',
  bezier: 'curve',
  closepath: 'close',
  spline: 'through',
  loop: 'repeat',
  for: 'repeat',
  times: 'repeat',
  var: 'let',
  set: 'let',
  const: 'let',
  def: 'define',
  symbol: 'define',
  component: 'define',
  instance: 'place',
  stamp: 'place',
  label: 'text',
  title: 'text',
  caption: 'text',
  img: 'image',
  picture: 'image',
  photo: 'image',
  import: 'use',
  include: 'use',
  size: 'page',
  canvas: 'page',
  paper: 'background',
  bg: 'background',
  flip: 'mirror',
  reflect: 'mirror',
  turn: 'rotate',
  rotation: 'rotate',
  zoom: 'scale',
  resize: 'scale',
  move_to: 'move',
  version: 'napkin',
};

/** The verbs, for suggestions. */
export const VERB_WORDS: readonly string[] = VERB_NAMES;

/** The color names, for suggestions. */
export const COLOR_WORDS: readonly string[] = COLOR_NAMES;
