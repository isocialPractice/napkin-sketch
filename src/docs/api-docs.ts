/**
 * The parts of the API documentation a program writes rather than a person:
 * the tables made from the verb table and from the command line's own tables,
 * the object form's JSON Schema, and `docs/api/INDEX.json`, the map of every
 * page an agent reads first. `npm run api-docs` writes them, and
 * `test/api-docs.test.ts` fails when a file in the tree differs from what
 * this makes.
 *
 * Nothing here reads the disk. The caller hands in the pages, so the script
 * that writes and the test that checks run the same code.
 */

import { COMMAND_FLAGS, COMMAND_SUMMARIES, COMMANDS, FLAG_SUMMARIES } from '../cli/args.js';
import { EXIT, EXIT_SUMMARIES } from '../cli/draw.js';
import { SCRIPT_VERSION, VERB_CATEGORIES, VERBS } from '../core/script/instructions.js';
import { SHAPE_NAMES } from '../core/script/library.js';
import {
  betweenMarkers,
  diagnosticTableMarkdown,
  functionTableMarkdown,
  limitsTableMarkdown,
  replaceBetweenMarkers,
  roughTableMarkdown,
  shapesTableMarkdown,
  verbTablesMarkdown,
} from '../core/script/reference.js';
import { instructionsSchema } from '../core/script/schema.js';

/** A page: its path from the repository root with `/` between folders, and its text with `\n` line ends. */
export interface DocPage {
  path: string;
  text: string;
}

/** The eight categories the documentation is in, in the order the hub lists them. */
export const DOC_CATEGORIES: ReadonlyArray<{ id: string; title: string; summary: string }> = [
  {
    id: 'language',
    title: 'The napkin script language',
    summary: 'The syntax, values and expressions, the object form, every verb, and every diagnostic code.',
  },
  {
    id: 'drawing',
    title: 'Drawing with napkin script',
    summary: 'What each instruction draws: pages, layers, paint, shapes, paths, the shape library, the hand-drawn pass, text, images, links and effects.',
  },
  {
    id: 'compose',
    title: 'The graphic design API',
    summary: 'Compositions built in code - shapes, text, media, masks, gradients, effects - rendered to SVG or PNG.',
  },
  {
    id: 'output',
    title: 'Writing a drawing out',
    summary: 'SVG, PNG, PDF, .skbk and an Illustrator script from one call, the box every format is cut to, and what each format keeps.',
  },
  {
    id: 'cli',
    title: 'The napkin-sketch command line',
    summary: 'draw, check, render and verbs from a shell or any language, with --json and exit codes.',
  },
  {
    id: 'node',
    title: 'Using napkin-sketch from code',
    summary: 'The two entries, ES modules and CommonJS, types, the result object, and what throws.',
  },
  {
    id: 'interop',
    title: 'Working with other programs',
    summary: 'Illustrator and Inkscape through SVG, an Illustrator script that rebuilds a drawing, files linked from elsewhere, and what survives a round trip.',
  },
  {
    id: 'ai',
    title: 'The AI helpers',
    summary: 'The graphic-designer and scripting helpers: design languages, brand resources, scripts drawn from a request, and how an agent reads these pages.',
  },
];

/** The three root pages: the hub, the global quickstart and the global cheatsheet. */
export const HUB_PAGES = ['API.md', 'API-QUICKSTART.md', 'API-CHEATSHEET.md'] as const;

/** The three pages every category has. */
export const CATEGORY_PAGES = ['README.md', 'QUICKSTART.md', 'CHEATSHEET.md'] as const;

export const SCHEMA_PATH = 'docs/api/schema/instructions.schema.json';
export const INDEX_PATH = 'docs/api/INDEX.json';

/** The `napkin-script` skill's verb reference, which the scripting helper carries: written here, never by hand. */
export const SKILL_REFERENCE_PATH = 'ai-helper/scripting/skills/napkin-script/references/verbs.md';

/** Text made safe for a Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * The verb table's categories, by the documentation category whose pages list
 * them: the language's own structure, what draws, and what cuts the output.
 * Every verb category is in exactly one.
 */
export const VERB_GROUPS: Readonly<Record<'language' | 'drawing' | 'output', readonly string[]>> = {
  language: ['document', 'transforms', 'control'],
  drawing: ['layers', 'paint', 'shapes', 'paths', 'media', 'effects'],
  output: ['output'],
};

/** Every verb on one line, by category: how it is written and what it does. Only the categories named, when some are. */
export function verbLinesMarkdown(categories?: readonly string[]): string {
  const rows = ['| Category | Verb | Written | Does |', '| --- | --- | --- | --- |'];
  for (const category of VERB_CATEGORIES.filter((c) => !categories || categories.includes(c.id))) {
    for (const verb of VERBS.filter((v) => v.category === category.id)) {
      const written = verb.forms.map((form) => `\`${cell(form.signature)}\``).join('<br>');
      rows.push(`| ${category.title} | \`${verb.name}\` | ${written} | ${cell(verb.summary)} |`);
    }
  }
  return rows.join('\n');
}

