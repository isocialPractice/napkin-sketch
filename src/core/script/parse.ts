/**
 * Napkin script text to instructions.
 *
 * The grammar is the verb table. Every verb's forms in `verbs.json` say which
 * positional arguments it takes, which keyword clauses and flags may follow
 * them in any order, and whether it opens a block. The parser walks those forms
 * rather than having a function per verb, so a new verb is a row in the table
 * and a case in the evaluator, and the documentation, generated from the same
 * table, cannot describe a grammar the parser does not follow.
 *
 * Errors are collected, never thrown. A script with three typos reports three,
 * each with its line and column, and reading starts again at the next
 * instruction. An instruction with an error is left out of the result, so what
 * comes back is always a well-formed script, however much of the text it
 * covers; `ok` says whether that was all of it.
 *
 * Paint instructions may share a line: `color #1f2328 width 3 fill #ffe08a` is
 * three of them. On a line that starts with a paint verb, a paint verb where
 * the arguments of the one before end starts the next. Nothing else chains,
 * so `layer "Sky" opacity 0.8` keeps `opacity` as the layer's own.
 */

import { COLOR_WORDS, EXPECTED_CODES, VERB_ALIASES, VERB_WORDS, describeSlot, formBlock, isClausePart, isFlagPart, isSlotPart, isWordPart, signaturesOf } from './grammar.js';
import { makeDiagnostic, sortDiagnostics, suggest, hasErrors, type Where } from './diagnostics.js';
import { parseExpression } from './expr.js';
import {
  INSTRUCTION_FIELDS,
  SCRIPT_LIMITS,
  verbSpec,
  type Diagnostic,
  type DiagnosticCode,
  type Instruction,
  type PointArg,
  type Script,
  type SlotPart,
  type StopArg,
  type VerbForm,
  type VerbSpec,
} from './instructions.js';
import { tokenize, type Token } from './tokenize.js';
import { checkVersion } from './version.js';
import { PENCIL_MEDIUM_LABELS, parsePencil, pencilPaint } from '../pencil.js';
import { formatNumber, IDENTIFIER, isColor, isKnownUnit, RESERVED_NAMES, UNITS_SENTENCE } from './values.js';

/** How to read a script. */
export interface ParseOptions {
  /**
   * Read a fragment rather than a whole script: a snippet from the
   * documentation, or a block a program is assembling. A fragment is not
   * expected to begin with `napkin`, so none is warned about.
   */
  fragment?: boolean;
}

/** A script as read, and everything worth knowing about the reading. */
export interface ParseResult {
  /** True when nothing was an error: every instruction in the source is in `script`. */
  ok: boolean;
  /** The instructions that were read. Anything with an error is left out. */
  script: Script;
  /** Errors and warnings, in reading order. */
  diagnostics: Diagnostic[];
}

type Context = 'document' | 'path';

type SlotResult =
  | { kind: 'ok'; value: unknown; next: number }
  | { kind: 'nofit' }
  | { kind: 'error'; diagnostic: Diagnostic };

interface FormMatch {
  form: VerbForm;
  fields: Record<string, unknown>;
  /** The index after the last token the form read. */
  next: number;
  errors: Diagnostic[];
  /** How far the form got before its first error: what ranks one failing form above another. */
  progress: number;
}

const NOFIT: SlotResult = { kind: 'nofit' };

const isPunct = (token: Token | undefined, text: string): boolean => token?.kind === 'punct' && token.text === text;

class Parser {
  private pos = 0;
  /** Whether a top-level instruction has been read, for the rule that `napkin` comes first. */
  private started = false;
  /** Whether the text has a `napkin` line anywhere, even one with an error. */
  hadVersionLine = false;

  constructor(
    private readonly source: string,
    private readonly tokens: Token[],
    readonly diagnostics: Diagnostic[],
  ) {}

  private at(token: Token): Where {
    return { line: token.line, column: token.column };
  }

