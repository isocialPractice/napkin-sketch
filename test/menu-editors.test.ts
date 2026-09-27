/**
 * The two menu editors, without the page. Edit Keyboard Shortcuts: the rows
 * it lists, what its shortcut cells say about a chord, how Accept settles a
 * chord taken from another tool, and what that saves - only the differences
 * from the shipped shortcuts, and no file at all once Reset to defaults is
 * accepted. Edit Tool Types: the rows that can move and the ones that cannot,
 * what a type choice says about where the tool would be listed, and the same
 * saving.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contextItems, defaultRegistry, loadRegistry, menuTree, whereShown, type MenuRegistry } from '../src/core/menu/registry.js';
import { planUserFiles } from '../src/core/menu/overrides.js';
import {
  defaultShortcutRows,
  defaultToolTypeRows,
  listedIn,
  resolveShortcuts,
  resolveToolTypes,
  shortcutEditorSpec,
  shortcutRows,
  shortcutValidator,
  toolTypeEditorSpec,
  toolTypeRows,
  toolTypeValidator,
  type ShortcutRow,
  type ToolTypeRow,
} from '../src/renderer/editors.js';

const registry = defaultRegistry();

/** The rows with some keys changed, as the popup hands them on after edits. */
function edited(rows: readonly ShortcutRow[], keys: Record<string, string | null>): ShortcutRow[] {
  return rows.map((row) => (Object.prototype.hasOwnProperty.call(keys, row.id) ? { ...row, key: keys[row.id] } : row));
}

const row = (rows: readonly ShortcutRow[], id: string): ShortcutRow => {
  const found = rows.find((each) => each.id === id);
  assert.ok(found, id);
  return found;
};

/** The registry the main process would build once the plan's file is written. */
function afterSaving(current: { shortcuts?: unknown }, mapping: Record<string, string | null>): MenuRegistry {
  const plan = planUserFiles(current, { shortcuts: mapping });
  assert.deepEqual(plan.problems, []);
  assert.notEqual(plan.shortcuts, undefined);
  return loadRegistry({ shortcuts: plan.shortcuts === null ? undefined : JSON.parse(plan.shortcuts as string) });
}

test('every tool is a row, toolbar-only ones too, in the order of the menu files', () => {
  const rows = shortcutRows(registry);
  assert.deepEqual(
    rows.map((each) => each.id),
    registry.tools.map((tool) => tool.id),
  );
  for (const each of rows) {
    const tool = registry.tool(each.id)!;
    assert.equal(each.tool, tool.name);
    assert.equal(each.type, tool.type);
    assert.equal(each.key, tool.chord);
    assert.equal(each.original, tool.chord, `${each.id} opens unchanged`);
    assert.equal(each.shipped, tool.shippedChord);
    assert.equal(each.fixed, tool.shortcutFixed);
  }
  assert.equal(row(rows, 'mirror').where, 'Transform > Mirror');
  assert.equal(row(rows, 'export-png').where, 'File > Export > PNG Image');
  assert.equal(row(rows, 'export-png').tool, 'Export PNG Image', 'the full name, since the row stands with no menu around it');
  assert.equal(row(rows, 'deselect-all').where, 'Canvas right-click menu > Deselect All');
  assert.equal(row(rows, 'tool-select').where, 'Not in a menu: the toolbar or its key runs it');
  assert.deepEqual(row(rows, 'redo').aliases, ['Ctrl+Y']);
  assert.equal(row(rows, 'zoom-in').fixed, 'Electron draws this row and owns its shortcut');
  assert.equal(row(rows, 'export').fixed, 'it opens a submenu');
  assert.equal(row(rows, 'undo').fixed, null, "Undo's place is fixed; its shortcut is not");
});

test('Reset to defaults proposes the shipped chords, and leaves the rows Electron owns alone', () => {
  const mine = loadRegistry({ shortcuts: { version: 1, shortcuts: { mirror: 'Ctrl+M', rotate: null } } });
  const rows = shortcutRows(mine);
  assert.equal(row(rows, 'mirror').key, 'Ctrl+M');
  const reset = defaultShortcutRows(rows);
  assert.equal(row(reset, 'mirror').key, 'O');
  assert.equal(row(reset, 'rotate').key, 'Ctrl+R');
  assert.equal(row(reset, 'mirror').original, 'Ctrl+M', 'what the table is compared with does not move');
  assert.equal(row(reset, 'zoom-in'), row(rows, 'zoom-in'));
});

