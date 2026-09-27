/**
 * The menus table and the shortcut tables on the site's Menus and shortcuts
 * page and in CHEATSHEET.md: each is what the menu registry makes of it
 * today, and each lists what it says it lists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defaultRegistry, loadRegistry } from '../src/core/menu/registry.js';
import { betweenMarkers } from '../src/core/script/reference.js';
import { fillMenuDocs, MENU_DOC_TABLES, menuPath, menusMarkdown, shortcutsMarkdown } from '../src/docs/menu-docs.js';
import { repoRoot } from './helpers/repo-root.js';

const ROOT = repoRoot();
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf-8');
const registry = defaultRegistry();
/** The page that holds the table of every shortcut. */
const SHORTCUTS_PAGE = 'docs/site-src/guide/menus-and-shortcuts.md';

/** A generated table's rows, below its header and its rule. */
function rowsOf(path: string, marker: string): string[] {
  const table = betweenMarkers(read(path), marker);
  assert.ok(table !== null, `${path} has its ${marker} markers`);
  return table.split(/\r?\n/).slice(2);
}

test('the shortcut tables are what the generator writes today (run npm run menu-docs when this fails)', () => {
  for (const path of new Set(MENU_DOC_TABLES.map((table) => table.path))) {
    const text = read(path);
    assert.equal(fillMenuDocs(path, text), text, path);
  }
});

test('the shortcut page lists every command with a shortcut, once', () => {
  assert.ok(MENU_DOC_TABLES.some((table) => table.path === SHORTCUTS_PAGE && table.marker === 'shortcuts'));
  const rows = rowsOf(SHORTCUTS_PAGE, 'shortcuts');
  const withKeys = registry.tools.filter((tool) => tool.chord !== null);
  assert.equal(rows.length, withKeys.length);
  for (const tool of withKeys) {
    assert.equal(rows.filter((row) => row.startsWith(`| ${tool.name} |`)).length, 1, tool.id);
  }
});

test('the cheatsheet Tools table lists every tool, with its key or the toolbar', () => {
  const rows = rowsOf('CHEATSHEET.md', 'shortcut-tools');
  const tools = registry.tools.filter((tool) => tool.id.startsWith('tool-'));
  assert.equal(rows.length, tools.length);
  for (const tool of tools) {
    const row = rows.find((line) => line.startsWith(`| ${tool.name} |`));
    assert.ok(row, tool.id);
    assert.ok(tool.chord === null ? row.includes('| toolbar |') : row.includes('`'), row);
  }
});

test("a command's menu path is where a reader finds it", () => {
  const path = (id: string) => menuPath(registry, registry.tool(id)!);
  assert.equal(path('cut'), 'Edit');
  assert.equal(path('sharpen-all'), 'Transform > Sharpen');
  assert.equal(path('layer-up'), 'Layers > Move Layer');
  assert.equal(path('deselect-all'), 'Canvas right-click menu');
  assert.equal(path('tool-rect'), 'Not in a menu');
});

test('a user file changes what the table says, as it changes the key', () => {
  const moved = loadRegistry({ shortcuts: { version: 1, shortcuts: { mirror: 'Ctrl+M' } } });
  const mirror = shortcutsMarkdown(moved)
    .split('\n')
    .find((row) => row.startsWith('| Mirror |'));
  assert.equal(mirror, '| Mirror | Transform | `Ctrl+M` | Horizontally or vertically, in place or as a copy |');
});

test('a table whose markers are gone is an error, not a table quietly left alone', () => {
  assert.throws(() => fillMenuDocs(SHORTCUTS_PAGE, 'no markers here'), /no menus markers/);
  assert.throws(() => fillMenuDocs(SHORTCUTS_PAGE, '<!-- menus:start -->\n<!-- menus:end -->\n'), /no shortcuts markers/);
});

test('the menus table has a row for each menu of the menu bar, with what places a tool there and what it holds', () => {
  const rows = rowsOf(SHORTCUTS_PAGE, 'menus');
  assert.deepEqual(
    rows.map((row) => row.split(' | ')[0].slice(2)),
    ['File', 'Edit', 'View', 'Transform', 'Sketch', 'Layers', 'Pages', 'Automate', 'Help'],
  );
  const row = (menu: string): string => rows.find((line) => line.startsWith(`| ${menu} |`))!;
  assert.match(row('Transform'), /^\| Transform \| `transform`, `Add:vector`, `Modify:element`, `Subtract:vector` \| Vector Path; /);
  assert.match(row('Transform'), /Close Shape: Sharp, Smooth;/);
  assert.match(row('Edit'), /Animation Mode \(once installed\)/);
  assert.match(row('Help'), /Tool Types: Transform, Draw, Pages, Layers, Automate; Source Code; Source Docs \(once the site is published\) \|$/);
});

test('a tool moved by a user file moves in the menus table too', () => {
  const moved = loadRegistry({ toolTypes: { version: 1, tools: { mirror: 'Composition:edit:mixed' } } });
  const table = menusMarkdown(moved);
  assert.doesNotMatch(table.split('\n').find((line) => line.startsWith('| Transform |'))!, /Mirror/);
  assert.match(table.split('\n').find((line) => line.startsWith('| Edit |'))!, /Mirror/);
});