  private report(code: DiagnosticCode, message: string, token: Token, verb?: string, expected?: string): Diagnostic {
    const diagnostic = makeDiagnostic(code, message, this.at(token), { verb, expected });
    this.diagnostics.push(diagnostic);
    return diagnostic;
  }

  private problem(code: DiagnosticCode, message: string, token: Token, verb?: string, expected?: string): SlotResult {
    return { kind: 'error', diagnostic: makeDiagnostic(code, message, this.at(token), { verb, expected }) };
  }

  /** Reads instructions up to the `}` that closes `opener`, or to the end when there is none. */
  parseBody(context: Context, opener: { token: Token; verb: string | null } | null, depth: number): Instruction[] {
    const out: Instruction[] = [];
    for (;;) {
      const token = this.tokens[this.pos];
      if (token.kind === 'sep') {
        this.pos++;
        continue;
      }
      if (token.kind === 'eof') {
        if (opener) {
          const what = opener.verb ? `opened by \`${opener.verb}\`` : 'opened here';
          this.report('unclosed-block', `The block ${what} is never closed with \`}\`.`, opener.token);
        }
        return out;
      }
      if (isPunct(token, '}')) {
        this.pos++;
        if (opener) return out;
        this.report('unexpected-close', 'This `}` closes a block that was never opened.', token);
        continue;
      }
      if (isPunct(token, '{')) {
        this.report('unexpected-token', 'A `{` opens a block only at the end of an instruction that takes one.', token);
        this.pos++;
        this.parseBody('document', { token, verb: null }, depth + 1);
        continue;
      }
      this.statement(context, out, depth, opener === null);
    }
  }

  /** The index of the token that ends the instruction starting at `from`. */
  private statementEnd(from: number): number {
    let i = from;
    for (;;) {
      const token = this.tokens[i];
      if (token.kind === 'sep' || token.kind === 'eof' || isPunct(token, '{') || isPunct(token, '}')) return i;
      i++;
    }
  }