test('a free chord is fine, and one another tool holds warns that Accept takes it', () => {
  const rows = shortcutRows(registry);
  const check = shortcutValidator(registry);
  assert.equal(check(row(rows, 'tool-pen'), 'Ctrl+M', rows), null);
  assert.deepEqual(check(row(rows, 'tool-pen'), 'Ctrl+R', rows), {
    level: 'warn',
    message: 'Used by Rotate - Accept will take it from Rotate',
  });
  // The row losing it says so, once the other row has it.
  const after = edited(rows, { 'tool-pen': 'Ctrl+R' });
  assert.deepEqual(check(row(after, 'rotate'), 'Ctrl+R', after), {
    level: 'warn',
    message: 'Pen takes Ctrl+R on Accept, so Rotate will have no shortcut',
  });
  // And the taking row, checked again as it stands, still warns.
  assert.equal(check(row(after, 'tool-pen'), 'Ctrl+R', after)?.level, 'warn');
  // A row's own chord is no clash.
  assert.equal(check(row(rows, 'rotate'), 'Ctrl+R', rows), null);
});

test('two rows both taking one chord cannot be settled, so the second is refused', () => {
  const rows = edited(shortcutRows(registry), { 'tool-pen': 'Ctrl+R' });
  assert.deepEqual(shortcutValidator(registry)(row(rows, 'mirror'), 'Ctrl+R', rows), {
    level: 'refuse',
    message: 'Pen is already given Ctrl+R here; clear it there first',
  });
});

test("Electron's own keys, and Enter for anything but Move, are refused", () => {
  const rows = shortcutRows(registry);
  const check = shortcutValidator(registry);
  assert.deepEqual(check(row(rows, 'tool-pen'), 'Ctrl+Plus', rows), {
    level: 'refuse',
    message: 'Ctrl++ belongs to Zoom In, which Electron draws',
  });
  assert.deepEqual(check(row(rows, 'tool-pen'), 'F11', rows), {
    level: 'refuse',
    message: 'F11 belongs to Toggle Full Screen, which Electron draws',
  });
  assert.deepEqual(check(row(rows, 'tool-pen'), 'Ctrl+Shift+I', rows)?.level, 'refuse');
  assert.deepEqual(check(row(rows, 'tool-pen'), 'Enter', rows), {
    level: 'refuse',
    message: 'Enter finishes a path and applies an open palette, so only Move can have it',
  });
  assert.equal(check(row(rows, 'move-selection'), 'Enter', rows), null);
  // F5 and Ctrl+Shift+R are swallowed before a reload and run what they are given, so they can be given.
  assert.equal(check(row(rows, 'tool-pen'), 'F5', rows), null);
  // On a Mac the message names the keys the Mac way.
  assert.equal(
    shortcutValidator(registry, { mac: true })(row(rows, 'tool-pen'), 'Ctrl+Plus', rows)?.message,
    'Cmd++ belongs to Zoom In, which Electron draws',
  );
});

test("another tool's hidden second shortcut warns that it will run this tool alone", () => {
  const rows = shortcutRows(registry);
  assert.deepEqual(shortcutValidator(registry)(row(rows, 'tool-pen'), 'Ctrl+Y', rows), {
    level: 'warn',
    message: 'Redo also answers Ctrl+Y - Accept gives it to Pen alone',
  });
});

test('Accept takes a chord from the row that held it, and leaves the rows Electron owns out', () => {
  const rows = shortcutRows(registry);
  const untouched = resolveShortcuts(rows);
  for (const tool of registry.tools) {
    if (tool.shortcutFixed !== null) assert.equal(tool.id in untouched, false, `${tool.id} is left out`);
    else assert.equal(untouched[tool.id], tool.chord, tool.id);
  }
  const taken = resolveShortcuts(edited(rows, { 'tool-pen': 'Ctrl+R' }));
  assert.equal(taken['tool-pen'], 'Ctrl+R');
  assert.equal(taken.rotate, null, 'Rotate is left with none');
  // A swap needs nothing taken: each has the other's chord and neither holds its own.
  const swapped = resolveShortcuts(edited(rows, { 'tool-pen': 'Ctrl+R', rotate: 'P' }));
  assert.equal(swapped['tool-pen'], 'Ctrl+R');
  assert.equal(swapped.rotate, 'P');
});

