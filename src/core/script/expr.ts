/**
 * Napkin script expressions: the arithmetic inside parentheses.
 *
 * `(i * 40 + 20)`, `(width / 2 - 10mm)`, `(80 * cos(i * 30))`. An expression
 * works in the script's current units: a bare number is read in them, a number
 * with a unit is converted into them, and a number with `%` is a share of the
 * page along the axis of the argument it stands for. Names are `let` values,
 * `repeat` counters and the page's `width` and `height`. Angles are degrees,
 * clockwise, as everywhere else in the language.
 *
 * Reading and running are separate, so a malformed expression is reported at
 * its column before anything runs, and a loop runs a parsed expression rather
 * than reading its text again on every pass.
 */

import { isLengthUnit, type LengthUnit } from '../units.js';

/** A parsed expression. `index` is the offset in the source text a node starts at. */
export type ExprNode =
  | { kind: 'number'; value: number; unit: LengthUnit | '%' | null; index: number }
  | { kind: 'name'; name: string; index: number }
  | { kind: 'negate'; operand: ExprNode; index: number }
  | { kind: 'binary'; op: BinaryOperator; left: ExprNode; right: ExprNode; index: number }
  | { kind: 'call'; name: string; args: ExprNode[]; index: number };

/** The operators an expression can use between two values. */
export type BinaryOperator = '+' | '-' | '*' | '/' | '%';

/** The outcome of reading an expression: a tree, or where and why reading stopped. */
export type ExprParse =
  | { ok: true; node: ExprNode }
  | { ok: false; code: 'invalid-expression' | 'unit-unknown'; message: string; index: number };

/** A function an expression can call. */
export interface ExprFunction {
  /** How many arguments it takes; with `variadic`, the fewest. */
  arity: number;
  variadic?: boolean;
  summary: string;
  apply(args: number[]): number;
}

const RADIANS = Math.PI / 180;

/**
 * Trigonometry at exact angles should give exact answers: `sin(30)` is 0.5,
 * not 0.49999999999999994, and `cos(90)` is 0. Twelve decimal places is far
 * finer than anything drawn, and it keeps the numbers a script writes out
 * readable.
 */
