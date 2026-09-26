/**
 * The verb table as Markdown: the reference tables the documentation carries.
 *
 * Generated from `verbs.json`, the diagnostic codes, the expression
 * functions, the budget and the shape library, so a page that includes them
 * cannot describe a grammar the parser does not follow. A page marks where a table goes with a pair of comments,
 * `<!-- verbs:start -->` and `<!-- verbs:end -->`, and a test holds what is
 * between them to what these functions write.
 */

import { EXPRESSION_FUNCTIONS } from './expr.js';
import { DIAGNOSTICS, INSTRUCTION_FIELDS, SCRIPT_LIMITS, VERBS, VERB_CATEGORIES, type ScriptLimits } from './instructions.js';
import { SHAPE_LIBRARY } from './library.js';
import {
  ROUGH_ANCHOR_DRIFT_PX,
  ROUGH_BOW_PER_ROOT_PX,
  ROUGH_DRIFT_CAP,
  ROUGH_FILL_SHARE,
  ROUGH_HANDLE_STRETCH,
  ROUGH_HANDLE_TURN_DEGREES,
  ROUGH_JOIN_DRIFT,
  ROUGH_OVERSHOOT_CAP,
  ROUGH_OVERSHOOT_WIDTHS,
  ROUGH_SECOND_PASS_OPACITY,
  ROUGH_SECOND_PASS_WIDTH,
  ROUGH_WAVELENGTH_PX,
} from './rough.js';

/** Text made safe for a Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** A verb's fields in the object form, `?` marking the optional ones. */
export function verbFields(verb: string): string {
  const fields = Object.entries(INSTRUCTION_FIELDS[verb as keyof typeof INSTRUCTION_FIELDS] ?? {});
  if (fields.length === 0) return 'none';
  return fields.map(([field, presence]) => (presence === 'optional' ? `${field}?` : field)).join(', ');
}

/**
 * One table per verb category: every verb, every way of writing it, its
 * fields in the object form, and what it does.
 */