test('what Accept saves holds only the differences, and reads back as the edit with nothing to say', () => {
  const mapping = resolveShortcuts(edited(shortcutRows(registry), { 'tool-pen': 'Ctrl+R', mirror: 'Ctrl+M' }));
  const plan = planUserFiles({}, { shortcuts: mapping });
  assert.deepEqual(JSON.parse(plan.shortcuts as string), {
    version: 1,
    shortcuts: { rotate: null, mirror: 'Ctrl+M', 'tool-pen': 'Ctrl+R' },
  });
  const saved = afterSaving({}, mapping);
  assert.deepEqual(saved.problems, []);
  assert.equal(saved.tool('tool-pen')?.chord, 'Ctrl+R');
  assert.equal(saved.tool('rotate')?.chord, null);
  assert.equal(saved.tool('mirror')?.chord, 'Ctrl+M');
  assert.equal(saved.toolForChord('Ctrl+R'), 'tool-pen');
  assert.equal(saved.toolForChord('O'), null, "Mirror's old key is free");
});

test('Reset to defaults, accepted, leaves nothing to save, so the file goes', () => {
  const current = { shortcuts: { version: 1, shortcuts: { mirror: 'Ctrl+M', rotate: null, 'tool-pen': 'Ctrl+R' } } };
  const mine = loadRegistry(current);
  assert.deepEqual(mine.problems, []);
  const mapping = resolveShortcuts(defaultShortcutRows(shortcutRows(mine)));
  const plan = planUserFiles(current, { shortcuts: mapping });
  assert.deepEqual(plan, { shortcuts: null, problems: [] });
  const back = afterSaving(current, mapping);
  for (const tool of back.tools) assert.equal(tool.chord, tool.shippedChord, tool.id);
  assert.equal(back.toolForChord('Ctrl+Y'), 'redo', 'the hidden second shortcut is back too');
});

test('the spec: three columns, the six main types as radios, and Reset beside Accept', () => {
  const rows = shortcutRows(registry);
  let reset = 0;
  const spec = shortcutEditorSpec(registry, rows, { onAccept: () => {}, onReset: () => reset++ });
  assert.equal(spec.title, 'Edit Keyboard Shortcuts');
  assert.deepEqual(
    spec.columns.map((column) => `${column.heading}:${column.kind}`),
    ['Tool:text', 'Type:text', 'Keyboard Shortcut:key'],
  );
  assert.deepEqual(spec.filters?.map((filter) => filter.label), ['App', 'Composition', 'GUI', 'Draw', 'API', 'docs']);
  const draw = spec.filters!.find((filter) => filter.label === 'Draw')!;
  assert.equal(draw.test(row(rows, 'mirror')), true);
  assert.equal(draw.test(row(rows, 'undo')), false);
  const type = spec.columns[1];
  assert.ok(type.kind === 'text' && type.editable?.(rows[0]) === false, 'the type is shown in a greyed box');
  const key = spec.columns[2];
  assert.ok(key.kind === 'key');
  assert.equal(key.disabled?.(row(rows, 'zoom-in')), true);
  assert.equal(key.disabled?.(row(rows, 'mirror')), false);
  assert.equal(key.title?.(row(rows, 'zoom-in')), 'This shortcut cannot change: Electron draws this row and owns its shortcut.');
  assert.equal(key.title?.(row(rows, 'redo')), 'Ctrl+Y also runs it. Click here, then press the keys for the shortcut.');
  assert.equal(spec.columns[0].title?.(row(rows, 'mirror')), 'Transform > Mirror');
  const search = spec.search!;
  assert.ok(search.text(row(rows, 'zoom-in')).includes('Ctrl++'), 'the search finds a chord as it is shown');
  assert.ok(search.text(row(rows, 'redo')).includes('Ctrl+Y'), 'and a hidden second shortcut');
  assert.deepEqual(spec.extra?.map((button) => button.label), ['Reset to defaults']);
  void spec.extra![0].onClick();
  assert.equal(reset, 1);
});

// ---- Edit Tool Types -----------------------------------------------------------------------------

const typeRow = (rows: readonly ToolTypeRow[], id: string): ToolTypeRow => {
  const found = rows.find((each) => each.id === id);
  assert.ok(found, id);
  return found;
};

function retyped(rows: readonly ToolTypeRow[], types: Record<string, string>): ToolTypeRow[] {
  return rows.map((each) => (Object.prototype.hasOwnProperty.call(types, each.id) ? { ...each, type: types[each.id] } : each));
}

