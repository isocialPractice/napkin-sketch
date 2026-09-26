/**
 * A napkin script in JSON, checked: the object form a program builds.
 *
 * A program in another language builds a script as JSON rather than text, and
 * nothing about JSON says the result is a script. This checks it the way the
 * text parser checks text - the same verb table, the same value rules, the
 * same diagnostic codes - and returns the same result, so the evaluator cannot
 * tell which front end a script came through. A diagnostic points at an
 * instruction by its index path: `[3, 0]` is the first instruction in the body
 * of the fourth.
 *
 * Values come back in the form the text parser would have produced: colors in
 * lower case, expressions trimmed, `-0` as `0`, and only the fields a verb
 * has. That is what lets a script built as JSON and the same script written as
 * text compare equal.
 */

import { hasErrors, makeDiagnostic, sortDiagnostics, suggest } from './diagnostics.js';
import { VERB_ALIASES, VERB_WORDS, checkValue, formBlock, formFor, formSlots, isFlagPart, signaturesOf } from './grammar.js';
import {
  INSTRUCTION_FIELDS,
  SCRIPT_LIMITS,
  verbSpec,
  type Diagnostic,
  type DiagnosticCode,
  type Instruction,
  type Script,
  type SlotPart,
  type VerbSpec,
} from './instructions.js';
import type { ParseOptions, ParseResult } from './parse.js';
import { checkVersion } from './version.js';
import { formatNumber, isExpr, readLengthLiteral } from './values.js';

type Context = 'document' | 'path';

/** What one of a verb's fields can hold, gathered from every form that writes it. */
interface FieldRule {
  slots: SlotPart[];
  flags: Array<string | number | boolean>;
  implied: Array<string | number | boolean | null>;
  block?: 'instructions' | 'path';
}

const RULES = new Map<string, Map<string, FieldRule>>();

