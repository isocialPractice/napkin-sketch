/**
 * The user's two menu files: how the registry merges them, what it refuses
 * and says, and how an editor's result becomes a file that holds only what
 * differs from what the app ships.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  contextItems,
  defaultRegistry,
  loadRegistry,
  menuTree,
  SHIPPED_MENU_DATA,
  whereShown,
  type MenuRegistry,
  type MenuRow,
} from '../src/core/menu/registry.js';
import {
  hasOverrides,
  planUserFiles,
  readOverridesText,
  serializeOverrides,
  shortcutOverrides,
  toolTypeOverrides,
} from '../src/core/menu/overrides.js';

const shortcuts = (entries: Record<string, unknown>) => ({ shortcuts: { version: 1, shortcuts: entries } });
const toolTypes = (entries: Record<string, unknown>) => ({ toolTypes: { version: 1, tools: entries } });

/** A menu's rows as labels, `---` for a separator. */
function labels(rows: readonly MenuRow[]): string[] {
  return rows.map((row) => (row.kind === 'separator' ? '---' : row.label));
}

function topMenu(registry: MenuRegistry, id: string): readonly MenuRow[] {
  return menuTree(registry).find((menu) => menu.id === id)!.items;
}

// ---- Shortcuts --------------------------------------------------------------------

test('with no user files the registry is the shipped one', () => {
  for (const registry of [loadRegistry(), loadRegistry({}), loadRegistry({ shortcuts: undefined, toolTypes: null })]) {
    assert.deepEqual(registry.problems, []);
    for (const tool of registry.tools) {
      assert.equal(tool.chord, tool.shippedChord, tool.id);
      assert.equal(tool.placement, tool.shippedPlacement, tool.id);
    }
  }
});

test('a chord given to one tool is taken from the tool that shipped with it', () => {
  const registry = loadRegistry(shortcuts({ mirror: 'Ctrl+J' }));
  assert.equal(registry.tool('mirror')!.chord, 'Ctrl+J');
  assert.equal(registry.tool('join-strokes')!.chord, null);
  assert.equal(registry.toolForChord('Ctrl+J'), 'mirror');
  assert.equal(registry.toolForChord('O'), null, 'the old chord runs nothing now');
  assert.deepEqual(registry.problems, ['Ctrl+J now belongs to Mirror, so Join has no shortcut.']);
});

test('null leaves a tool with no shortcut', () => {
  const registry = loadRegistry(shortcuts({ 'tool-pen': null }));
  assert.equal(registry.tool('tool-pen')!.chord, null);
  assert.equal(registry.toolForChord('P'), null);
  assert.deepEqual(registry.problems, []);
});

test('a shortcut entry that cannot be used is left out, each with a sentence', () => {
  const registry = loadRegistry(
    shortcuts({
      nope: 'Ctrl+M',
      'zoom-in': 'Ctrl+M',
      sharpen: 'Ctrl+M',
      'tool-pen': 'Ctrl+Q+W',
      'tool-marker': 'Space',
      'tool-text': 'Ctrl+Shift+I',
      'tool-copic': 42,
    }),
  );
  assert.deepEqual(registry.problems, [
    'The shortcuts file names "nope", which is not a tool, so that entry was left out.',
    'The shortcut of Zoom In cannot be changed: Electron draws this row and owns its shortcut. That entry was left out.',
    'The shortcut of Sharpen cannot be changed: it opens a submenu. That entry was left out.',
    '"Ctrl+Q+W" is not a shortcut, so Pen keeps P.',
    'Space cannot be a shortcut: Space is held to pan and to draw straight lines and quick curves. Marker keeps M.',
    'Ctrl+Shift+I belongs to Toggle Developer Tools, which Electron draws, so Text keeps T.',
    '"42" is not a shortcut, so Copic marker keeps K.',
  ]);
  for (const id of ['zoom-in', 'tool-pen', 'tool-marker', 'tool-text', 'tool-copic']) {
    assert.equal(registry.tool(id)!.chord, registry.tool(id)!.shippedChord, id);
  }
  assert.equal(registry.toolForChord('Ctrl+M'), null);
});

test('two entries asking for one chord leave it with the first', () => {
  const registry = loadRegistry(shortcuts({ mirror: 'Ctrl+M', rotate: 'ctrl+m' }));
  assert.equal(registry.tool('mirror')!.chord, 'Ctrl+M');
  assert.equal(registry.tool('rotate')!.chord, 'Ctrl+R');
  assert.deepEqual(registry.problems, ['Ctrl+M is given to both Mirror and Rotate; Mirror keeps it.']);
});