test('every tool is a row; the ones that can move carry the type the menus list them by, or none', () => {
  const rows = toolTypeRows(registry);
  assert.deepEqual(
    rows.map((each) => each.id),
    registry.tools.map((tool) => tool.id),
  );
  for (const each of rows) {
    const tool = registry.tool(each.id)!;
    assert.equal(each.fixed, tool.placementFixed, each.id);
    assert.equal(each.original, each.type, `${each.id} opens unchanged`);
    if (each.fixed === null) assert.equal(each.type, tool.placement ?? '', each.id);
    else assert.equal(each.type, tool.type, `${each.id} shows the type it keeps`);
  }
  assert.equal(typeRow(rows, 'rotate').type, 'Draw:Modify:element');
  assert.equal(typeRow(rows, 'tool-rect').type, '', 'a toolbar tool is in no menu');
  assert.equal(typeRow(rows, 'tool-rect').main, 'Draw', 'and is filed under the main type it ships with');
  assert.equal(typeRow(rows, 'rotate').key, 'Ctrl+R');
});

test('the rows the brief says may not move cannot, and say why', () => {
  const rows = toolTypeRows(registry);
  for (const id of ['edit-tool-types', 'edit-shortcuts']) {
    assert.equal(typeRow(rows, id).fixed, 'an editor stays in the Edit menu, where it can always be found', id);
  }
  assert.equal(typeRow(rows, 'zoom-in').fixed, 'Electron draws this row');
  assert.equal(typeRow(rows, 'undo').fixed, 'it belongs to the Edit menu');
  assert.equal(typeRow(rows, 'export-png').fixed, 'it moves with the Export submenu');
  assert.equal(typeRow(rows, 'quick-width').fixed, 'it starts a typed entry, so it stays on the keyboard');
  assert.equal(typeRow(rows, 'rotate').fixed, null);
});

test('a type is listed where the menus that take it are, named as a person names them', () => {
  assert.equal(listedIn(registry, 'Composition:edit:mixed'), 'Edit, Layers panel, Canvas');
  assert.equal(listedIn(registry, 'Draw:Modify:element'), 'Transform');
  assert.equal(listedIn(registry, 'App:Add:layer'), 'Layers, Layers panel');
  assert.equal(listedIn(registry, 'API:automate:mixed'), 'Automate');
  assert.equal(listedIn(registry, null), '');
});

test('a type choice says where the tool would be listed, and warns when a tool leaves every menu', () => {
  const rows = toolTypeRows(registry);
  const check = toolTypeValidator(registry);
  assert.deepEqual(check(typeRow(rows, 'rotate'), 'Composition:edit:mixed', rows), {
    level: 'ok',
    message: 'Rotate will be listed in Edit, Layers panel, Canvas',
  });
  assert.deepEqual(check(typeRow(rows, 'rotate'), 'Draw:Modify:element', rows), { level: 'ok', message: 'Listed in Transform' });
  assert.deepEqual(check(typeRow(rows, 'rotate'), '', rows), { level: 'warn', message: 'Rotate will be in no menu; Ctrl+R still runs it' });
  assert.deepEqual(check(typeRow(rows, 'add-layer'), '', rows), { level: 'warn', message: 'Add Layer will be in no menu' });
  assert.deepEqual(check(typeRow(rows, 'tool-rect'), '', rows), { level: 'ok', message: 'In no menu: the toolbar or its key runs it' });
  assert.deepEqual(check(typeRow(rows, 'tool-rect'), 'Draw:Add:vector', rows), {
    level: 'ok',
    message: 'Rectangle will be listed in Transform',
  });
  assert.equal(toolTypeValidator(registry, { mac: true })(typeRow(rows, 'rotate'), '', rows)?.message, 'Rotate will be in no menu; Cmd+R still runs it');
});