function tidy(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

/** The functions an expression can call. Trigonometry is in degrees. */
export const EXPRESSION_FUNCTIONS: Readonly<Record<string, ExprFunction>> = {
  sin: { arity: 1, summary: 'The sine of an angle in degrees.', apply: ([a]) => tidy(Math.sin(a * RADIANS)) },
  cos: { arity: 1, summary: 'The cosine of an angle in degrees.', apply: ([a]) => tidy(Math.cos(a * RADIANS)) },
  tan: { arity: 1, summary: 'The tangent of an angle in degrees.', apply: ([a]) => tidy(Math.tan(a * RADIANS)) },
  sqrt: { arity: 1, summary: 'The square root.', apply: ([a]) => Math.sqrt(a) },
  abs: { arity: 1, summary: 'The value without its sign.', apply: ([a]) => Math.abs(a) },
  round: { arity: 1, summary: 'The nearest whole number.', apply: ([a]) => Math.round(a) },
  floor: { arity: 1, summary: 'The whole number at or below.', apply: ([a]) => Math.floor(a) },
  ceil: { arity: 1, summary: 'The whole number at or above.', apply: ([a]) => Math.ceil(a) },
  min: { arity: 2, variadic: true, summary: 'The smallest of two or more values.', apply: (args) => Math.min(...args) },
  max: { arity: 2, variadic: true, summary: 'The largest of two or more values.', apply: (args) => Math.max(...args) },
};

/** The names the page supplies to every expression, in the current units. */
export const PAGE_NAMES = ['width', 'height'] as const;

type Lexeme =
  | { t: 'num'; value: number; unit: string | null; index: number; end: number }
  | { t: 'name'; name: string; index: number }
  | { t: 'op'; op: BinaryOperator; index: number }
  | { t: '(' | ')' | ','; index: number };

/** Why reading stopped, thrown inside the reader and caught at its edge. */
class Stop {
  constructor(
    readonly code: 'invalid-expression' | 'unit-unknown',
    readonly message: string,
    readonly index: number,
  ) {}
}

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const LETTERS = /[A-Za-z]+/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;

/** Whether a character begins a value, which is what tells `10%3` (modulo) from `10%` (a share of the page). */
function startsOperand(ch: string | undefined): boolean {
  return ch !== undefined && /[0-9A-Za-z_.(]/.test(ch);
}

function lex(source: string): Lexeme[] {
  const out: Lexeme[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(source);
      if (!m) throw new Stop('invalid-expression', `\`${ch}\` does not start a number.`, i);
      const start = i;
      i += m[0].length;
      let unit: string | null = null;
      LETTERS.lastIndex = i;
      const letters = LETTERS.exec(source);
      if (letters) {
        unit = letters[0].toLowerCase();
        i += letters[0].length;
        if (!isLengthUnit(unit)) {
          throw new Stop(
            'unit-unknown',
            `\`${source.slice(start, i)}\`: \`${unit}\` is not a unit. The units are px, in, mm and pt, and % for a share of the page.`,
            start,
          );
        }
      } else if (source[i] === '%' && !startsOperand(source.slice(i + 1).trimStart()[0])) {
        unit = '%';
        i++;
      }
      out.push({ t: 'num', value: Number(m[0]), unit, index: start, end: i });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      NAME.lastIndex = i;
      const m = NAME.exec(source)!;
      out.push({ t: 'name', name: m[0], index: i });
      i += m[0].length;
      continue;
    }
    if ('+-*/%'.includes(ch)) {
      out.push({ t: 'op', op: ch as BinaryOperator, index: i });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === ',') {
      out.push({ t: ch, index: i });
      i++;
      continue;
    }
    throw new Stop('invalid-expression', `\`${ch}\` cannot appear in an expression.`, i);
  }
  return out;
}

/**
 * Reads an expression's source, the text between its parentheses, into a
 * tree. Operators bind the usual way: unary minus first, then `* / %`, then
 * `+ -`, each group from left to right.
 */
export function parseExpression(source: string): ExprParse {
  let lexemes: Lexeme[];
  try {
    lexemes = lex(source);
  } catch (err) {
    if (err instanceof Stop) return { ok: false, code: err.code, message: err.message, index: err.index };
    throw err;
  }
  let p = 0;
  const peek = (): Lexeme | undefined => lexemes[p];
  const endIndex = source.length;
  const describe = (lexeme: Lexeme | undefined): string => {
    if (!lexeme) return 'the end of the expression';
    if (lexeme.t === 'num') return `\`${source.slice(lexeme.index, lexeme.end)}\``;
    if (lexeme.t === 'name') return `\`${lexeme.name}\``;
    if (lexeme.t === 'op') return `\`${lexeme.op}\``;
    return `\`${lexeme.t}\``;
  };

  function sum(): ExprNode {
    let left = product();
    for (let next = peek(); next?.t === 'op' && (next.op === '+' || next.op === '-'); next = peek()) {
      p++;
      left = { kind: 'binary', op: next.op, left, right: product(), index: left.index };
    }
    return left;
  }

  function product(): ExprNode {
    let left = unary();
    for (let next = peek(); next?.t === 'op' && (next.op === '*' || next.op === '/' || next.op === '%'); next = peek()) {
      p++;
      left = { kind: 'binary', op: next.op, left, right: unary(), index: left.index };
    }
    return left;
  }

  function unary(): ExprNode {
    const next = peek();
    if (next?.t === 'op' && next.op === '-') {
      p++;
      return { kind: 'negate', operand: unary(), index: next.index };
    }
    if (next?.t === 'op' && next.op === '+') {
      p++;
      return unary();
    }
    return primary();
  }

  function primary(): ExprNode {
    const next = peek();
    if (!next) throw new Stop('invalid-expression', 'The expression ends where a number or a name was expected.', endIndex);
    if (next.t === 'num') {
      p++;
      return { kind: 'number', value: next.value, unit: next.unit as LengthUnit | '%' | null, index: next.index };
    }
    if (next.t === 'name') {
      p++;
      const fn = EXPRESSION_FUNCTIONS[next.name];
      if (peek()?.t === '(') {
        if (!fn) {
          throw new Stop(
            'invalid-expression',
            `\`${next.name}\` is not a function. The functions are ${Object.keys(EXPRESSION_FUNCTIONS).join(', ')}.`,
            next.index,
          );
        }
        p++;
        const args: ExprNode[] = [];
        if (peek()?.t !== ')') {
          args.push(sum());
          while (peek()?.t === ',') {
            p++;
            args.push(sum());
          }
        }
        if (peek()?.t !== ')') {
          throw new Stop('invalid-expression', `\`${next.name}(\` is not closed: ${describe(peek())} was found instead of \`)\`.`, peek()?.index ?? endIndex);
        }
        p++;
        const fits = fn.variadic ? args.length >= fn.arity : args.length === fn.arity;
        if (!fits) {
          const wanted = fn.variadic ? `at least ${fn.arity}` : String(fn.arity);
          throw new Stop('invalid-expression', `\`${next.name}\` takes ${wanted} argument${fn.arity === 1 && !fn.variadic ? '' : 's'}, and got ${args.length}.`, next.index);
        }
        return { kind: 'call', name: next.name, args, index: next.index };
      }
      if (fn) throw new Stop('invalid-expression', `\`${next.name}\` is a function: write \`${next.name}(...)\`.`, next.index);
      return { kind: 'name', name: next.name, index: next.index };
    }
    if (next.t === '(') {
      p++;
      const inner = sum();
      if (peek()?.t !== ')') {
        throw new Stop('invalid-expression', `A \`(\` is not closed: ${describe(peek())} was found instead of \`)\`.`, peek()?.index ?? endIndex);
      }
      p++;
      return inner;
    }
    throw new Stop('invalid-expression', `${describe(next)} is where a number or a name was expected.`, next.index);
  }

  try {
    if (lexemes.length === 0) throw new Stop('invalid-expression', 'The expression is empty.', 0);
    const node = sum();
    if (p < lexemes.length) {
      const extra = lexemes[p];
      throw new Stop('invalid-expression', `${describe(extra)} follows a complete expression; an operator is missing.`, extra.index);
    }
    return { ok: true, node };
  } catch (err) {
    if (err instanceof Stop) return { ok: false, code: err.code, message: err.message, index: err.index };
    throw err;
  }
}

/** What an expression needs from the script running it. */
export interface ExprScope {
  /** A `let` value, a `repeat` counter, or the page's `width` or `height`; `undefined` when unset. */
  lookup(name: string): number | undefined;
  /** Converts a number with a unit into the script's current units. */
  convert(value: number, unit: LengthUnit): number;
  /** Resolves a share of the page along the argument's axis, or `undefined` where the argument has none. */
  percent(value: number): number | undefined;
}

/** Why an expression could not be run, with the diagnostic code it is reported under. */
export class ExpressionError extends Error {
  constructor(
    readonly code: 'unknown-variable' | 'division-by-zero' | 'invalid-value',
    message: string,
    /** The offset in the expression's source where the problem is. */
    readonly index: number,
  ) {
    super(message);
    this.name = 'ExpressionError';
  }
}

function run(node: ExprNode, scope: ExprScope): number {
  switch (node.kind) {
    case 'number': {
      if (node.unit === null) return node.value;
      if (node.unit === '%') {
        const share = scope.percent(node.value);
        if (share === undefined) {
          throw new ExpressionError('invalid-value', `\`${node.value}%\` has no page axis to be a share of here.`, node.index);
        }
        return share;
      }
      return scope.convert(node.value, node.unit);
    }
    case 'name': {
      const value = scope.lookup(node.name);
      if (value === undefined) {
        throw new ExpressionError('unknown-variable', `\`${node.name}\` has not been set by a \`let\` or a \`repeat\`.`, node.index);
      }
      return value;
    }
    case 'negate':
      return -run(node.operand, scope);
    case 'binary': {
      const left = run(node.left, scope);
      const right = run(node.right, scope);
      if (node.op === '+') return left + right;
      if (node.op === '-') return left - right;
      if (node.op === '*') return left * right;
      if (right === 0) {
        throw new ExpressionError('division-by-zero', `The expression ${node.op === '/' ? 'divides' : 'takes a remainder'} by zero.`, node.right.index);
      }
      return node.op === '/' ? left / right : left % right;
    }
    case 'call':
      return EXPRESSION_FUNCTIONS[node.name].apply(node.args.map((arg) => run(arg, scope)));
  }
}

/** Runs a parsed expression. Throws {@link ExpressionError} when it cannot come to a finite number. */
export function evaluateExpression(node: ExprNode, scope: ExprScope): number {
  const value = run(node, scope);
  if (!Number.isFinite(value)) {
    throw new ExpressionError('invalid-value', 'The expression does not come to a finite number.', node.index);
  }
  return Object.is(value, -0) ? 0 : value;
}