test('an alias yields to a shortcut, and goes when its tool is given another chord', () => {
  const taken = loadRegistry(shortcuts({ mirror: 'Ctrl+Y' }));
  assert.equal(taken.toolForChord('Ctrl+Y'), 'mirror');
  assert.deepEqual(taken.tool('redo')!.aliases, []);
  assert.equal(taken.tool('redo')!.chord, 'Ctrl+Shift+Z', 'an alias taken leaves the shortcut alone');

  const moved = loadRegistry(shortcuts({ redo: 'Ctrl+Alt+Z' }));
  assert.deepEqual(moved.tool('redo')!.aliases, []);
  assert.equal(moved.toolForChord('Ctrl+Y'), null);
  assert.deepEqual(defaultRegistry().tool('redo')!.aliases, ['Ctrl+Y']);
});

test('a file of another version, or of the wrong shape, is ignored and said to be', () => {
  const cases: [unknown, RegExp][] = [
    [{ version: 2, shortcuts: { mirror: 'Ctrl+M' } }, /version 2, which this build does not read/],
    ['Ctrl+M', /not a JSON object/],
    [[{ mirror: 'Ctrl+M' }], /not a JSON object/],
    [{ version: 1, shortcuts: ['Ctrl+M'] }, /"shortcuts" is not an object/],
  ];
  for (const [file, problem] of cases) {
    const registry = loadRegistry({ shortcuts: file });
    assert.equal(registry.tool('mirror')!.chord, 'O', JSON.stringify(file));
    assert.equal(registry.problems.length, 1, JSON.stringify(file));
    assert.match(registry.problems[0], problem);
  }
  assert.deepEqual(loadRegistry({ shortcuts: { version: 1 } }).problems, [], 'a file with nothing in it is fine');
});

// ---- Tool types -----------------------------------------------------------------------

test('a tool moved to another type is shown in the menus that accept it, and no longer where it was', () => {
  const registry = loadRegistry(toolTypes({ rotate: 'Composition:edit:mixed' }));
  assert.deepEqual(registry.problems, []);
  assert.equal(registry.tool('rotate')!.type, 'Composition:edit:mixed');
  assert.deepEqual(whereShown(registry, 'rotate'), [
    { menu: 'edit', position: 'top' },
    { menu: 'layers', position: 'panel' },
    { menu: 'canvas', position: 'panel' },
  ]);
  assert.deepEqual(labels(contextItems(registry, 'canvas')).slice(0, 7), [
    'Cut',
    'Copy',
    'Paste',
    'Paste in Place',
    'Duplicate',
    'Rotate…',
    '---',
  ]);
  assert.ok(!labels(topMenu(registry, 'transform')).includes('Rotate…'));
});

test('a toolbar tool put in a menu joins the block of its type', () => {
  const registry = loadRegistry(toolTypes({ 'tool-rect': 'Draw:Add:vector', 'clear-page': 'Composition:Subtract:element' }));
  assert.deepEqual(registry.problems, []);
  assert.deepEqual(labels(topMenu(registry, 'transform')).slice(0, 3), ['Vector Path', 'Rectangle', '---']);
  assert.deepEqual(labels(contextItems(registry, 'canvas')).slice(5), ['---', 'Delete', 'Clear', '---', 'Select All', 'Deselect All']);
  assert.deepEqual(labels(topMenu(registry, 'edit')).slice(9, 13), ['Delete', 'Select All', 'Clear', '---']);
});

test('a type no menu shows a row of yet opens a block of its own at the end', () => {
  const registry = loadRegistry(toolTypes({ 'tool-pen': 'Draw:Subtract:vector' }));
  const transform = labels(topMenu(registry, 'transform'));
  assert.deepEqual(transform.slice(-2), ['---', 'Pen']);
  assert.ok(!labels(topMenu(registry, 'sketch')).includes('Pen'));
});

test('null takes a tool out of every menu, and a whole submenu moves with its row', () => {
  const registry = loadRegistry(toolTypes({ mirror: null, sharpen: 'Draw:Modify:vector' }));
  assert.deepEqual(whereShown(registry, 'mirror'), []);
  assert.equal(registry.tool('mirror')!.type, 'Draw:Modify:element', 'a tool in no menu keeps its type');
  assert.deepEqual(whereShown(registry, 'sharpen-all'), [{ menu: 'sketch', position: 'top' }]);
  assert.equal(registry.tool('sharpen-all')!.type, 'Draw:Modify:vector', "a submenu row takes its parent's type");
});

