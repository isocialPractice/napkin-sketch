/**
 * The verb table (`verbs.json`) against the instruction types.
 *
 * The types are what the evaluator runs; the table is what the parser follows
 * and what the documentation, the CLI's verb listing and the helper skill are
 * generated from. Nothing but this suite holds the two together, so it checks
 * them field by field: a verb in one and not the other, a field the grammar
 * can write that the type does not have, or a field the type requires that
 * some way of writing the verb leaves out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DIAGNOSTICS,
  DIAGNOSTIC_LEVELS,
  INSTRUCTION_FIELDS,
  PAPER_SIZES,
  PATH_ONLY_VERBS,
  SCRIPT_TOOLS,
  SCRIPT_VERSION,
  VERBS,
  VERB_CATEGORIES,
  VERB_CATEGORY_IDS,
  VERB_NAMES,
  VERB_TABLE_VERSION,
  verbSpec,
  type ClausePart,
  type FormPart,
  type SlotPart,
  type VerbForm,
} from '../src/core/script/instructions.js';
import { LENGTH_UNITS } from '../src/core/units.js';
import { STROKE_PROFILES, STROKE_STYLES } from '../src/core/types.js';
import verbTable from '../src/core/script/verbs.json';

const isSlot = (p: FormPart): p is SlotPart => 'slot' in p;
const isClause = (p: FormPart): p is ClausePart => 'clause' in p;
const isPositional = (p: FormPart): boolean => 'slot' in p || 'word' in p;

/** Every slot in a form, clause slots included, with whether it is optional. */
function slotsOf(form: VerbForm): { slot: SlotPart; optional: boolean }[] {
  const out: { slot: SlotPart; optional: boolean }[] = [];
  for (const part of form.parts) {
    if (isSlot(part)) out.push({ slot: part, optional: part.optional === true });
    if (isClause(part)) {
      for (const slot of part.parts) out.push({ slot, optional: part.optional === true || slot.optional === true });
    }
  }
  return out;
}

/** The fields one form writes, each marked by whether the form always writes it. */
function fieldsOf(form: VerbForm): Map<string, boolean> {
  const fields = new Map<string, boolean>();
  const note = (name: string, always: boolean) => fields.set(name, (fields.get(name) ?? false) || always);
  for (const { slot, optional } of slotsOf(form)) note(slot.slot, !optional);
  for (const part of form.parts) {
    if ('flag' in part) note(part.field, false);
    if ('block' in part) note(part.field, true);
  }
  for (const key of Object.keys(form.set ?? {})) note(key, true);
  return fields;
}

const specOf = (name: string) => {
  const spec = verbSpec(name);
  assert.ok(spec, `no row for ${name}`);
  return spec;
};

test('the table and the types name the same verbs, in the same order', () => {
  assert.deepEqual(
    VERBS.map((v) => v.name),
    [...VERB_NAMES],
  );
  assert.equal(new Set(VERB_NAMES).size, VERB_NAMES.length, 'no verb twice');
  assert.equal(VERB_TABLE_VERSION, SCRIPT_VERSION);
  assert.equal(verbTable.version, SCRIPT_VERSION);
});

test('every verb belongs to a listed category, and every category has verbs', () => {
  assert.deepEqual(
    VERB_CATEGORIES.map((c) => c.id),
    [...VERB_CATEGORY_IDS],
  );
  for (const category of VERB_CATEGORIES) {
    assert.ok(category.title && category.summary, `${category.id} has a title and a summary`);
    assert.ok(VERBS.some((v) => v.category === category.id), `${category.id} has at least one verb`);
  }
  for (const verb of VERBS) assert.ok(VERB_CATEGORY_IDS.includes(verb.category), `${verb.name}: ${verb.category}`);
});

test('the path-only verbs are exactly the ones the table confines to a path block', () => {
  assert.deepEqual(
    VERBS.filter((v) => v.context === 'path')
      .map((v) => v.name)
      .sort(),
    [...PATH_ONLY_VERBS].sort(),
  );
  assert.equal(specOf('through').context, 'any', 'through works inside a path block and outside one');
  for (const verb of VERBS) {
    if (verb.context !== 'path' && verb.name !== 'through') assert.equal(verb.context, 'document', verb.name);
  }
});

test('every way of writing a verb writes exactly the fields its type has', () => {
  for (const verb of VERBS) {
    const typed = INSTRUCTION_FIELDS[verb.name] as Record<string, 'required' | 'optional'>;
    assert.ok(verb.forms.length > 0, `${verb.name} has a form`);
    const written = new Set<string>();
    const always = new Map<string, number>();
    for (const form of verb.forms) {
      for (const [field, isAlways] of fieldsOf(form)) {
        written.add(field);
        if (isAlways) always.set(field, (always.get(field) ?? 0) + 1);
      }
    }
    assert.deepEqual([...written].sort(), Object.keys(typed).sort(), `${verb.name}: fields`);
    for (const [field, presence] of Object.entries(typed)) {
      const everyForm = always.get(field) === verb.forms.length;
      assert.equal(
        everyForm ? 'required' : 'optional',
        presence,
        `${verb.name}.${field}: the type says ${presence}`,
      );
    }
  }
});

