/**
 * Instructions to napkin script text: the canonical way of writing a script.
 *
 * One instruction to a line, a block's contents indented by two spaces,
 * clauses and flags in the order the verb table lists them, and numbers as
 * short as they will go. Reading the text back gives the same instructions,
 * which is what makes text a faithful view of a script built as JSON, and a
 * recorded session a script somebody can read and edit.
 */

import { formBlock, formFor, isClausePart, isFlagPart, isSlotPart, isWordPart } from './grammar.js';
import { verbSpec, type Instruction, type PointArg, type SlotPart, type StopArg } from './instructions.js';
import { formatNumber, isExpr, quoteString } from './values.js';

/** How to write a script. */
export interface FormatOptions {
  /** What one level of a block is indented by. Two spaces unless given. */
  indent?: string;
}

function scalar(value: unknown): string {
  if (isExpr(value)) return `(${value.expr})`;
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

function formatValue(slot: SlotPart, value: unknown): string {
  if (isExpr(value)) return `(${value.expr})`;
  switch (slot.type) {
    case 'string':
      return quoteString(String(value));
    case 'switch':
      return value ? 'on' : 'off';
    case 'points':
      return (value as PointArg[]).map((point) => `${scalar(point.x)} ${scalar(point.y)}`).join(', ');
    case 'stops':
      return `(${(value as StopArg[]).map((stop) => `${stop.color} ${scalar(stop.offset)}`).join(', ')})`;
    default:
      return scalar(value);
  }
}

function write(list: readonly Instruction[], level: number, indent: string, lines: string[]): void {
  for (const instruction of list) {
    const record = instruction as unknown as Record<string, unknown>;
    const spec = verbSpec(String(record.verb));
    if (!spec) {
      throw new Error(`formatScript: \`${String(record.verb)}\` is not a verb. Check a script with validateScript before writing it.`);
    }
    const form = formFor(spec, record);
    if (!form) {
      throw new Error(
        `formatScript: a \`${spec.name}\` instruction does not fit any way of writing it. Check a script with validateScript before writing it.`,
      );
    }
    const words: string[] = [spec.name];
    for (const part of form.parts) {
      if (isWordPart(part)) words.push(part.word);
      else if (isSlotPart(part) && record[part.slot] !== undefined) words.push(formatValue(part, record[part.slot]));
    }
    for (const part of form.parts) {
      if (isClausePart(part)) {
        const given = part.parts.filter((slot) => record[slot.slot] !== undefined);
        if (given.length > 0) words.push(part.clause, ...given.map((slot) => formatValue(slot, record[slot.slot])));
      } else if (isFlagPart(part) && record[part.field] === part.value) {
        words.push(part.flag);
      }
    }
    const pad = indent.repeat(level);
    const block = formBlock(form);
    if (block) {
      lines.push(`${pad}${words.join(' ')} {`);
      write(record[block.field] as Instruction[], level + 1, indent, lines);
      lines.push(`${pad}}`);
    } else {
      lines.push(`${pad}${words.join(' ')}`);
    }
  }
}

/**
 * Writes instructions as napkin script text, ending in a newline. Throws on an
 * instruction no form of its verb can write; `validateScript` reports those
 * as diagnostics instead, and a script it returns always formats.
 */
export function formatScript(script: readonly Instruction[], options: FormatOptions = {}): string {
  const lines: string[] = [];
  write(script, 0, options.indent ?? '  ', lines);
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}