test('Accept saves the rows that can move, with null for no menu, and the menus follow', () => {
  const rows = retyped(toolTypeRows(registry), { rotate: 'Composition:edit:mixed', 'tool-rect': 'Draw:Add:vector', 'join-strokes': '' });
  const mapping = resolveToolTypes(rows);
  assert.equal('zoom-in' in mapping, false, 'a row that cannot move is left out');
  assert.equal(mapping.rotate, 'Composition:edit:mixed');
  assert.equal(mapping['tool-rect'], 'Draw:Add:vector');
  assert.equal(mapping['join-strokes'], null);
  const plan = planUserFiles({}, { toolTypes: mapping });
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(JSON.parse(plan.toolTypes as string), {
    version: 1,
    tools: { rotate: 'Composition:edit:mixed', 'join-strokes': null, 'tool-rect': 'Draw:Add:vector' },
  });
  const saved = loadRegistry({ toolTypes: JSON.parse(plan.toolTypes as string) });
  assert.deepEqual(saved.problems, []);
  assert.deepEqual(whereShown(saved, 'rotate'), [
    { menu: 'edit', position: 'top' },
    { menu: 'layers', position: 'panel' },
    { menu: 'canvas', position: 'panel' },
  ]);
  assert.deepEqual(whereShown(saved, 'join-strokes'), []);
  assert.deepEqual(whereShown(saved, 'tool-rect'), [{ menu: 'transform', position: 'top' }]);
  const panel = contextItems(saved, 'layers')
    .filter((row) => row.kind === 'item')
    .map((row) => (row.kind === 'item' ? row.id : ''));
  assert.ok(panel.indexOf('rotate') === panel.indexOf('duplicate') + 1, 'Rotate joins the clipboard block, after its rows');
  const transform = menuTree(saved).find((menu) => menu.id === 'transform')!;
  assert.equal(transform.items.some((row) => row.kind === 'item' && row.id === 'rotate'), false, 'and has left Transform');
});

test('Reset to defaults, accepted, leaves nothing to save, so the file goes', () => {
  const current = { toolTypes: { version: 1, tools: { rotate: 'Composition:edit:mixed', 'tool-rect': 'Draw:Add:vector' } } };
  const mine = loadRegistry(current);
  assert.deepEqual(mine.problems, []);
  const rows = toolTypeRows(mine);
  assert.equal(typeRow(rows, 'rotate').type, 'Composition:edit:mixed');
  const reset = defaultToolTypeRows(rows);
  assert.equal(typeRow(reset, 'rotate').type, 'Draw:Modify:element');
  assert.equal(typeRow(reset, 'tool-rect').type, '');
  assert.equal(typeRow(reset, 'rotate').original, 'Composition:edit:mixed', 'what the table is compared with does not move');
  assert.deepEqual(planUserFiles(current, { toolTypes: resolveToolTypes(reset) }), { toolTypes: null, problems: [] });
});

test('the spec: a drop-down of the types the menus take, "Not in a menu" first, and the shortcut greyed', () => {
  const rows = toolTypeRows(registry);
  let reset = 0;
  const spec = toolTypeEditorSpec(registry, rows, { onAccept: () => {}, onReset: () => reset++ });
  assert.equal(spec.title, 'Edit Tool Types');
  assert.ok(spec.hint?.includes('never what the tool does'), spec.hint);
  assert.deepEqual(
    spec.columns.map((column) => `${column.heading}:${column.kind}`),
    ['Tool:text', 'Type:select', 'Keyboard Shortcut:text'],
  );
  const type = spec.columns[1];
  assert.ok(type.kind === 'select');
  assert.deepEqual(type.options, [{ value: '', label: 'Not in a menu' }]);
  assert.deepEqual(
    type.optgroups.map((group) => `${group.label}: ${group.options.map((option) => option.value).join(' ')}`),
    [
      'App: App:Add:layer App:Modify:layer App:Subtract:layer',
      'Composition: Composition:edit:mixed Composition:Subtract:element Composition:edit:selection',
      'Draw: Draw:Add:vector Draw:Modify:element Draw:Subtract:vector Draw:Add:mark Draw:Modify:vector Draw:Subtract:mark',
      'API: API:automate:mixed',
    ],
  );
  assert.equal(type.disabled?.(typeRow(rows, 'edit-tool-types')), true);
  assert.equal(type.disabled?.(typeRow(rows, 'rotate')), false);
  assert.equal(
    type.title?.(typeRow(rows, 'edit-tool-types')),
    'This tool stays where it is: an editor stays in the Edit menu, where it can always be found.',
  );
  const key = spec.columns[2];
  assert.ok(key.kind === 'text' && key.editable?.(rows[0]) === false);
  assert.equal(key.format?.(typeRow(rows, 'zoom-in')), 'Ctrl++');
  assert.equal(key.format?.(typeRow(rows, 'tool-fill')), '');
  const draw = spec.filters!.find((filter) => filter.label === 'Draw')!;
  assert.equal(draw.test(typeRow(rows, 'tool-rect')), true, 'a tool in no menu is filed under the type it ships with');
  assert.equal(draw.test(retyped(rows, { rotate: 'Composition:edit:mixed' }).find((each) => each.id === 'rotate')!), false);
  assert.ok(spec.search!.text(typeRow(rows, 'tool-rect')).includes('Not in a menu'));
  void spec.extra![0].onClick();
  assert.equal(reset, 1);
});