test('slots are well formed', () => {
  const types = new Set(['length', 'number', 'integer', 'string', 'identifier', 'color', 'choice', 'switch', 'points', 'stops']);
  const axes = new Set(['x', 'y', 'min', 'none', 'axis']);
  for (const verb of VERBS) {
    for (const form of verb.forms) {
      for (const { slot } of slotsOf(form)) {
        const where = `${verb.name}.${slot.slot}`;
        assert.ok(types.has(slot.type), `${where}: unknown type ${slot.type}`);
        assert.ok(!['verb', 'at'].includes(slot.slot), `${where}: a reserved field name`);
        if (slot.type === 'length') assert.ok(slot.axis && axes.has(slot.axis), `${where}: a length names its percent axis`);
        else assert.equal(slot.axis, undefined, `${where}: only a length has a percent axis`);
        if (slot.type === 'choice') {
          assert.ok(slot.choices && slot.choices.length > 1, `${where}: a choice lists its words`);
          assert.equal(new Set(slot.choices).size, slot.choices.length, `${where}: no choice twice`);
        } else {
          assert.equal(slot.choices, undefined, `${where}: only a choice lists words`);
        }
        if (slot.literal) assert.ok(['number', 'integer'].includes(slot.type), `${where}: only numbers can refuse expressions`);
        if (slot.minItems !== undefined) {
          assert.equal(slot.type, 'points', `${where}: only a list of points has a minimum count`);
          assert.ok(Number.isInteger(slot.minItems) && slot.minItems >= 1, `${where}: a minimum count is a whole number`);
        }
        if (slot.axis === 'axis') assert.ok('axis' in INSTRUCTION_FIELDS[verb.name], `${where}: reads an axis field its verb has`);
      }
    }
  }
});

test('each form reads positional parts first, then clauses and flags, then its block', () => {
  for (const verb of VERBS) {
    for (const form of verb.forms) {
      const where = `${verb.name}: ${form.signature}`;
      assert.ok(form.signature.split(' ')[0] === verb.name, `${where}: starts with the verb`);
      const kinds = form.parts.map((p) => (isPositional(p) ? 0 : 'block' in p ? 2 : 1));
      assert.deepEqual(kinds, [...kinds].sort(), `${where}: part order`);
      assert.ok(kinds.filter((k) => k === 2).length <= 1, `${where}: at most one block`);
      // An optional positional slot can only trail: after it, nothing is required.
      const positional = form.parts.filter(isPositional);
      const firstOptional = positional.findIndex((p) => isSlot(p) && p.optional === true);
      if (firstOptional >= 0) {
        for (const later of positional.slice(firstOptional)) {
          assert.ok(isSlot(later) && later.optional === true, `${where}: a required part after an optional one`);
        }
      }
      const keywords = form.parts.flatMap((p) => ('clause' in p ? [p.clause] : 'flag' in p ? [p.flag] : []));
      assert.equal(new Set(keywords).size, keywords.length, `${where}: a clause or flag keyword twice`);
    }
  }
});

test('the choice lists match the model they choose from', () => {
  const choices = (verb: string, slot: string) =>
    specOf(verb)
      .forms.flatMap(slotsOf)
      .find((s) => s.slot.slot === slot)?.slot.choices;
  assert.deepEqual(choices('page', 'paper'), Object.keys(PAPER_SIZES));
  assert.deepEqual(choices('units', 'units'), [...LENGTH_UNITS]);
  assert.deepEqual(choices('tool', 'tool'), [...SCRIPT_TOOLS]);
  assert.deepEqual(choices('style', 'style'), [...STROKE_STYLES]);
  assert.deepEqual(choices('profile', 'profile'), [...STROKE_PROFILES]);
});

test('every verb has a summary and an example that uses it', () => {
  for (const verb of VERBS) {
    assert.ok(verb.summary.length > 10, `${verb.name}: summary`);
    assert.match(verb.example, new RegExp(`(^|\\n)\\s*${verb.name}\\b`), `${verb.name}: the example uses the verb`);
  }
});

test('the diagnostic table and the codes agree, level for level', () => {
  const codes = DIAGNOSTICS.map((d) => d.code);
  assert.equal(new Set(codes).size, codes.length, 'no code twice');
  assert.deepEqual([...codes].sort(), Object.keys(DIAGNOSTIC_LEVELS).sort());
  for (const d of DIAGNOSTICS) {
    assert.equal(d.level, DIAGNOSTIC_LEVELS[d.code], `${d.code}: level`);
    assert.ok(d.summary.length > 10, `${d.code}: summary`);
  }
});

test('verbSpec finds a verb and nothing else', () => {
  assert.equal(verbSpec('rect')?.category, 'shapes');
  assert.equal(verbSpec('rectangle'), undefined);
  assert.equal(verbSpec(''), undefined);
});

test('the table is written with hyphens, never em or en dashes', () => {
  assert.doesNotMatch(JSON.stringify(verbTable), /[\u2013\u2014]/);
});
