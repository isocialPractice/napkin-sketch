/**
 * The menu and shortcut tables of the site's Menus and shortcuts page and of
 * CHEATSHEET.md, written from the menu registry, so the documentation shows
 * the menus and the keys the app has.
 *
 * `npm run menu-docs` fills each table between its markers - `<!--
 * menus:start -->` and `<!-- shortcuts:start -->` in
 * `docs/site-src/guide/menus-and-shortcuts.md` (the second was the README's
 * In-app controls, before the README became the site's front door), and
 * `<!-- shortcut-tools:start -->` under the cheatsheet's Tools - and
 * `test/menu-docs.test.ts` fails while any differs from what this writes.
 * `npm run site` then renders the page. A tool moved, a key changed in
 * `src/core/menu/shortcuts.json`, or a note changed in a tool's `summary`,
 * reaches the documentation by running it.
 */

import { displayChord } from '../core/menu/chords.js';
import type { MenuPredicate } from '../core/menu/ids.js';
import { defaultRegistry, menuPath, menuTree, type MenuRegistry, type MenuRow, type ToolInfo } from '../core/menu/registry.js';
import { DEFAULT_TOOL_ORDER } from '../core/settings.js';
import { replaceBetweenMarkers } from '../core/script/reference.js';

const PIPE = /[|]/g;
const ESCAPED_PIPE = `${String.fromCharCode(92)}|`;

/** Text for a table cell: a `|` would end the cell, so it is escaped. */
function cell(text: string): string {
  return text.replace(PIPE, ESCAPED_PIPE);
}

/** A tool's keys as the tables show them: its shortcut, then any alias, each in code. */
function keysOf(tool: ToolInfo): string {
  return [tool.chord, ...tool.aliases]
    .filter((chord): chord is string => chord !== null)
    .map((chord) => `\`${cell(displayChord(chord))}\``)
    .join(' or ');
}

/** Where a reader finds a command; it lives with the registry, which the menu editors read it from too. */
export { menuPath };

/** The Menus and shortcuts page's table: every command with a shortcut, in the order of the menu files, with where it is and what to know. */
export function shortcutsMarkdown(registry: MenuRegistry = defaultRegistry()): string {
  const rows = ['| Command | Menu | Shortcut | Notes |', '| :------ | :--- | :------- | :---- |'];
  for (const tool of registry.tools) {
    if (tool.chord === null) continue;
    rows.push(`| ${cell(tool.name)} | ${cell(menuPath(registry, tool))} | ${keysOf(tool)} | ${cell(tool.summary ?? '')} |`);
  }
  return rows.join('\n');
}

/**
 * The cheatsheet's Tools table: every command that makes a tool current, in
 * the toolbar's default order and then the rest, with its key - or `toolbar`
 * for a tool with none - and its note.
 */
export function toolsMarkdown(registry: MenuRegistry = defaultRegistry()): string {
  const toolbar = DEFAULT_TOOL_ORDER as readonly string[];
  const rest = registry.tools.map((tool) => tool.id).filter((id) => id.startsWith('tool-') && !toolbar.includes(id));
  const rows = ['| Tool | Key | Notes |', '| :--- | :-- | :---- |'];
  for (const id of [...toolbar, ...rest]) {
    const tool = registry.tool(id);
    if (!tool) continue;
    rows.push(`| ${cell(tool.name)} | ${tool.chord === null ? 'toolbar' : keysOf(tool)} | ${cell(tool.summary ?? '')} |`);
  }
  return rows.join('\n');
}

/** When the menu bar shows a row it leaves out otherwise, in the words the table says it in. */
const SHOWN_WHEN: Partial<Record<MenuPredicate, string>> = {
  animationNotInstalled: 'once installed',
  noDocsSite: 'once the site is published',
};

/** A row as the menus table names it: its label, when it shows, and a submenu's rows after a colon. */
function rowText(registry: MenuRegistry, row: MenuRow): string | null {
  if (row.kind === 'separator') return null;
  const hidden = registry.tool(row.id)?.hiddenWhen ?? null;
  const when = hidden === null ? '' : ` (${SHOWN_WHEN[hidden] ?? 'sometimes'})`;
  const inner = (row.submenu ?? []).map((child) => (child.kind === 'separator' ? null : child.label)).filter((label) => label !== null);
  return `${row.label}${when}${inner.length > 0 ? `: ${inner.join(', ')}` : ''}`;
}

/**
 * The Menus and shortcuts page's table of the menu bar: each menu, the
 * sub-types that place a tool in it - its own name first, then those it
 * takes - and the rows it holds, as the menu bar draws them, a submenu's
 * rows after a colon. Rows the bar shows only sometimes say when.
 */
export function menusMarkdown(registry: MenuRegistry = defaultRegistry()): string {
  const rows = ['| Menu | Takes | Holds |', '| :--- | :---- | :---- |'];
  for (const top of menuTree(registry)) {
    const menu = registry.menus.find((entry) => entry.id === top.id);
    if (!menu) continue;
    const takes = [menu.id, ...menu.accepts.filter((accept) => accept.when !== 'panel').map((accept) => accept.type)];
    const holds = top.items.map((row) => rowText(registry, row)).filter((text) => text !== null);
    rows.push(`| ${cell(top.label)} | ${takes.map((type) => `\`${type}\``).join(', ')} | ${cell(holds.join('; '))} |`);
  }
  return rows.join('\n');
}

/** A table the generator writes: the file, the name of the markers it sits between, and what goes there. */
export interface MenuDocTable {
  readonly path: string;
  readonly marker: string;
  readonly render: (registry: MenuRegistry) => string;
}

/** Every table the generator writes. */
export const MENU_DOC_TABLES: readonly MenuDocTable[] = [
  { path: 'docs/site-src/guide/menus-and-shortcuts.md', marker: 'menus', render: menusMarkdown },
  { path: 'docs/site-src/guide/menus-and-shortcuts.md', marker: 'shortcuts', render: shortcutsMarkdown },
  { path: 'CHEATSHEET.md', marker: 'shortcut-tools', render: toolsMarkdown },
];

/**
 * A file's text with each of its tables written as the registry gives them
 * today, in the file's own line endings. Throws when a table's markers are
 * missing, since a table nobody can find is a table that stops being written.
 */
export function fillMenuDocs(path: string, text: string, registry: MenuRegistry = defaultRegistry()): string {
  let filled = text;
  for (const table of MENU_DOC_TABLES) {
    if (table.path === path) filled = replaceBetweenMarkers(filled, table.marker, table.render(registry));
  }
  return filled;
}