test('a tool that stays where it is, or a type no tool can be given, is refused with a sentence', () => {
  const registry = loadRegistry(
    toolTypes({
      undo: 'Draw:Add:mark',
      'deselect-all': 'Composition:edit:mixed',
      'layer-up': 'Draw:Add:mark',
      quit: null,
      'quick-width': 'Draw:Add:mark',
      rotate: 'Draw:transform',
      mirror: 'Draw:Wiggle:vector',
      join: 'Draw:Add:mark',
      'join-strokes': 'Draw:Add:layer',
      'tool-pen': 7,
    }),
  );
  assert.deepEqual(registry.problems, [
    'Undo cannot be moved: it belongs to the Edit menu. That entry was left out.',
    'Deselect All cannot be moved: it is placed by hand in Canvas only. That entry was left out.',
    'Layer Up cannot be moved: it moves with the Move Layer submenu. That entry was left out.',
    'Exit cannot be moved: Electron draws this row. That entry was left out.',
    'Quick Width cannot be moved: it starts a typed entry, so it stays on the keyboard. That entry was left out.',
    '"Draw:transform" is not a type a tool can be given, so Rotate keeps its place.',
    '"Draw:Wiggle:vector" is not a type a tool can be given, so Mirror keeps its place.',
    'The tool types file names "join", which is not a tool, so that entry was left out.',
    '"Draw:Add:layer" is not a type a tool can be given, so Join keeps its place.',
    '"7" is not a type a tool can be given, so Pen keeps its place.',
  ]);
  for (const tool of registry.tools) assert.equal(tool.placement, tool.shippedPlacement, tool.id);
});

// ---- The shipped files stay as they are -----------------------------------------------

test('the shipped files are frozen, and loading a user file changes nothing in them', () => {
  const frozenAll = (value: unknown): boolean =>
    value === null || typeof value !== 'object' || (Object.isFrozen(value) && Object.values(value as object).every(frozenAll));
  assert.ok(frozenAll(SHIPPED_MENU_DATA));
  const before = JSON.stringify(SHIPPED_MENU_DATA);
  loadRegistry({ ...shortcuts({ mirror: 'Ctrl+J', 'tool-pen': null }), ...toolTypes({ rotate: 'Composition:edit:mixed', mirror: null }) });
  assert.equal(JSON.stringify(SHIPPED_MENU_DATA), before);
  assert.ok(frozenAll(defaultRegistry().tools), 'nor can a registry be changed once made');
});

// ---- An editor's result, as a file ------------------------------------------------------

test('an edit becomes a file of only the differences, which reads back as the edit', () => {
  const registry = defaultRegistry();
  const edited = { mirror: 'Ctrl+M', 'move-selection': 'Enter', 'tool-pen': null, 'join-strokes': 'ctrl+j' };
  const file = shortcutOverrides(registry, edited);
  assert.deepEqual(file, { version: 1, shortcuts: { mirror: 'Ctrl+M', 'tool-pen': null } });
  const text = serializeOverrides(file);
  assert.equal(text, '{\n  "version": 1,\n  "shortcuts": {\n    "mirror": "Ctrl+M",\n    "tool-pen": null\n  }\n}\n');
  const reread = readOverridesText(text, 'shortcuts');
  assert.equal(reread.problem, null);
  const reloaded = loadRegistry({ shortcuts: reread.value });
  assert.deepEqual(reloaded.problems, []);
  assert.equal(reloaded.tool('mirror')!.chord, 'Ctrl+M');
  assert.equal(reloaded.tool('tool-pen')!.chord, null);
  assert.equal(reloaded.tool('join-strokes')!.chord, 'Ctrl+J');
});

test('an edit that shows some rows keeps what the file held for the others', () => {
  const current = loadRegistry(shortcuts({ mirror: 'Ctrl+M' }));
  assert.deepEqual(shortcutOverrides(current, { 'tool-pen': 'Ctrl+Shift+P' }).shortcuts, {
    mirror: 'Ctrl+M',
    'tool-pen': 'Ctrl+Shift+P',
  });
  assert.deepEqual(shortcutOverrides(current, { mirror: 'O' }).shortcuts, {}, 'putting a chord back removes its entry');
});

test('a value that is not a chord is a mistake in the editor, not a file to write', () => {
  assert.throws(() => shortcutOverrides(defaultRegistry(), { mirror: 'Ctrl+Q+W' }), /not a shortcut/);
});

test('a type edit likewise keeps only what moved, with null for a tool taken out of the menus', () => {
  const file = toolTypeOverrides(defaultRegistry(), {
    rotate: 'Composition:edit:mixed',
    'tool-rect': 'Draw:Add:vector',
    'tool-vector': 'Draw:Add:vector',
    mirror: null,
    undo: 'Draw:Add:mark',
  });
  assert.deepEqual(file, {
    version: 1,
    tools: { rotate: 'Composition:edit:mixed', mirror: null, 'tool-rect': 'Draw:Add:vector' },
  });
  assert.deepEqual(loadRegistry({ toolTypes: file }).problems, []);
});

