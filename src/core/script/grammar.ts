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
  verbSpec,
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
import { parsePencil } from '../pencil.js';
import { ACCENT_LANGUAGES, accentLanguage } from '../type/accents.js';
import { suggest } from './diagnostics.js';

/** The two words a language slot takes beside a language: `auto`, the one the code reads most like, and `none`. */
function isAccentWord(value: string): boolean {
  return value === 'auto' || value === 'none';
}

export const isSlotPart = (part: FormPart): part is SlotPart => 'slot' in part;
export const isWordPart = (part: FormPart): part is WordPart => 'word' in part;
export const isClausePart = (part: FormPart): part is ClausePart => 'clause' in part;
export const isFlagPart = (part: FormPart): part is FlagPart => 'flag' in part;
export const isBlockPart = (part: FormPart): part is BlockPart => 'block' in part;

/** The Text Configuration a run of a text follows, by name: written first, its own attributes after it override it. */
const RUN_CONFIG_CLAUSE: ClausePart = { clause: 'config', optional: true, parts: [{ slot: 'config', type: 'string' }] };

/**
 * The clauses a run of a text takes beyond `character`'s: a size, a family
 * and a color of its own, which `font` and `color` set for a whole text.
 */
const RUN_OWN_CLAUSES: readonly ClausePart[] = [
  { clause: 'size', optional: true, parts: [{ slot: 'size', type: 'length', axis: 'min' }] },
  { clause: 'family', optional: true, parts: [{ slot: 'family', type: 'string' }] },
  { clause: 'color', optional: true, parts: [{ slot: 'color', type: 'color' }] },
];

let runFormKept: VerbForm | null = null;

/**
 * How a run of a text is written inside `runs (...)`, after its start and its
 * end: the Text Configuration it follows, `character`'s clauses and flags,
 * then a size, a family and a color of its own. The parser reads a run with
 * it, the formatter writes one with it, and the validator checks one against
 * it, so the three agree.
 */
export function runForm(): VerbForm {
  if (runFormKept) return runFormKept;
  const character = verbSpec('character')?.forms[0];
  runFormKept = {
    signature: '<start> <end> [config "<name>"] [character clauses] [size <size>] [family "<family>"] [color <color>]',
    parts: [RUN_CONFIG_CLAUSE, ...(character?.parts ?? []), ...RUN_OWN_CLAUSES],
  };
  return runFormKept;
}

/** A run's fields in the order they are written: its start and end, then the run form's. */
export function orderedRun(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = { start: fields.start, end: fields.end };
  const form = runForm();
  for (const { slot } of formSlots(form)) if (fields[slot.slot] !== undefined) out[slot.slot] = fields[slot.slot];
  for (const flag of form.parts.filter(isFlagPart)) if (fields[flag.field] !== undefined && out[flag.field] === undefined) out[flag.field] = fields[flag.field];
  return out;
}

/** What is wrong with a run, when something is: its start and end, and each attribute against the run form. */
function checkRun(run: unknown): ValueProblem | null {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    return { code: 'invalid-value', message: 'A run is an object: its `start`, its `end`, and its attributes.' };
  }
  const r = run as Record<string, unknown>;
  const start = r.start;
  const end = r.end;
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    return { code: 'invalid-value', message: 'A run needs a whole-number `start` and an `end` after it, counting characters from 0.' };
  }
  const form = runForm();
  const slots = formSlots(form);
  const flags = form.parts.filter(isFlagPart);
  for (const [field, value] of Object.entries(r)) {
    if (field === 'start' || field === 'end' || value === undefined) continue;
    const slot = slots.find((s) => s.slot.slot === field);
    if (slot) {
      const problem = checkValue(slot.slot, value);
      if (problem) return problem;
      continue;
    }
    const own = flags.filter((flag) => flag.field === field);
    if (own.some((flag) => flag.value === value)) continue;
    return { code: 'invalid-value', message: `A run has no \`${field}\`${own.length > 0 ? ` of ${JSON.stringify(value)}` : ''}.` };
  }
  return null;
}

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
      if (slot.percent) return 'a percent, such as `50` or `50%`, or an expression in parentheses';
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
    case 'pencil':
      return 'a pencil: a graphite grade from `9H` to `9B`, or `charcoal`, `compressed` or `vine` and its grade, such as `charcoal 4B` or `vine soft`';
    case 'language':
      return 'a language highlight.js reads, by its id or a name it goes by - such as `python`, `ts` or `"c++"` - or `auto` or `none`';
    case 'points':
      return 'a list of points, `x y, x y, ...`';
    case 'stops':
      return 'gradient stops, `(color offset, color offset, ...)`';
    case 'runs':
      return 'runs of the text, `(start end attributes, start end attributes, ...)`';
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
  pencil: 'expected-choice',
  language: 'expected-choice',
  points: 'expected-points',
  stops: 'expected-stops',
  runs: 'invalid-value',
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
    case 'pencil':
      return typeof value === 'string' && parsePencil(value)
        ? null
        : { code: 'expected-choice', message: `\`${String(value)}\` is not ${describeSlot(slot)}.` };
    case 'language': {
      if (typeof value === 'string' && (isAccentWord(value) || accentLanguage(value) !== null)) return null;
      const guess = typeof value === 'string' ? suggest(value, ACCENT_LANGUAGES.flatMap((language) => [language.id, ...language.aliases])) : null;
      return { code: 'expected-choice', message: `\`${String(value)}\` is not ${describeSlot(slot)}.${guess ? ` Did you mean \`${guess}\`?` : ''}` };
    }
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
    case 'runs': {
      if (!Array.isArray(value)) return { code: 'invalid-value', message: 'A list of runs was expected: `(start end attributes, ...)`.' };
      for (const run of value) {
        const problem = checkRun(run);
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
  pathfinder: 'wipe',
  unite: 'wipe',
  union: 'wipe',
  combine: 'wipe',
  intersect: 'wipe',
  subtract: 'wipe',
  exclude: 'wipe',
  divide: 'wipe',
  builder: 'stack',
  merge: 'stack',
  scissors: 'split',
  slice: 'split',
  mask: 'clip',
  clipping: 'clip',
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
