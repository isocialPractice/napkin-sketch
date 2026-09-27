/**
 * Where a menu row becomes an action: the native template's clicks, the
 * drawing window's command table, and the items of the menus drawn inside the
 * window. Each is built from the registry, and each has to hand on exactly
 * the id the row carries - or a row runs the wrong command, or none.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MenuItemConstructorOptions } from 'electron';

import {
  COMMAND_IDS,
  isHelpTopic,
  isMainCommand,
  isMenuCommand,
  MAIN_COMMAND_IDS,
  menuStateFrom,
  ROLE_COMMAND_IDS,
  SUBMENU_COMMAND_IDS,
} from '../src/core/menu/ids.js';
import { contextItems, defaultRegistry, menuTree, nativeMenus, type MenuRow, type NativeItem } from '../src/core/menu/registry.js';
import { applicationMenuTemplate, menuStructureKey, rowStates } from '../src/main/menu.js';
import { Commands, type CommandHandlers } from '../src/renderer/commands.js';
import { contextMenuItems, type ContextMenuItem } from '../src/renderer/menus.js';

const registry = defaultRegistry();

// ---- The id lists the two command tables are typed over ---------------------------------

test('the role, submenu and main-process lists are the tools the files mark so', () => {
  const tools = registry.tools;
  assert.deepEqual([...ROLE_COMMAND_IDS], tools.filter((tool) => tool.role !== null).map((tool) => tool.id));
  assert.deepEqual(
    [...SUBMENU_COMMAND_IDS],
    tools.filter((tool) => tool.children.length > 0 || tool.generate !== null).map((tool) => tool.id),
  );
  assert.deepEqual([...MAIN_COMMAND_IDS], tools.filter((tool) => tool.host === 'main').map((tool) => tool.id));
});

test('a menu command is a tool that runs, or a Help > Tool Types row', () => {
  assert.equal(isMenuCommand('cut'), true);
  assert.equal(isMenuCommand('help-verbose'), true);
  assert.equal(isMenuCommand('help-topic:transform'), true);
  for (const id of [...ROLE_COMMAND_IDS, ...SUBMENU_COMMAND_IDS, 'help-topic:', 'nope', '']) {
    assert.equal(isMenuCommand(id), false, id);
  }
  assert.equal(isHelpTopic('help-topic:layers'), true);
  assert.equal(isHelpTopic('help-topic:'), false);
  assert.equal(isMainCommand('verbose-settings'), true);
  assert.equal(isMainCommand('help-topic:pages'), true);
  assert.equal(isMainCommand('cut'), false);
});

test('a menu state from another process keeps only known questions with true or false answers', () => {
  assert.deepEqual(menuStateFrom({ noSelection: true, cannotUndo: false, stray: true, noClipboard: 'yes' }), {
    noSelection: true,
    cannotUndo: false,
  });
  assert.deepEqual(menuStateFrom(null), {});
  assert.deepEqual(menuStateFrom('noSelection'), {});
});

// ---- The native template ---------------------------------------------------------------

/** The template with every click taken off, and a list of what each click passed. */
function unclicked(items: readonly MenuItemConstructorOptions[], clicks: string[]): unknown[] {
  return items.map((item) => {
    const copy: Record<string, unknown> = { ...item };
    if (typeof item.click === 'function') {
      (item.click as () => void)();
      delete copy.click;
      assert.equal(clicks[clicks.length - 1], item.id, `the click of ${item.label} passes its own id`);
    }
    if (Array.isArray(item.submenu)) copy.submenu = unclicked(item.submenu, clicks);
    return copy;
  });
}

function unfrozen(items: readonly NativeItem[]): unknown[] {
  return items.map((item) => {
    const copy: Record<string, unknown> = { ...item };
    if ('submenu' in item && item.submenu) copy.submenu = unfrozen(item.submenu);
    return copy;
  });
}

test('the Electron template is the native menus with a click on every row that runs a command', () => {
  for (const state of [{}, { animationNotInstalled: true, noDocsSite: true, noSelection: true, historyTracking: true }]) {
    const clicks: string[] = [];
    const template = applicationMenuTemplate(registry, state, (id) => clicks.push(id));
    const shown = template.map((menu) => ({ label: menu.label, submenu: unclicked(menu.submenu as MenuItemConstructorOptions[], clicks) }));
    assert.deepEqual(
      shown,
      nativeMenus(registry, state).map((menu) => ({ label: menu.label, submenu: unfrozen(menu.submenu) })),
    );
    // Every row that runs something has a click, and nothing else does.
    const runnable: string[] = [];
    const visit = (rows: readonly MenuRow[]): void => {
      for (const row of rows) {
        if (row.kind === 'separator' || row.role !== null) continue;
        if (row.submenu) visit(row.submenu);
        else runnable.push(row.id);
      }
    };
    for (const menu of menuTree(registry, state)) visit(menu.items);
    assert.deepEqual(clicks, runnable);
    assert.ok(clicks.every((id) => isMenuCommand(id)), 'each click names a command');
  }
});