/** The command line's commands, as its help lists them. */
export function commandsMarkdown(): string {
  const rows = ['| Command | Does |', '| --- | --- |'];
  for (const command of COMMANDS) {
    rows.push(`| \`napkin-sketch ${cell(COMMAND_SUMMARIES[command].usage)}\` | ${cell(COMMAND_SUMMARIES[command].summary)} |`);
  }
  return rows.join('\n');
}

/** Every flag of the commands, which commands take it, and what it does. */
export function commandFlagsMarkdown(): string {
  const rows = [`| Flag | ${COMMANDS.join(' | ')} | Does |`, `| --- | ${COMMANDS.map(() => ':---:').join(' | ')} | --- |`];
  for (const [flag, { value, summary }] of Object.entries(FLAG_SUMMARIES)) {
    const takes = COMMANDS.map((command) => (COMMAND_FLAGS[command].includes(flag) ? 'yes' : ''));
    rows.push(`| \`${cell(value ? `${flag} ${value}` : flag)}\` | ${takes.join(' | ')} | ${cell(summary)} |`);
  }
  return rows.join('\n');
}

/** The exit codes the commands end with, and what each means. */
export function exitCodesMarkdown(): string {
  const rows = ['| Code | Meaning |', '| --- | --- |'];
  for (const key of Object.keys(EXIT) as Array<keyof typeof EXIT>) {
    rows.push(`| \`${EXIT[key]}\` | ${cell(EXIT_SUMMARIES[key])} |`);
  }
  return rows.join('\n');
}

/** The categories, as the hub lists them, each with its three pages. */
export function categoriesMarkdown(): string {
  const rows = ['| Category | What it covers | Pages |', '| --- | --- | --- |'];
  for (const category of DOC_CATEGORIES) {
    const base = `docs/api/${category.id}`;
    rows.push(
      `| [${category.title}](${base}/README.md) | ${cell(category.summary)} | [reference](${base}/README.md), [quickstart](${base}/QUICKSTART.md), [cheatsheet](${base}/CHEATSHEET.md) |`,
    );
  }
  return rows.join('\n');
}

/** Every table a page can mark for filling in, by the name its markers carry. */
export const GENERATED_TABLES: Readonly<Record<string, () => string>> = {
  verbs: () => verbTablesMarkdown('####'),
  'verb-lines': () => verbLinesMarkdown(),
  'language-verbs': () => verbLinesMarkdown(VERB_GROUPS.language),
  'drawing-verbs': () => verbLinesMarkdown(VERB_GROUPS.drawing),
  'output-verbs': () => verbLinesMarkdown(VERB_GROUPS.output),
  diagnostics: diagnosticTableMarkdown,
  functions: functionTableMarkdown,
  limits: limitsTableMarkdown,
  shapes: shapesTableMarkdown,
  rough: roughTableMarkdown,
  commands: commandsMarkdown,
  'command-flags': commandFlagsMarkdown,
  'exit-codes': exitCodesMarkdown,
  categories: categoriesMarkdown,
};

/** A page with every table it marks filled in as the generators write it today. */
export function fillTables(text: string): string {
  let filled = text;
  for (const [name, generate] of Object.entries(GENERATED_TABLES)) {
    if (betweenMarkers(filled, name) !== null) filled = replaceBetweenMarkers(filled, name, generate());
  }
  return filled;
}

/** What kind of page a path is. */
export function pageKind(path: string): 'hub' | 'verbose' | 'quickstart' | 'cheatsheet' | 'schema' {
  if (path === SCHEMA_PATH) return 'schema';
  if (path === 'API.md') return 'hub';
  if (/(^|\/)(API-)?QUICKSTART\.md$/.test(path)) return 'quickstart';
  if (/(^|\/)(API-)?CHEATSHEET\.md$/.test(path)) return 'cheatsheet';
  return 'verbose';
}

/** The category a path is in, or null for a root page. */
export function pageCategory(path: string): string | null {
  if (path === SCHEMA_PATH) return 'language';
  return /^docs\/api\/([^/]+)\//.exec(path)?.[1] ?? null;
}

/** The page's title: its first heading. */
function titleOf(text: string): string {
  return /^# (.+)$/m.exec(text)?.[1].trim() ?? '';
}

/** True for a paragraph of nothing but links and bold labels: the line that links a page to its hub and siblings. */
export function isNavLine(paragraph: string): boolean {
  const rest = paragraph.replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/\*\*[^*]*\*\*/g, '');
  return paragraph.trim() !== '' && /^[\s·|]*$/.test(rest);
}

/**
 * The page's first paragraph of prose, on one line: what the index offers an
 * agent choosing which page to read. The line linking a page to its hub and
 * its siblings is passed over, and so are headings, lists, tables and code.
 */