function rulesFor(spec: VerbSpec): Map<string, FieldRule> {
  const cached = RULES.get(spec.name);
  if (cached) return cached;
  const rules = new Map<string, FieldRule>();
  const rule = (field: string): FieldRule => {
    let found = rules.get(field);
    if (!found) {
      found = { slots: [], flags: [], implied: [] };
      rules.set(field, found);
    }
    return found;
  };
  for (const form of spec.forms) {
    for (const { slot } of formSlots(form)) {
      const r = rule(slot.slot);
      if (!r.slots.includes(slot)) r.slots.push(slot);
    }
    for (const flag of form.parts.filter(isFlagPart)) rule(flag.field).flags.push(flag.value);
    for (const [field, value] of Object.entries(form.set ?? {})) rule(field).implied.push(value);
    const block = formBlock(form);
    if (block) rule(block.field).block = block.block;
  }
  RULES.set(spec.name, rules);
  return rules;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const pathOf = (index: number[]): string => index.map((i) => `[${i}]`).join('');

/** A number or an expression as the text parser would have produced it. */
function tidyScalar(value: unknown): unknown {
  if (isExpr(value)) return { expr: value.expr.trim() };
  if (typeof value === 'number' && value === 0) return 0;
  return value;
}

/** A length as the text parser writes it: `"10mm"` rather than `"10.0MM"`. */
function tidyLength(value: unknown): unknown {
  if (typeof value !== 'string') return tidyScalar(value);
  const literal = readLengthLiteral(value);
  if (!literal) return value;
  const number = literal.value === 0 ? 0 : literal.value;
  return literal.unit === null ? number : `${formatNumber(number)}${literal.unit}`;
}

/** A value reduced to the shape its slot defines: nothing extra inside a point, a stop or an expression. */
function copyValue(slot: SlotPart, value: unknown): unknown {
  switch (slot.type) {
    case 'length':
      return tidyLength(value);
    case 'points':
      return (value as Record<string, unknown>[]).map((p) => ({ x: tidyLength(p.x), y: tidyLength(p.y) }));
    case 'stops':
      return (value as Record<string, unknown>[]).map((s) => ({
        color: String(s.color).trim().toLowerCase(),
        offset: tidyScalar(s.offset),
      }));
    case 'color':
      return String(value).trim().toLowerCase();
    default:
      return tidyScalar(value);
  }
}

class Validator {
  readonly diagnostics: Diagnostic[] = [];

  private report(code: DiagnosticCode, message: string, index: number[], verb?: string): void {
    this.diagnostics.push(makeDiagnostic(code, message, { index }, { verb }));
  }

  walk(list: unknown[], context: Context, prefix: number[], depth: number): Instruction[] {
    const out: Instruction[] = [];
    list.forEach((item, k) => {
      const index = [...prefix, k];
      const instruction = this.instruction(item, context, index, depth, prefix.length === 0 && k === 0);
      if (instruction) out.push(instruction);
    });
    return out;
  }

  private instruction(item: unknown, context: Context, index: number[], depth: number, first: boolean): Instruction | null {
    const where = pathOf(index);
    if (!isRecord(item)) {
      this.report('invalid-value', `Instruction ${where} is not an object naming its \`verb\`.`, index);
      return null;
    }
    const verb = item.verb;
    if (typeof verb !== 'string') {
      this.report('unknown-verb', `Instruction ${where} has no \`verb\`.`, index);
      return null;
    }
    const spec = verbSpec(verb);
    if (!spec) {
      const guess = suggest(verb, VERB_WORDS, VERB_ALIASES);
      this.report('unknown-verb', `\`${verb}\` is not a verb.${guess ? ` Did you mean \`${guess}\`?` : ''}`, index);
      return null;
    }
    if (context === 'path' && spec.context === 'document') {
      this.report('misplaced-verb', `\`${verb}\` cannot appear inside a \`path\` body, which holds move, to, by, curve, smooth, through and close.`, index, verb);
      return null;
    }
    if (context === 'document' && spec.context === 'path') {
      this.report('misplaced-verb', `\`${verb}\` only works inside the \`body\` of a \`path\`.`, index, verb);
      return null;
    }
    if (verb === 'napkin' && !first) {
      this.report('misplaced-verb', '`napkin` has to be the first instruction of a script.', index, verb);
      return null;
    }

    const fields = INSTRUCTION_FIELDS[spec.name] as Record<string, 'required' | 'optional'>;
    const rules = rulesFor(spec);
    const out: Record<string, unknown> = {};
    let failed = false;
    for (const [key, value] of Object.entries(item)) {
      if (key === 'verb') continue;
      if (key === 'at') {
        if (isRecord(value) && Number.isInteger(value.line) && Number.isInteger(value.column)) {
          out.at = { line: value.line, column: value.column };
        } else {
          this.report('unknown-field', `\`at\` of instruction ${where} is not \`{ "line": ..., "column": ... }\`; it is left out.`, index, verb);
        }
        continue;
      }
      const rule = rules.get(key);
      if (!(key in fields) || !rule) {
        const guess = suggest(key, Object.keys(fields));
        this.report('unknown-field', `\`${verb}\` has no field \`${key}\`; it is left out.${guess ? ` Did you mean \`${guess}\`?` : ''}`, index, verb);
        continue;
      }
      if (value === undefined || (value === null && !rule.implied.includes(null))) continue;
      const accepted = this.field(spec, rule, key, value, index, depth);
      if (!accepted.ok) {
        failed = true;
        continue;
      }
      if (accepted.value !== undefined) out[key] = accepted.value;
    }
    if (!failed) {
      for (const [key, presence] of Object.entries(fields)) {
        if (presence === 'required' && out[key] === undefined) {
          this.report('missing-argument', `\`${verb}\` at ${where} needs \`${key}\`: ${signaturesOf(spec)}.`, index, verb);
          failed = true;
        }
      }
    }
    if (!failed && !formFor(spec, out)) {
      this.report('invalid-value', `\`${verb}\` at ${where}: these fields together do not fit any way of writing it: ${signaturesOf(spec)}.`, index, verb);
      failed = true;
    }
    if (failed) return null;

    const ordered: Record<string, unknown> = { verb: spec.name };
    for (const key of Object.keys(fields)) if (out[key] !== undefined) ordered[key] = out[key];
    if (out.at) ordered.at = out.at;
    return ordered as unknown as Instruction;
  }

  private field(
    spec: VerbSpec,
    rule: FieldRule,
    key: string,
    value: unknown,
    index: number[],
    depth: number,
  ): { ok: true; value: unknown } | { ok: false } {
    const where = pathOf(index);
    if (rule.block) {
      if (!Array.isArray(value)) {
        this.report('expected-block', `\`${key}\` of \`${spec.name}\` at ${where} is a list of instructions.`, index, spec.name);
        return { ok: false };
      }
      if (depth + 1 > SCRIPT_LIMITS.depth) {
        this.report('budget-exceeded', `Bodies nest more than ${SCRIPT_LIMITS.depth} deep at ${where}.`, index, spec.name);
        return { ok: false };
      }
      return { ok: true, value: this.walk(value, rule.block === 'path' ? 'path' : 'document', index, depth + 1) };
    }
    if (rule.implied.some((v) => v === value)) return { ok: true, value };
    if (rule.slots.length === 0 && rule.flags.length > 0) {
      if (rule.flags.some((f) => f === value)) return { ok: true, value };
      // `"hidden": false` says what leaving the flag out says.
      if (value === false && rule.flags.every((f) => f === true)) return { ok: true, value: undefined };
      this.report(
        'expected-choice',
        `\`${key}\` of \`${spec.name}\` at ${where} takes ${rule.flags.map((f) => JSON.stringify(f)).join(' or ')}.`,
        index,
        spec.name,
      );
      return { ok: false };
    }
    let first: { code: DiagnosticCode; message: string } | null = null;
    for (const slot of rule.slots) {
      const problem = checkValue(slot, value);
      if (!problem) return { ok: true, value: copyValue(slot, value) };
      first ??= problem;
    }
    if (first) {
      this.report(first.code, `\`${key}\` of \`${spec.name}\` at ${where}: ${first.message}`, index, spec.name);
    } else {
      this.report(
        'invalid-value',
        `\`${key}\` of \`${spec.name}\` at ${where} takes ${rule.implied.map((v) => JSON.stringify(v)).join(' or ')}.`,
        index,
        spec.name,
      );
    }
    return { ok: false };
  }
}

/**
 * Checks a script built as JSON - an array of instructions, each an object
 * naming its `verb` - and returns it in canonical form with what was wrong.
 * Never throws. What is wrong with an instruction leaves it out; an unknown
 * field is a warning and is left out on its own.
 */
export function validateScript(input: unknown, options: ParseOptions = {}): ParseResult {
  const validator = new Validator();
  if (!Array.isArray(input)) {
    validator.diagnostics.push(
      makeDiagnostic('invalid-value', 'A script in JSON is an array of instructions, each an object naming its `verb`.'),
    );
    return { ok: false, script: [], diagnostics: validator.diagnostics };
  }
  const script = validator.walk(input, 'document', [], 0) as Script;
  const head = input[0];
  checkVersion(script, validator.diagnostics, {
    fragment: options.fragment === true || (isRecord(head) && head.verb === 'napkin'),
    whereOf: (_instruction, index) => ({ index: [index] }),
  });
  sortDiagnostics(validator.diagnostics);
  return { ok: !hasErrors(validator.diagnostics), script, diagnostics: validator.diagnostics };
}