  /** Skips a block's contents without reading them, through its closing `}`. */
  private skipBlock(): void {
    let depth = 1;
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token.kind === 'eof') return;
      this.pos++;
      if (isPunct(token, '{')) depth++;
      if (isPunct(token, '}') && --depth === 0) return;
    }
  }

  /** Reads one instruction, or reports why it cannot and moves past it. */
  private statement(context: Context, out: Instruction[], depth: number, topLevel: boolean): void {
    const first = this.tokens[this.pos];
    const end = this.statementEnd(this.pos);
    const boundary = this.tokens[end];
    const opensBlock = isPunct(boundary, '{');
    // Any top-level statement counts, even one with an error: `napkin` after
    // it is not the first instruction, whatever became of the first.
    const wasStarted = this.started;
    if (topLevel) this.started = true;

    // Past a statement that cannot be used, reading its block anyway so the
    // block's own mistakes are reported too.
    const abandon = (): void => {
      this.pos = end;
      if (opensBlock) {
        this.pos++;
        if (depth + 1 > SCRIPT_LIMITS.depth) this.skipBlock();
        else this.parseBody('document', { token: boundary, verb: null }, depth + 1);
      }
    };

    if (first.kind !== 'word') {
      this.report('unexpected-token', `\`${first.text}\` cannot start an instruction; an instruction starts with a verb.`, first);
      abandon();
      return;
    }
    const name = first.text.toLowerCase();
    const spec = verbSpec(name);
    if (name === 'napkin') this.hadVersionLine = true;
    if (!spec) {
      const guess = suggest(name, VERB_WORDS, VERB_ALIASES);
      this.report('unknown-verb', `\`${first.text}\` is not a verb.${guess ? ` Did you mean \`${guess}\`?` : ''}`, first);
      abandon();
      return;
    }
    if (context === 'path' && spec.context === 'document') {
      this.report(
        'misplaced-verb',
        `\`${name}\` cannot appear inside a \`path\` block, which holds move, to, by, curve, smooth, through and close.`,
        first,
        name,
      );
      abandon();
      return;
    }
    if (context === 'document' && spec.context === 'path') {
      this.report('misplaced-verb', `\`${name}\` only works inside a \`path { ... }\` block.`, first, name);
      abandon();
      return;
    }
    if (name === 'napkin' && (!topLevel || wasStarted)) {
      this.report('misplaced-verb', '`napkin` has to be the first instruction of a script.', first, name);
      abandon();
      return;
    }

    const match = this.matchVerb(spec, this.pos + 1, end, opensBlock);
    if (match.errors.length > 0) {
      this.diagnostics.push(...match.errors);
      abandon();
      return;
    }

    if (match.next < end) {
      const left = this.tokens[match.next];
      if (this.chains(spec, match.next)) {
        out.push(this.build(spec, match.fields, first));
        this.pos = match.next;
        return;
      }
      this.report('unexpected-token', `\`${name}\` does not take \`${left.text}\` there: ${signaturesOf(spec)}.`, left, name);
      abandon();
      return;
    }

    const block = formBlock(match.form);
    this.pos = end;
    if (!block) {
      out.push(this.build(spec, match.fields, first));
      return;
    }
    this.pos = end + 1;
    if (depth + 1 > SCRIPT_LIMITS.depth) {
      this.report('budget-exceeded', `Blocks nest more than ${SCRIPT_LIMITS.depth} deep here.`, boundary, name);
      this.skipBlock();
      return;
    }
    match.fields[block.field] = this.parseBody(block.block === 'path' ? 'path' : 'document', { token: boundary, verb: name }, depth + 1);
    out.push(this.build(spec, match.fields, first));
  }

  /** Whether the token at `index` starts another paint instruction on a paint line. */
  private chains(spec: VerbSpec, index: number): boolean {
    const token = this.tokens[index];
    return spec.category === 'paint' && token.kind === 'word' && verbSpec(token.text.toLowerCase())?.category === 'paint';
  }

  /** Builds the instruction, its fields in the order the type lists them. */
  private build(spec: VerbSpec, fields: Record<string, unknown>, verbToken: Token): Instruction {
    const out: Record<string, unknown> = { verb: spec.name };
    for (const field of Object.keys(INSTRUCTION_FIELDS[spec.name])) {
      if (fields[field] !== undefined) out[field] = fields[field];
    }
    out.at = { line: verbToken.line, column: verbToken.column };
    return out as unknown as Instruction;
  }

  /**
   * Tries every form of a verb and keeps the best: one that reads the whole
   * instruction, else the one that reads the most without an error, else the
   * one that got furthest before its first error.
   */
  private matchVerb(spec: VerbSpec, from: number, end: number, opensBlock: boolean): FormMatch {
    const matches = spec.forms.map((form) => this.matchForm(spec, form, from, end, opensBlock));
    const clean = matches.filter((m) => m.errors.length === 0);
    const whole = clean.find((m) => m.next === end || this.chains(spec, m.next));
    if (whole) return whole;
    if (clean.length > 0) return clean.reduce((best, m) => (m.next > best.next ? m : best));
    return matches.reduce((best, m) => (m.progress > best.progress ? m : best));
  }

  private matchForm(spec: VerbSpec, form: VerbForm, from: number, end: number, opensBlock: boolean): FormMatch {
    const fields: Record<string, unknown> = {};
    const errors: Diagnostic[] = [];
    let progress = Infinity;
    let i = from;
    // A form that recognised the token and refused its value got further than
    // one that did not recognise it at all: `50%` is a length `page` cannot
    // take, which says more than that it is not a paper size.
    const fail = (diagnostic: Diagnostic, at: number, recognised = false): void => {
      errors.push(diagnostic);
      progress = Math.min(progress, at + (recognised ? 0.5 : 0));
    };

    for (const part of form.parts) {
      if (isWordPart(part)) {
        const token = this.tokens[i];
        if (i < end && token.kind === 'word' && token.text.toLowerCase() === part.word) {
          i++;
          continue;
        }
        const words = spec.forms.map((f) => f.parts.find(isWordPart)?.word).filter((w): w is string => !!w);
        fail(
          i < end
            ? makeDiagnostic('expected-choice', `\`${spec.name}\` did not expect \`${token.text}\` there: ${signaturesOf(spec)}.`, this.at(token), { verb: spec.name, expected: words.join('|') })
            : makeDiagnostic('missing-argument', `\`${spec.name}\` needs more: ${signaturesOf(spec)}.`, this.at(this.tokens[end]), { verb: spec.name }),
          i,
        );
        break;
      }
      if (!isSlotPart(part)) continue;
      if (i >= end) {
        if (part.optional) continue;
        fail(this.missing(spec, part, end), end);
        break;
      }
      const read = this.readSlot(spec, part, i, end);
      if (read.kind === 'ok') {
        fields[part.slot] = read.value;
        i = read.next;
        continue;
      }
      if (read.kind === 'nofit' && part.optional) continue;
      fail(read.kind === 'error' ? read.diagnostic : this.expected(spec, part, i), i, read.kind === 'error');
      break;
    }

    if (errors.length === 0) {
      const used = new Set<string>();
      const flags = form.parts.filter(isFlagPart);
      const clauses = form.parts.filter(isClausePart);
      keyed: while (i < end) {
        const token = this.tokens[i];
        if (token.kind !== 'word') break;
        const flag = flags.find((f) => this.wordsAt(f.flag, i, end));
        if (flag) {
          if (used.has(flag.flag)) {
            fail(makeDiagnostic('unexpected-token', `\`${flag.flag}\` is given twice.`, this.at(token), { verb: spec.name }), i);
            break;
          }
          used.add(flag.flag);
          fields[flag.field] = flag.value;
          i += flag.flag.split(' ').length;
          continue;
        }
        const clause = clauses.find((c) => c.clause === token.text.toLowerCase());
        if (!clause) break;
        if (used.has(clause.clause)) {
          fail(makeDiagnostic('unexpected-token', `\`${clause.clause}\` is given twice.`, this.at(token), { verb: spec.name }), i);
          break;
        }
        used.add(clause.clause);
        i++;
        for (const slot of clause.parts) {
          if (i >= end) {
            if (slot.optional) continue;
            fail(this.missing(spec, slot, end, clause.clause), end);
            break keyed;
          }
          const read = this.readSlot(spec, slot, i, end);
          if (read.kind === 'ok') {
            fields[slot.slot] = read.value;
            i = read.next;
            continue;
          }
          if (read.kind === 'nofit' && slot.optional) continue;
          fail(read.kind === 'error' ? read.diagnostic : this.expected(spec, slot, i), i, read.kind === 'error');
          break keyed;
        }
      }
      if (errors.length === 0) {
        const absent = clauses.find((c) => !c.optional && !used.has(c.clause));
        if (absent) {
          const words = [absent.clause, ...absent.parts.map((s) => (s.optional ? `[<${s.slot}>]` : `<${s.slot}>`))].join(' ');
          fail(makeDiagnostic('missing-argument', `\`${spec.name}\` needs \`${words}\`: ${signaturesOf(spec)}.`, this.at(this.tokens[i]), { verb: spec.name }), i);
        }
      }
    }

    if (errors.length === 0 && i === end) {
      const block = formBlock(form);
      if (block && !opensBlock) {
        fail(
          makeDiagnostic('expected-block', `\`${spec.name}\` needs a block: \`{\` at the end of the line, its instructions, and \`}\`.`, this.at(this.tokens[end]), { verb: spec.name }),
          end,
        );
      } else if (!block && opensBlock) {
        fail(makeDiagnostic('unexpected-token', `\`${spec.name}\` does not open a block.`, this.at(this.tokens[end]), { verb: spec.name }), end);
      }
    }

    Object.assign(fields, form.set ?? {});
    return { form, fields, next: i, errors, progress: errors.length > 0 ? progress : i };
  }

  /** Whether the words of a flag, `as marks`, stand at `i`. */
  private wordsAt(flag: string, i: number, end: number): boolean {
    const words = flag.split(' ');
    if (i + words.length > end) return false;
    return words.every((word, k) => {
      const token = this.tokens[i + k];
      return token.kind === 'word' && token.text.toLowerCase() === word;
    });
  }

  private missing(spec: VerbSpec, slot: SlotPart, end: number, clause?: string): Diagnostic {
    const what = clause ? `\`${clause}\` needs \`${slot.slot}\`` : `\`${spec.name}\` needs \`${slot.slot}\``;
    return makeDiagnostic('missing-argument', `${what}: ${signaturesOf(spec)}.`, this.at(this.tokens[end]), {
      verb: spec.name,
      expected: slot.type === 'choice' ? (slot.choices ?? []).join('|') : slot.type,
    });
  }

  private expected(spec: VerbSpec, slot: SlotPart, i: number): Diagnostic {
    const token = this.tokens[i];
    const target = slot.slot === spec.name ? `\`${spec.name}\`` : `\`${slot.slot}\` of \`${spec.name}\``;
    let message = `${target} takes ${describeSlot(slot)}, and got \`${token.text}\`.`;
    if ((slot.type === 'length' || slot.type === 'number' || slot.type === 'integer') && token.kind === 'word' && IDENTIFIER.test(token.text)) {
      message += ` To use a name, write it in parentheses: \`(${token.text})\`.`;
    }
    if (slot.type === 'choice' && token.kind === 'word') {
      const guess = suggest(token.text, slot.choices ?? []);
      if (guess) message += ` Did you mean \`${guess}\`?`;
    }
    if (slot.type === 'color' && token.kind === 'word') {
      const guess = suggest(token.text, COLOR_WORDS);
      if (guess) message += ` Did you mean \`${guess}\`?`;
    }
    return makeDiagnostic(EXPECTED_CODES[slot.type], message, this.at(token), {
      verb: spec.name,
      expected: slot.type === 'choice' ? (slot.choices ?? []).join('|') : slot.type,
    });
  }

  private readSlot(spec: VerbSpec, slot: SlotPart, i: number, end: number): SlotResult {
    const token = this.tokens[i];
    switch (slot.type) {
      case 'length':
        return this.readLength(spec, slot, slot.axis ?? 'min', i, end);
      case 'number':
      case 'integer':
        return this.readNumber(spec, slot, i, end);
      case 'string':
        return token.kind === 'string' ? { kind: 'ok', value: token.value as string, next: i + 1 } : NOFIT;
      case 'identifier':
        if (token.kind !== 'word' || !IDENTIFIER.test(token.text)) return NOFIT;
        if (RESERVED_NAMES.has(token.text)) {
          return this.problem('invalid-value', `\`${token.text}\` already means something in an expression and cannot be used as a name.`, token, spec.name);
        }
        return { kind: 'ok', value: token.text, next: i + 1 };
      case 'color':
        return this.readColor(spec, i, end);
      case 'choice': {
        if (token.kind !== 'word') return NOFIT;
        const word = token.text.toLowerCase();
        return (slot.choices ?? []).includes(word) ? { kind: 'ok', value: word, next: i + 1 } : NOFIT;
      }
      case 'switch': {
        const word = token.kind === 'word' ? token.text.toLowerCase() : '';
        if (word === 'on') return { kind: 'ok', value: true, next: i + 1 };
        if (word === 'off') return { kind: 'ok', value: false, next: i + 1 };
        return NOFIT;
      }
      case 'pencil':
        return this.readPencil(spec, i, end);
      case 'points':
        return this.readPoints(spec, slot, i, end);
      case 'stops':
        return this.readStops(spec, i, end);
    }
  }

  /**
   * A pencil: a graphite grade alone - `2B` and `4H` read as a number and a
   * unit, `HB` and `F` as words - or a medium and its grade, as two words
   * (`charcoal 4B`, `vine soft`) or one (`vine-soft`), or a string.
   */
  private readPencil(spec: VerbSpec, i: number, end: number): SlotResult {
    if (i >= end) return NOFIT;
    const text = (token: Token): string | null => {
      if (token.kind === 'number' && token.unit && Number.isInteger(token.value)) return `${token.value as number}${token.unit}`;
      if (token.kind === 'word') return token.text;
      if (token.kind === 'string') return token.value as string;
      return null;
    };
    const token = this.tokens[i];
    const first = text(token);
    if (first === null) return NOFIT;
    if (token.kind === 'word' && Object.prototype.hasOwnProperty.call(PENCIL_MEDIUM_LABELS, token.text.toLowerCase()) && i + 1 < end) {
      const grade = text(this.tokens[i + 1]);
      const both = grade === null ? null : parsePencil(`${token.text}-${grade}`);
      if (both) return { kind: 'ok', value: pencilPaint(both).name, next: i + 2 };
    }
    const one = parsePencil(first);
    if (one) return { kind: 'ok', value: pencilPaint(one).name, next: i + 1 };
    return this.problem(
      'expected-choice',
      `\`${token.text}\` is not a pencil there is: \`${spec.name}\` takes a graphite grade from \`9H\` to \`9B\`, or \`charcoal\`, \`compressed\` or \`vine\` and its grade.`,
      token,
      spec.name,
    );
  }

  private readLength(spec: VerbSpec, slot: SlotPart, axis: string, i: number, end: number): SlotResult {
    const token = this.tokens[i];
    if (i < end && isPunct(token, '(')) return this.readExpression(spec, i, end);
    if (i >= end || token.kind !== 'number') return NOFIT;
    const unit = token.unit ?? '';
    const value = token.value as number;
    if (unit === '') return { kind: 'ok', value, next: i + 1 };
    if (!isKnownUnit(unit)) {
      return this.problem('unit-unknown', `\`${token.text}\`: \`${unit}\` is not a unit. ${UNITS_SENTENCE}`, token, spec.name);
    }
    if (unit === '%' && axis === 'none') {
      return this.problem(
        'invalid-value',
        `\`${spec.name}\` cannot take a percentage for \`${slot.slot}\`: there is no page to measure it against.`,
        token,
        spec.name,
      );
    }
    return { kind: 'ok', value: `${formatNumber(value)}${unit}`, next: i + 1 };
  }

  private readNumber(spec: VerbSpec, slot: SlotPart, i: number, end: number): SlotResult {
    const token = this.tokens[i];
    if (isPunct(token, '(')) {
      if (slot.literal) {
        return this.problem('expected-number', `\`${spec.name}\` takes a plain number for \`${slot.slot}\`, not an expression.`, token, spec.name);
      }
      return this.readExpression(spec, i, end);
    }
    if (token.kind !== 'number') return NOFIT;
    if (token.unit) {
      const what = token.unit === '%' ? 'a percentage' : 'a unit';
      return this.problem(
        'expected-number',
        `\`${token.text}\`: \`${slot.slot}\` of \`${spec.name}\` is a plain number and does not take ${what}.`,
        token,
        spec.name,
      );
    }
    const value = token.value as number;
    if (slot.type === 'integer' && !Number.isInteger(value)) {
      return this.problem('expected-number', `\`${spec.name}\` expected a whole number for \`${slot.slot}\`, and got \`${token.text}\`.`, token, spec.name);
    }
    return { kind: 'ok', value, next: i + 1 };
  }

  /** The index of the `)` that closes the `(` at `i`, or -1 when it is not closed before `end`. */
  private closing(i: number, end: number): number {
    let depth = 0;
    for (let j = i; j < end; j++) {
      const token = this.tokens[j];
      if (isPunct(token, '(')) depth++;
      else if (isPunct(token, ')') && --depth === 0) return j;
    }
    return -1;
  }

  private readExpression(spec: VerbSpec, i: number, end: number): SlotResult {
    const open = this.tokens[i];
    const j = this.closing(i, end);
    if (j < 0) return this.problem('invalid-expression', 'This `(` is not closed before the end of the instruction.', open, spec.name);
    const close = this.tokens[j];
    const inner = this.source.slice(open.end, close.start);
    const lead = inner.length - inner.trimStart().length;
    const text = inner.trim();
    const parsed = parseExpression(text);
    if (!parsed.ok) {
      return {
        kind: 'error',
        diagnostic: makeDiagnostic(parsed.code, `\`(${text})\`: ${parsed.message}`, { line: open.line, column: open.column + 1 + lead + parsed.index }, { verb: spec.name }),
      };
    }
    return { kind: 'ok', value: { expr: text }, next: j + 1 };
  }

  private readColor(spec: VerbSpec, i: number, end: number): SlotResult {
    const token = this.tokens[i];
    if (i >= end) return NOFIT;
    if (token.kind === 'color') {
      if (isColor(token.text)) return { kind: 'ok', value: token.text.toLowerCase(), next: i + 1 };
      return this.problem('expected-color', `\`${token.text}\` is not a color: a hex color has 3, 4, 6 or 8 digits, such as \`#1f2328\`.`, token, spec.name);
    }
    if (token.kind !== 'word') return NOFIT;
    const name = token.text.toLowerCase();
    const open = this.tokens[i + 1];
    if (/^(rgba?|hsla?)$/.test(name) && i + 1 < end && isPunct(open, '(') && open.start === token.end) {
      const j = this.closing(i + 1, end);
      if (j < 0) return this.problem('expected-color', `\`${name}(\` is not closed.`, token, spec.name);
      const text = this.source.slice(token.start, this.tokens[j].end).toLowerCase();
      if (isColor(text)) return { kind: 'ok', value: text, next: j + 1 };
      return this.problem('expected-color', `\`${text}\` is not a color this build can paint.`, token, spec.name);
    }
    if (name === 'none' || !isColor(name)) return NOFIT;
    return { kind: 'ok', value: name, next: i + 1 };
  }

  private readPoints(spec: VerbSpec, slot: SlotPart, i: number, end: number): SlotResult {
    const points: PointArg[] = [];
    let j = i;
    for (;;) {
      const x = this.readLength(spec, slot, 'x', j, end);
      if (x.kind === 'error') return x;
      if (x.kind === 'nofit') {
        if (points.length === 0) return NOFIT;
        const token = this.tokens[j];
        return this.problem('expected-points', `\`${spec.name}\` expected another point after the comma, and got \`${token.text || 'the end of the line'}\`.`, token, spec.name);
      }
      const y = this.readLength(spec, slot, 'y', x.next, end);
      if (y.kind === 'error') return y;
      if (y.kind === 'nofit') {
        const token = this.tokens[x.next];
        return this.problem('expected-points', `\`${spec.name}\` expected a point, \`x y\`, and found only its x.`, token.kind === 'sep' || token.kind === 'eof' ? this.tokens[j] : token, spec.name);
      }
      points.push({ x: x.value as PointArg['x'], y: y.value as PointArg['y'] });
      j = y.next;
      if (j < end && isPunct(this.tokens[j], ',')) {
        j++;
        continue;
      }
      break;
    }
    const min = slot.minItems ?? 1;
    if (points.length < min) {
      return this.problem('invalid-value', `\`${spec.name}\` needs at least ${min} points, and got ${points.length}.`, this.tokens[i], spec.name);
    }
    return { kind: 'ok', value: points, next: j };
  }

  private readStops(spec: VerbSpec, i: number, end: number): SlotResult {
    const open = this.tokens[i];
    if (!isPunct(open, '(')) return NOFIT;
    const close = this.closing(i, end);
    if (close < 0) return this.problem('expected-stops', 'The list of gradient stops is not closed with `)`.', open, spec.name);
    // Split at the commas between stops, not the ones inside `rgb(...)`.
    const entries: [number, number][] = [];
    let depth = 0;
    let from = i + 1;
    for (let j = i + 1; j < close; j++) {
      const token = this.tokens[j];
      if (isPunct(token, '(')) depth++;
      else if (isPunct(token, ')')) depth--;
      else if (depth === 0 && isPunct(token, ',')) {
        entries.push([from, j]);
        from = j + 1;
      }
    }
    entries.push([from, close]);
    const stops: { color: string; offset?: StopArg['offset'] }[] = [];
    for (const [start, stop] of entries) {
      if (start >= stop) {
        return this.problem('expected-stops', 'A gradient stop is empty: each is a color, then an offset.', this.tokens[start], spec.name);
      }
      const color = this.readColor(spec, start, stop);
      if (color.kind === 'error') return color;
      if (color.kind === 'nofit') {
        return this.problem('expected-color', `A gradient stop starts with a color, and \`${this.tokens[start].text}\` is not one.`, this.tokens[start], spec.name);
      }
      let offset: StopArg['offset'] | undefined;
      let k = color.next;
      if (k < stop) {
        const token = this.tokens[k];
        if (isPunct(token, '(')) {
          const expr = this.readExpression(spec, k, stop);
          if (expr.kind !== 'ok') return expr;
          offset = expr.value as StopArg['offset'];
          k = expr.next;
        } else if (token.kind === 'number' && (token.unit === '' || token.unit === '%')) {
          offset = token.unit === '%' ? (token.value as number) / 100 : (token.value as number);
          k++;
        } else {
          return this.problem('expected-stops', `A gradient stop's offset is a number from 0 to 1, or a percentage, and \`${token.text}\` is not one.`, token, spec.name);
        }
      }
      if (k < stop) {
        return this.problem('expected-stops', `A gradient stop is a color and an offset; \`${this.tokens[k].text}\` is one thing too many.`, this.tokens[k], spec.name);
      }
      stops.push({ color: color.value as string, offset });
    }
    if (stops.length < 2) return this.problem('expected-stops', 'A gradient needs at least two stops.', open, spec.name);
    const given = stops.filter((s) => s.offset !== undefined).length;
    if (given !== 0 && given !== stops.length) {
      return this.problem('expected-stops', 'Give every gradient stop an offset, or none of them to space them evenly.', open, spec.name);
    }
    const value: StopArg[] = stops.map((s, k) => ({
      color: s.color,
      offset: s.offset ?? (stops.length === 1 ? 0 : k / (stops.length - 1)),
    }));
    return { kind: 'ok', value, next: close + 1 };
  }
}

/**
 * Reads napkin script text into instructions. Never throws: what cannot be
 * read is reported in `diagnostics` and left out of `script`.
 */
export function parseScript(source: string, options: ParseOptions = {}): ParseResult {
  const { tokens, diagnostics } = tokenize(source);
  const parser = new Parser(source, tokens, diagnostics);
  const script = parser.parseBody('document', null, 0) as Script;
  checkVersion(script, diagnostics, {
    fragment: options.fragment === true || parser.hadVersionLine,
    whereOf: (instruction: Instruction) => (instruction.at ? { line: instruction.at.line, column: instruction.at.column } : { line: 1, column: 1 }),
  });
  sortDiagnostics(diagnostics);
  return { ok: !hasErrors(diagnostics), script, diagnostics };
}