test('Reset is a file with nothing in it, which the host deletes rather than writes', () => {
  const registry = loadRegistry(shortcuts({ mirror: 'Ctrl+M' }));
  const reset = shortcutOverrides(registry, { mirror: 'O' });
  assert.equal(hasOverrides(reset), false);
  assert.equal(hasOverrides(shortcutOverrides(registry, {})), true);
  assert.equal(hasOverrides(toolTypeOverrides(defaultRegistry(), {})), false);
  assert.equal(serializeOverrides(reset), '{\n  "version": 1,\n  "shortcuts": {}\n}\n');
});

test('text that is not JSON is reported and read as nothing', () => {
  const read = readOverridesText('{ "version": 1, ', 'tool types');
  assert.equal(read.value, null);
  assert.match(read.problem ?? '', /^The tool types file is not JSON \(.+\), so it was ignored\.$/);
});

// ---- Saving an editor's result ---------------------------------------------------

test('saving plans the differences as text, and no file at all when nothing differs', () => {
  const plan = planUserFiles({}, { shortcuts: { mirror: 'Ctrl+M' } });
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.shortcuts, serializeOverrides({ version: 1, shortcuts: { mirror: 'Ctrl+M' } }));
  assert.equal(plan.toolTypes, undefined, 'a file the update does not name is left alone');
  assert.deepEqual(planUserFiles(shortcuts({ mirror: 'Ctrl+M' }), { shortcuts: { mirror: 'O' } }), { shortcuts: null, problems: [] });
  assert.deepEqual(planUserFiles(toolTypes({ mirror: null }), { toolTypes: { mirror: 'Draw:Modify:element' } }), {
    toolTypes: null,
    problems: [],
  });
  assert.deepEqual(planUserFiles({}, {}), { problems: [] }, 'an update naming neither file changes neither');
});

test('saving refuses what is not a mapping of tools to chords or types, before anything is written', () => {
  for (const update of [null, 'shortcuts', [], { shortcuts: [] }, { shortcuts: { mirror: 5 } }, { shortcuts: 'Ctrl+M' }, { toolTypes: 7 }]) {
    const plan = planUserFiles({}, update);
    assert.equal(plan.problems.length, 1, JSON.stringify(update));
    assert.equal(plan.shortcuts, undefined);
    assert.equal(plan.toolTypes, undefined);
  }
  assert.deepEqual(planUserFiles({}, { shortcuts: { nothing: 'Ctrl+M' } }).problems, [
    'The shortcuts to save name "nothing", which is not a tool.',
  ]);
  assert.deepEqual(planUserFiles({}, { shortcuts: { mirror: 'Ctrl+Q+W' } }).problems, ['"Ctrl+Q+W" is not a shortcut.']);
  assert.deepEqual(planUserFiles({}, { toolTypes: { nothing: 'Draw:Add:mark' } }).problems, [
    'The tool types to save name "nothing", which is not a tool.',
  ]);
});

test('saving refuses a result the registry would refuse or quietly rewrite, and says why', () => {
  const role = planUserFiles({}, { shortcuts: { mirror: 'F11' } });
  assert.equal(role.shortcuts, undefined);
  assert.equal(role.problems.length, 1);
  assert.ok(role.problems[0].startsWith('F11 belongs to Toggle Full Screen'), role.problems[0]);
  assert.equal(planUserFiles({}, { shortcuts: { mirror: 'Space' } }).problems.length, 1);
  // Taking a chord without the tool that held it letting go would be settled at
  // every start, with a toast each time; the editor's Accept lets go for it.
  assert.deepEqual(planUserFiles({}, { shortcuts: { 'tool-pen': 'Ctrl+R' } }).problems, [
    'Ctrl+R now belongs to Pen, so Rotate has no shortcut.',
  ]);
  assert.deepEqual(planUserFiles({}, { shortcuts: { 'tool-pen': 'Ctrl+R', rotate: null } }).problems, []);
  assert.equal(planUserFiles({}, { toolTypes: { rotate: 'Draw:nothing' } }).problems.length, 1);
});

test("saving drops a file's old mistakes rather than stopping on them", () => {
  const current = shortcuts({ nothing: 'Ctrl+M', mirror: 'Ctrl+M' });
  assert.equal(loadRegistry(current).problems.length, 1, 'the file names a tool that is not one');
  const plan = planUserFiles(current, { shortcuts: { 'tool-pen': 'Ctrl+Shift+P' } });
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(JSON.parse(plan.shortcuts as string), {
    version: 1,
    shortcuts: { mirror: 'Ctrl+M', 'tool-pen': 'Ctrl+Shift+P' },
  });
});