test('a role row is left to Electron, and a row that opens a submenu has no click of its own', () => {
  const template = applicationMenuTemplate(registry, {}, () => assert.fail('no click here'));
  const file = template.find((menu) => menu.label === 'File')!.submenu as MenuItemConstructorOptions[];
  assert.deepEqual(file[file.length - 1], { role: 'quit' });
  const exportRow = file.find((row) => row.label === 'Export')!;
  assert.equal(exportRow.click, undefined);
  assert.ok(Array.isArray(exportRow.submenu));
});

test('row states say which rows the state greys and checks, for every row with an id', () => {
  const states = rowStates(registry, { noSelection: true, historyTracking: true, cannotUndo: true });
  const byId = new Map(states.map((row) => [row.id, row]));
  assert.deepEqual(byId.get('cut'), { id: 'cut', enabled: false, checked: null });
  assert.deepEqual(byId.get('paste'), { id: 'paste', enabled: true, checked: null });
  assert.deepEqual(byId.get('undo'), { id: 'undo', enabled: false, checked: null });
  assert.deepEqual(byId.get('track-history'), { id: 'track-history', enabled: true, checked: true });
  assert.deepEqual(byId.get('export'), { id: 'export', enabled: true, checked: null }, 'a submenu row too');
  assert.ok(byId.has('help-topic:transform'), 'and the generated Help rows');
  assert.ok(!byId.has('quit'), 'but not a role row, which Electron owns');
  assert.equal(new Set(states.map((row) => row.id)).size, states.length, 'each row once');
});

test("only an answer that hides a row changes the menu bar's structure", () => {
  const plain = menuStructureKey(registry, {});
  assert.equal(menuStructureKey(registry, { noSelection: true, cannotUndo: true, historyTracking: true }), plain);
  assert.notEqual(menuStructureKey(registry, { animationNotInstalled: true }), plain);
  assert.notEqual(menuStructureKey(registry, { noDocsSite: true }), plain);
});

// ---- The drawing window's commands ------------------------------------------------------

/** A handler table that records which command ran. */
function recording(ran: string[]): CommandHandlers {
  return new Proxy({}, { get: (_target, key) => () => ran.push(String(key)) }) as CommandHandlers;
}

test('a command runs its handler, and a command the main process owns is handed to it', () => {
  const ran: string[] = [];
  const forwarded: string[] = [];
  const commands = new Commands(recording(ran), (id) => forwarded.push(id));
  assert.equal(commands.run('cut'), true);
  assert.equal(commands.run('tool-pen'), true);
  assert.equal(commands.run('verbose-settings'), true);
  assert.equal(commands.run('help-topic:layers'), true);
  assert.deepEqual(ran, ['cut', 'tool-pen']);
  assert.deepEqual(forwarded, ['verbose-settings', 'help-topic:layers']);
});

test('an id that names no command runs nothing', () => {
  const ran: string[] = [];
  const forwarded: string[] = [];
  const commands = new Commands(recording(ran), (id) => forwarded.push(id));
  for (const id of ['quit', 'export', 'move-layer', 'nope', '']) assert.equal(commands.run(id), false, id);
  assert.deepEqual(ran, []);
  assert.deepEqual(forwarded, []);
});

test('every command a menu row can ask for reaches a handler or the main process', () => {
  const ran: string[] = [];
  const forwarded: string[] = [];
  const commands = new Commands(recording(ran), (id) => forwarded.push(id));
  const asked = COMMAND_IDS.filter((id) => isMenuCommand(id));
  for (const id of asked) assert.equal(commands.run(id), true, id);
  assert.deepEqual([...ran, ...forwarded].sort(), [...asked].sort());
});

// ---- The menus drawn inside the window ----------------------------------------------------

test("a context menu shows each row's label, shortcut and state, and a click runs the row's command", () => {
  const ran: string[] = [];
  const items = contextMenuItems(contextItems(registry, 'canvas', { noSelection: true }), (id) => ran.push(id));
  const shown = (list: ContextMenuItem[]) =>
    list.map((item) => (item.separator ? '---' : `${item.label} [${item.chord ?? ''}]${item.disabled ? ' (disabled)' : ''}`));
  assert.deepEqual(shown(items), [
    'Cut [Ctrl+X] (disabled)',
    'Copy [Ctrl+C] (disabled)',
    'Paste [Ctrl+V]',
    'Paste in Place [Ctrl+Shift+V]',
    'Duplicate [Ctrl+D] (disabled)',
    '---',
    'Delete [Delete] (disabled)',
    '---',
    'Select All [Ctrl+A]',
    'Deselect All [Ctrl+Shift+A]',
  ]);
  items[2].action!();
  items[9].action!();
  assert.deepEqual(ran, ['paste', 'deselect-all']);
});

test('a row with a submenu opens it rather than running anything, and a Mac reads the shortcuts its own way', () => {
  const ran: string[] = [];
  const items = contextMenuItems(contextItems(registry, 'layers'), (id) => ran.push(id), { mac: true });
  const move = items.find((item) => item.label === 'Move')!;
  assert.equal(move.action, undefined);
  assert.deepEqual(
    move.items!.map((item) => `${item.label} [${item.chord}]`),
    ['Layer Up [Cmd+]]', 'Layer Down [Cmd+[]'],
  );
  move.items![1].action!();
  assert.deepEqual(ran, ['layer-down']);
});