function summaryOf(text: string): string {
  const paragraphs = text.replace(/```[\s\S]*?```/g, '').split(/\n\s*\n/);
  for (const paragraph of paragraphs) {
    const first = paragraph.trimStart();
    if (!first || isNavLine(paragraph) || /^(#|\||-|\*\*Contents\*\*|<!--|>|\d+\.)/.test(first)) continue;
    return paragraph.replace(/\s+/g, ' ').trim();
  }
  return '';
}

/** One page's entry in the index. */
function indexEntry(page: DocPage): Record<string, unknown> {
  const text = page.text;
  const lines = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
  const schema = page.path === SCHEMA_PATH;
  return {
    path: page.path,
    category: pageCategory(page.path),
    kind: pageKind(page.path),
    title: schema ? 'The object form as a JSON Schema' : titleOf(text),
    summary: schema
      ? 'A JSON Schema, draft-07, for a script built as JSON: check one against it before handing it over. validateScript is the full check.'
      : summaryOf(text),
    lines,
    tokens: Math.round(text.length / 4),
  };
}

/** The order pages are listed in: the hubs, then each category's three pages, then anything else. */
function pageOrder(path: string): number {
  const hub = (HUB_PAGES as readonly string[]).indexOf(path);
  if (hub >= 0) return hub;
  const category = DOC_CATEGORIES.findIndex((c) => path.startsWith(`docs/api/${c.id}/`));
  const kind = (CATEGORY_PAGES as readonly string[]).indexOf(path.slice(path.lastIndexOf('/') + 1));
  if (category >= 0 && kind >= 0) return 10 + category * 3 + kind;
  if (path === SCHEMA_PATH) return 100;
  return 1000;
}

/**
 * The index of the documentation: for every page, its path, category, kind,
 * title, first paragraph, length in lines and rough length in tokens, so an
 * agent can pick the smallest page that answers its question.
 */
export function docsIndex(pages: readonly DocPage[]): Record<string, unknown> {
  const listed = [...pages].sort((a, b) => pageOrder(a.path) - pageOrder(b.path) || a.path.localeCompare(b.path));
  return {
    description:
      'Every page of the napkin-sketch API documentation. Read a cheatsheet or a quickstart first, and a reference page when they do not answer. Written by npm run api-docs.',
    language: SCRIPT_VERSION,
    categories: DOC_CATEGORIES,
    pages: listed.map(indexEntry),
  };
}

/**
 * Every generated file as it should be: each page with its marked tables
 * filled in, the schema, and the index made from the filled pages. Pages are
 * the hubs and everything under `docs/api/`, with `\n` line ends.
 */
/**
 * The `napkin-script` skill's verb reference: every verb by category, each
 * way of writing it, what it does and an example that runs as written, then
 * the library shapes, the functions an expression can call and every
 * diagnostic code. It is made from the tables the parser reads, so the copy an
 * AI tool loads cannot describe a grammar the parser does not follow.
 */
export function skillReferenceMarkdown(): string {
  const lines = [
    '# Napkin script: every verb',
    '',
    '<!-- Generated by `npm run api-docs` from src/core/script/verbs.json. Do not edit by hand. -->',
    '',
    `Napkin script ${SCRIPT_VERSION}: ${VERBS.length} verbs in ${VERB_CATEGORIES.length} categories, each with every way of writing it, what it does, and an example that runs as written. In a form, \`<width>\` is a value to give, \`[r <radius>]\` may be left out, and \`px|in|mm|pt\` is one word of those.`,
    '',
  ];
  for (const category of VERB_CATEGORIES) {
    lines.push(`## ${category.title}`, '', category.summary, '');
    for (const verb of VERBS.filter((v) => v.category === category.id)) {
      lines.push(`### \`${verb.name}\``, '', '```text', ...verb.forms.map((form) => form.signature), '```', '', verb.summary, '', '```napkin', verb.example, '```', '');
    }
  }
  lines.push(
    '## Library shapes',
    '',
    `\`shape "<name>" at <x> <y> size <width>\` draws one of these: ${SHAPE_NAMES.map((name) => `\`${name}\``).join(', ')}.`,
    '',
    '## Functions',
    '',
    'An expression in parentheses can call these:',
    '',
    functionTableMarkdown(),
    '',
    '## Diagnostic codes',
    '',
    diagnosticTableMarkdown(),
    '',
  );
  return lines.join('\n');
}

export function generateDocs(pages: readonly DocPage[]): DocPage[] {
  const filled = pages.filter((page) => page.path.endsWith('.md')).map((page) => ({ path: page.path, text: fillTables(page.text) }));
  const schema = { path: SCHEMA_PATH, text: `${JSON.stringify(instructionsSchema(), null, 2)}\n` };
  const index = { path: INDEX_PATH, text: `${JSON.stringify(docsIndex([...filled, schema]), null, 2)}\n` };
  return [...filled, schema, index, { path: SKILL_REFERENCE_PATH, text: skillReferenceMarkdown() }];
}
