/**
 * The object form as a JSON Schema: what a program in any language can check
 * a script against before it hands the script over.
 *
 * It is made from the verb table the parser and the validator read, and
 * `npm run api-docs` writes it to `docs/api/schema/instructions.schema.json`.
 * It is the strict reading of the object form: a field a verb does not have
 * fails here, where `validateScript` only warns and leaves it out. What a
 * schema cannot say - a color's own grammar, an expression's, which mix of
 * fields a verb can be written with - `validateScript` still checks, so a
 * script that passes the schema can still earn a diagnostic.
 */

import { INSTRUCTION_FIELDS, SCRIPT_VERSION, VERBS, type FormPart, type SlotPart, type VerbSpec } from './instructions.js';

/** A JSON Schema document or fragment. */
export type JsonSchema = Record<string, unknown>;

/** A number, then a unit the language reads (in either case) or a `%`. */
const LENGTH = '^[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?(?:[pP][xX]|[iI][nN]|[mM][mM]|[pP][tT]|%)?$';

/** The same, with no `%`: a length that has no page to be a share of. */
const LENGTH_NO_PERCENT = '^[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?(?:[pP][xX]|[iI][nN]|[mM][mM]|[pP][tT])?$';

const EXPRESSION = { $ref: '#/definitions/expression' };

/** The schema of one slot's value, as `checkValue` accepts it. */
function slotSchema(slot: SlotPart): JsonSchema {
  const expression = slot.literal ? [] : [EXPRESSION];
  switch (slot.type) {
    case 'length':
      return {
        anyOf: [{ type: 'number' }, { type: 'string', pattern: slot.axis === 'none' ? LENGTH_NO_PERCENT : LENGTH }, ...expression],
      };
    case 'number':
      return expression.length > 0 ? { anyOf: [{ type: 'number' }, ...expression] } : { type: 'number' };
    case 'integer':
      return expression.length > 0 ? { anyOf: [{ type: 'integer' }, ...expression] } : { type: 'integer' };
    case 'string':
      return { type: 'string' };
    case 'identifier':
      return { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' };
    case 'color':
      return { type: 'string', description: 'A CSS color: a name, #rgb to #rrggbbaa, rgb(), rgba(), hsl() or hsla().' };
    case 'choice':
      return { type: 'string', enum: [...(slot.choices ?? [])] };
    case 'switch':
      return { type: 'boolean' };
    case 'points':
      return { type: 'array', minItems: slot.minItems ?? 1, items: { $ref: '#/definitions/point' } };
    case 'stops':
      return { type: 'array', minItems: 2, items: { $ref: '#/definitions/stop' } };
  }
}

/** Every value a verb's forms can give each field: a slot's, a flag's, or one a form implies. */
function fieldValues(spec: VerbSpec): Map<string, JsonSchema[]> {
  const values = new Map<string, JsonSchema[]>();
  const add = (field: string, schema: JsonSchema): void => {
    const list = values.get(field) ?? [];
    if (!list.some((known) => JSON.stringify(known) === JSON.stringify(schema))) list.push(schema);
    values.set(field, list);
  };
  const walk = (parts: readonly FormPart[]): void => {
    for (const part of parts) {
      if ('slot' in part) add(part.slot, slotSchema(part));
      else if ('clause' in part) walk(part.parts);
      else if ('flag' in part) add(part.field, typeof part.value === 'boolean' ? { type: 'boolean' } : { const: part.value });
      else if ('block' in part) add(part.field, { $ref: part.block === 'path' ? '#/definitions/pathBody' : '#/definitions/body' });
    }
  };
  for (const form of spec.forms) {
    walk(form.parts);
    for (const [field, value] of Object.entries(form.set ?? {})) add(field, value === null ? { type: 'null' } : { const: value });
  }
  return values;
}

/** One verb's instruction: its `verb`, its fields, the required ones, and nothing else. */
function instructionSchema(spec: VerbSpec): JsonSchema {
  const presence = INSTRUCTION_FIELDS[spec.name] as Readonly<Record<string, 'required' | 'optional'>>;
  const values = fieldValues(spec);
  const properties: Record<string, JsonSchema> = { verb: { const: spec.name }, at: { $ref: '#/definitions/position' } };
  const required = ['verb'];
  for (const [field, need] of Object.entries(presence)) {
    const options = values.get(field) ?? [{}];
    // An optional field may be null or, for a flag, false, and then it is absent.
    const absent = need === 'optional' ? [{ type: 'null' }] : [];
    const all = [...options, ...absent];
    properties[field] = all.length === 1 ? all[0] : { anyOf: all };
    if (need === 'required') required.push(field);
  }
  return {
    type: 'object',
    title: spec.name,
    description: spec.summary,
    properties,
    required,
    additionalProperties: false,
  };
}

/** The verbs an instruction list can hold where the context is `context`. */
function listOf(context: 'document' | 'path'): JsonSchema {
  const verbs = VERBS.filter((spec) => spec.context === context || spec.context === 'any');
  return { type: 'array', items: { anyOf: verbs.map((spec) => ({ $ref: `#/definitions/verbs/${spec.name}` })) } };
}

/** The whole object form: a script is an array of instructions. */
export function instructionsSchema(): JsonSchema {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://github.com/isocialPractice/napkin-sketch/docs/api/schema/instructions.schema.json',
    title: `napkin script ${SCRIPT_VERSION}, the object form`,
    description:
      'A script as JSON: an array of instructions, each an object naming its verb. Generated from the verb table by npm run api-docs; validateScript is the full check.',
    $ref: '#/definitions/body',
    definitions: {
      body: listOf('document'),
      pathBody: listOf('path'),
      expression: {
        type: 'object',
        description: 'An expression, its source without the parentheses: { "expr": "20 + i * 40" }.',
        properties: { expr: { type: 'string' } },
        required: ['expr'],
        additionalProperties: false,
      },
      point: {
        type: 'object',
        properties: { x: slotSchema({ slot: 'x', type: 'length', axis: 'x' }), y: slotSchema({ slot: 'y', type: 'length', axis: 'y' }) },
        required: ['x', 'y'],
        additionalProperties: false,
      },
      stop: {
        type: 'object',
        properties: { color: slotSchema({ slot: 'color', type: 'color' }), offset: slotSchema({ slot: 'offset', type: 'number' }) },
        required: ['color', 'offset'],
        additionalProperties: false,
      },
      position: {
        type: 'object',
        description: 'Where a parsed instruction came from. A program building JSON leaves it out.',
        properties: { line: { type: 'integer' }, column: { type: 'integer' } },
        additionalProperties: false,
      },
      verbs: Object.fromEntries(VERBS.map((spec) => [spec.name, instructionSchema(spec)])),
    },
  };
}