export function verbTablesMarkdown(heading = '####'): string {
  const lines: string[] = [];
  for (const category of VERB_CATEGORIES) {
    lines.push(`${heading} ${category.title}`, '', category.summary, '');
    lines.push('| Verb | Written | Fields in JSON | What it does |', '| --- | --- | --- | --- |');
    for (const verb of VERBS.filter((v) => v.category === category.id)) {
      const written = verb.forms.map((form) => `\`${cell(form.signature)}\``).join('<br>');
      lines.push(`| \`${verb.name}\` | ${written} | \`${verbFields(verb.name)}\` | ${cell(verb.summary)} |`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** Every diagnostic code, its level, and what it means. */
export function diagnosticTableMarkdown(): string {
  const lines = ['| Code | Level | Meaning |', '| --- | --- | --- |'];
  for (const d of DIAGNOSTICS) lines.push(`| \`${d.code}\` | ${d.level} | ${cell(d.summary)} |`);
  return lines.join('\n');
}

/** Every function an expression can call. */
export function functionTableMarkdown(): string {
  const lines = ['| Function | Takes | Gives |', '| --- | --- | --- |'];
  for (const [name, fn] of Object.entries(EXPRESSION_FUNCTIONS)) {
    const takes = fn.variadic ? `${fn.arity} or more numbers` : fn.arity === 1 ? 'a number' : `${fn.arity} numbers`;
    lines.push(`| \`${name}\` | ${takes} | ${cell(fn.summary)} |`);
  }
  return lines.join('\n');
}

/** What each limit of the budget counts. */
const LIMIT_MEANINGS: { readonly [K in keyof ScriptLimits]: string } = {
  instructions: 'Instructions run, every pass through a `repeat` counted',
  marks: 'Marks drawn',
  anchors: 'Bezier anchors, across every mark',
  points: 'Points sampled from those anchors for the canvas to paint',
  depth: 'Blocks open at once: groups, placed definitions and repeats',
};

/** The budget one run has, and what each limit counts. */
export function limitsTableMarkdown(): string {
  const lines = ['| Limit | Default | Counts |', '| --- | --- | --- |'];
  for (const [name, meaning] of Object.entries(LIMIT_MEANINGS)) {
    const value = String(SCRIPT_LIMITS[name as keyof ScriptLimits]).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    lines.push(`| \`${name}\` | ${value} | ${cell(meaning)} |`);
  }
  return lines.join('\n');
}

/**
 * The shape library: every name `shape` takes, its natural size, how many
 * marks it draws, and how many of those are backdrops - parts filled without
 * an outline, which show only when a fill is set.
 */
export function shapesTableMarkdown(): string {
  const lines = ['| Shape | Natural size | Marks | Backdrops | Read from |', '| --- | --- | --- | --- | --- |'];
  for (const shape of SHAPE_LIBRARY.shapes) {
    const backdrops = shape.parts.filter((part) => part.fill && !part.stroke).length;
    lines.push(
      `| \`${shape.name}\` | ${shape.width} x ${shape.height} | ${shape.parts.length} | ${backdrops || '-'} | \`${shape.source}\` |`,
    );
  }
  return lines.join('\n');
}

/** How far each part of the hand-drawn pass reaches at `rough 1`, from its measured constants. */
export function roughTableMarkdown(): string {
  const percent = (share: number): string => `${Math.round(share * 100)}%`;
  const rows: Array<[string, string]> = [
    ['Anchor drift', `Up to ${ROUGH_ANCHOR_DRIFT_PX} px, and no more than ${percent(ROUGH_DRIFT_CAP)} of the way to a neighbouring anchor`],
    [
      'Bow of a straight segment',
      `Up to ${ROUGH_BOW_PER_ROOT_PX} times the square root of its length: ${Math.round(ROUGH_BOW_PER_ROOT_PX * 100) / 10} px for a 100 px segment, ${Math.round(ROUGH_BOW_PER_ROOT_PX * 200) / 10} px for a 400 px one`,
    ],
    ["Turn of a curve's handles", `Up to ${ROUGH_HANDLE_TURN_DEGREES} degrees, both handles of an anchor alike`],
    ["Stretch of a curve's handles", `Up to ${percent(ROUGH_HANDLE_STRETCH)} longer or shorter`],
    ['Overshoot', `${ROUGH_OVERSHOOT_WIDTHS} line widths past each end, and no more than ${percent(ROUGH_OVERSHOOT_CAP)} of the segment it extends`],
    ['Join of a closed line', `Up to ${percent(ROUGH_JOIN_DRIFT)} of the anchor drift from where the line began`],
    ['Fill under a line', `Roughened ${percent(ROUGH_FILL_SHARE)} as much as the line`],
    ['Second pass', `${percent(ROUGH_SECOND_PASS_WIDTH)} of the width and ${percent(ROUGH_SECOND_PASS_OPACITY)} of the opacity`],
    ['Wobble length', `${ROUGH_WAVELENGTH_PX} px: anchors closer together than this drift together`],
  ];
  const lines = ['| Part | At `rough 1` |', '| --- | --- |'];
  for (const [part, reach] of rows) lines.push(`| ${cell(part)} | ${cell(reach)} |`);
  return lines.join('\n');
}

/** The text between `<!-- name:start -->` and `<!-- name:end -->`, or null when the markers are not there. */
export function betweenMarkers(text: string, name: string): string | null {
  const start = text.indexOf(`<!-- ${name}:start -->`);
  const end = text.indexOf(`<!-- ${name}:end -->`);
  if (start < 0 || end < start) return null;
  return text.slice(start + `<!-- ${name}:start -->`.length, end).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}

/** Puts `body` between a pair of markers, keeping the markers. Throws when they are not there. */
export function replaceBetweenMarkers(text: string, name: string, body: string): string {
  const open = `<!-- ${name}:start -->`;
  const close = `<!-- ${name}:end -->`;
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start < 0 || end < start) throw new Error(`no ${name} markers`);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const fixed = body.replace(/\r?\n/g, newline);
  return `${text.slice(0, start + open.length)}${newline}${fixed}${newline}${text.slice(end)}`;
}
