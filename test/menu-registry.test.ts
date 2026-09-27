/**
 * The menu registry: the shipped files hold together, the menus generated
 * from them are the menus the app had before 1.0.0-alpha.4.5.0 with exactly
 * the documented changes, and the menu bar is the one 1.0.0-alpha.4.5.0 sets
 * out.
 *
 * The characterization below writes the old menus out verbatim - the native
 * template from `src/main/main.ts` and the item lists from
 * `src/renderer/renderer.ts` as they stood - and applies each deliberate
 * change to them in code, one named step at a time. Anything else that
 * differs is a regression.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { displayChord } from '../src/core/menu/chords.js';
import { COMMAND_IDS, MENU_PREDICATES, type MenuState } from '../src/core/menu/ids.js';
import {
  chordConflict,
  contextItems,
  defaultRegistry,
  helpTopics,
  menuTree,
  nativeMenus,
  placeableTypes,
  placesFor,
  SHIPPED_MENU_DATA,
  validateMenuData,
  whereShown,
  type MenuData,
  type MenuRow,
  type NativeItem,
} from '../src/core/menu/registry.js';

const registry = defaultRegistry();

// ---- The shipped files -------------------------------------------------------

test('the shipped files have nothing wrong with them', () => {
  assert.deepEqual(validateMenuData(), []);
  assert.deepEqual(registry.problems, []);
});

test('COMMAND_IDS lists the tools of tool-types.json, in order', () => {
  assert.deepEqual(
    SHIPPED_MENU_DATA.toolTypes.tools.map((tool) => tool.id),
    [...COMMAND_IDS],
  );
});

test('every question a row asks is one the host answers, and every question is asked', () => {
  const asked = new Set<string>();
  for (const tool of SHIPPED_MENU_DATA.toolTypes.tools) {
    for (const question of [tool.disabledWhen, tool.hiddenWhen, tool.checked]) if (question) asked.add(question);
  }
  assert.deepEqual([...asked].sort(), [...MENU_PREDICATES].sort());
});

/** A copy of the shipped files with one thing broken, and what the check says about it. */
function broken(edit: (data: MenuData) => void): string {
  const data = structuredClone(SHIPPED_MENU_DATA) as MenuData;
  edit(data);
  return validateMenuData(data).join('\n');
}

test('the check on the files finds each thing it is there to find', () => {
  const tool = (data: MenuData, id: string) => data.toolTypes.tools.find((spec) => spec.id === id)!;
  assert.match(broken((d) => d.toolTypes.tools.push({ ...tool(d, 'cut') })), /The tool cut is declared twice/);
  assert.match(broken((d) => (tool(d, 'cut').type = 'Composition:edit:wobbly')), /names no sub-type and no menu/);
  assert.match(broken((d) => (tool(d, 'cut').type = 'Draw:edit:mixed')), /edit:mixed belongs to Composition/);
  assert.match(broken((d) => (tool(d, 'undo').type = 'Draw:edit')), /the edit menu is Composition/);
  assert.match(broken((d) => delete tool(d, 'rotate').group), /rotate is in a menu and has no group/);
  assert.match(broken((d) => (tool(d, 'cut').disabledWhen = 'isTuesday')), /not a question the menus ask/);
  assert.match(broken((d) => (tool(d, 'layer-up').type = 'App:Modify:layer')), /takes its parent's type/);
  assert.match(broken((d) => (tool(d, 'cut').only = ['kitchen'])), /kitchen, which is not a menu/);
  assert.match(broken((d) => (tool(d, 'quit').role = 'reload')), /the role reload/);
  assert.match(broken((d) => (tool(d, 'layer-up').parent = 'layer-down')), /layer-down, which/);
  assert.match(broken((d) => (d.shortcuts.shortcuts.cut = 'ctrl+x')), /not written canonically \(Ctrl\+X\)/);
  assert.match(broken((d) => (d.shortcuts.shortcuts.cut = 'Ctrl+C')), /Ctrl\+C is both/);
  assert.match(broken((d) => (d.shortcuts.shortcuts.sharpen = 'Ctrl+Shift+H')), /sharpen, which opens a submenu/);
  assert.match(broken((d) => (d.shortcuts.shortcuts['tool-pen'] = 'Space')), /kept by the app/);
  assert.match(broken((d) => (d.shortcuts.shortcuts.nope = 'Ctrl+Q')), /nope, which is not a tool/);
  assert.match(broken((d) => (d.toolTypes.menus.find((m) => m.id === 'pages-button')!.from = 'cut')), /cut, which has no submenu/);
  assert.match(broken((d) => d.toolTypes.tools.reverse()), /COMMAND_IDS/);
});

// ---- Today's menus, and what 1.0.0-alpha.4.5.0 changes in them --------------------

type NativeRow = Record<string, unknown>;
const SEP: NativeRow = { type: 'separator' };

/** The native File menu as `buildMenu` wrote it before 1.0.0-alpha.4.5.0. */
const TODAY_FILE: NativeRow[] = [
  { label: 'New Sketch', accelerator: 'CmdOrCtrl+N' },
  { label: 'Open…', accelerator: 'CmdOrCtrl+O' },
  { label: 'Import…', accelerator: 'CmdOrCtrl+I' },
  SEP,
  { label: 'Save', accelerator: 'CmdOrCtrl+S' },
  { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S' },
  SEP,
  {
    label: 'Export',
    submenu: [{ label: 'PNG Image…' }, { label: 'JPEG Image…' }, { label: 'SVG Vector…' }, { label: 'PDF Document…' }],
  },
  SEP,
  { role: 'quit' },
];

/** The native Edit menu as it was; the last two rows only with Animation Mode installed. */
function todayEdit(animation: boolean): NativeRow[] {
  return [
    { label: 'Undo', accelerator: 'CmdOrCtrl+Z' },
    { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z' },
    SEP,
    { label: 'Cut', accelerator: 'CmdOrCtrl+X', registerAccelerator: false },
    { label: 'Copy', accelerator: 'CmdOrCtrl+C', registerAccelerator: false },
    { label: 'Paste', accelerator: 'CmdOrCtrl+V', registerAccelerator: false },
    { label: 'Paste in Place', accelerator: 'CmdOrCtrl+Shift+V', registerAccelerator: false },
    { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', registerAccelerator: false },
    { label: 'Rotate…', accelerator: 'CmdOrCtrl+R', registerAccelerator: false },
    { label: 'Mirror…', accelerator: 'O', registerAccelerator: false },
    SEP,
    { label: 'Delete', accelerator: 'Delete', registerAccelerator: false },
    { label: 'Select All', accelerator: 'CmdOrCtrl+A', registerAccelerator: false },
    SEP,
    { label: 'Verbose Settings…', accelerator: 'CmdOrCtrl+Alt+,' },
    { label: 'Rearrange Toolbar' },
    ...(animation ? [SEP, { label: 'Animation Mode', accelerator: 'CmdOrCtrl+Shift+N' }] : []),
  ];
}

/** The native View menu as it was. */
const TODAY_VIEW: NativeRow[] = [
  { label: 'Toggle Pages Panel', accelerator: 'CmdOrCtrl+B' },
  { label: 'Toggle Layers Panel', accelerator: 'CmdOrCtrl+L' },
  { label: 'Toggle Properties Panel', accelerator: 'CmdOrCtrl+P' },
  { label: 'Quick Settings', accelerator: 'CmdOrCtrl+,' },
  SEP,
  { role: 'toggleDevTools' },
  SEP,
  { label: 'Fit All in View', accelerator: 'CmdOrCtrl+0' },
  { role: 'zoomIn' },
  { role: 'zoomOut' },
  SEP,
  { role: 'togglefullscreen' },
];

/** The rows with these labels, in this order. */
function inOrder<T extends { label?: unknown }>(rows: readonly T[], labels: string[]): T[] {
  return labels.map((label) => {
    const found = rows.find((row) => row.label === label);
    assert.ok(found, `no row ${label}`);
    return found;
  });
}

/** Change 1: File > Export lists PNG, SVG, JPEG, PDF, the order the new menu bar uses. */
function exportInNewOrder(rows: NativeRow[]): NativeRow[] {
  return rows.map((row) =>
    row.label === 'Export'
      ? { ...row, submenu: inOrder(row.submenu as NativeRow[], ['PNG Image…', 'SVG Vector…', 'JPEG Image…', 'PDF Document…']) }
      : row,
  );
}

/** Change 2: Rotate and Mirror leave Edit for the Transform menu. */
function rotateAndMirrorMoved(rows: NativeRow[]): NativeRow[] {
  return rows.filter((row) => row.label !== 'Rotate…' && row.label !== 'Mirror…');
}

/** Change 3: the two editors join Edit's settings block, after Rearrange Toolbar. */
function editorsAdded(rows: NativeRow[]): NativeRow[] {
  const at = rows.findIndex((row) => row.label === 'Rearrange Toolbar') + 1;
  return [...rows.slice(0, at), { label: 'Edit Keyboard Shortcuts…' }, { label: 'Edit Tool Types…' }, ...rows.slice(at)];
}

/** A native row without the id the main process binds its click by, so it compares with the old literal. */
function withoutIds(items: readonly NativeItem[]): NativeRow[] {
  return items.map((item) => {
    const copy: NativeRow = { ...item };
    delete copy.id;
    if ('submenu' in item && item.submenu) copy.submenu = withoutIds(item.submenu);
    return copy;
  });
}

test('File, Edit and View are the old menus with exactly the three documented changes', () => {
  for (const animation of [true, false]) {
    const menus = nativeMenus(registry, { animationNotInstalled: !animation });
    const menu = (label: string) => withoutIds(menus.find((m) => m.label === label)!.submenu);
    assert.deepEqual(menu('File'), exportInNewOrder(TODAY_FILE), `File, animation ${animation}`);
    assert.deepEqual(menu('Edit'), editorsAdded(rotateAndMirrorMoved(todayEdit(animation))), `Edit, animation ${animation}`);
    assert.deepEqual(menu('View'), TODAY_VIEW, `View, animation ${animation}`);
  }
});

test('the menu bar holds nine menus, in the order this release sets out', () => {
  assert.deepEqual(
    menuTree(registry).map((menu) => menu.label),
    ['File', 'Edit', 'View', 'Transform', 'Sketch', 'Layers', 'Pages', 'Automate', 'Help'],
  );
});

type Shape = string | { label: string; disabledWhen?: string; submenu?: Shape[] };

/** A generated menu reduced to what the old item lists said: labels, what disables a row, and submenus. */
function shape(rows: readonly MenuRow[]): Shape[] {
  return rows.map((row) =>
    row.kind === 'separator'
      ? '---'
      : {
          label: row.label,
          ...(row.disabledWhen ? { disabledWhen: row.disabledWhen } : {}),
          ...(row.submenu ? { submenu: shape(row.submenu) } : {}),
        },
  );
}

const item = (label: string, disabledWhen?: string): Shape => (disabledWhen ? { label, disabledWhen } : { label });
const sub = (label: string, submenu: Shape[], disabledWhen?: string): Shape => ({ ...(item(label, disabledWhen) as object), label, submenu });

/** Replaces the row with a label by the given rows. */
function replace(rows: Shape[], label: string, ...by: Shape[]): Shape[] {
  const at = rows.findIndex((row) => typeof row !== 'string' && row.label === label);
  assert.ok(at >= 0, `no row ${label}`);
  return [...rows.slice(0, at), ...by, ...rows.slice(at + 1)];
}

/** `clipboardMenuItems()`, shared by the canvas and the layers panel. */
const TODAY_CLIPBOARD = [
  item('Cut', 'noSelection'),
  item('Copy', 'noSelection'),
  item('Paste'),
  item('Paste in Place', 'noClipboard'),
  item('Duplicate', 'noSelection'),
];

const TODAY_LAYERS_PANEL: Shape[] = [
  item('Add Layer'),
  item('Group Layer'),
  item('Ungroup', 'notGroup'),
  item('Rename'),
  item('Delete Layer(s)'),
  '---',
  ...TODAY_CLIPBOARD,
  '---',
  item('Move Layer(s) Up'),
  item('Move Layer(s) Down'),
  '---',
  item('Hide Layers Panel'),
];

const TODAY_CANVAS: Shape[] = [
  ...TODAY_CLIPBOARD,
  '---',
  item('Delete', 'noSelection'),
  '---',
  item('Select All'),
  item('Deselect All', 'noMarksSelected'),
];

const TODAY_PAGES_PANEL: Shape[] = [
  item('Add Page'),
  item('Delete Page', 'onePage'),
  '---',
  item('Page Settings…'),
  '---',
  item('Hide Pages Panel'),
];

/** `pageMenuItems()`, behind the pages panel's hamburger. */
const TODAY_PAGES_BUTTON: Shape[] = [item('From Selection', 'noSelection'), item('Default New Page'), item('Custom New Page…')];

const TODAY_FORMATS = [item('PNG Image…'), item('JPEG Image…'), item('SVG Vector…'), item('PDF Document…')];
const TODAY_EXPORT_BUTTON: Shape[] = [...TODAY_FORMATS, '---', sub('Selection', TODAY_FORMATS, 'noSelection')];

const TODAY_CLOSE_SHAPE_BUTTON: Shape[] = [
  item('Sharp - straight line between the end points'),
  item('Smooth - curve on through the end points'),
];

const NEW_FORMATS = [item('PNG Image…'), item('SVG Vector…'), item('JPEG Image…'), item('PDF Document…')];
const NEW_ADD_PAGE = [item('Default New Page'), item('Custom New Page…'), item('From Selection', 'noSelection')];

test('the right-click menus and dropdowns are the old ones with exactly the documented changes', () => {
  const expected: Record<string, Shape[]> = {
    // The new Layers menu: "Delete Layer", and the two restack rows in a Move submenu.
    // Hide gains a question that is never yes inside the open panel, and is there for the menu bar.
    layers: replace(
      replace(
        replace(replace(TODAY_LAYERS_PANEL, 'Delete Layer(s)', item('Delete Layer')), 'Move Layer(s) Up', sub('Move', [item('Layer Up'), item('Layer Down')])),
        'Move Layer(s) Down',
      ),
      'Hide Layers Panel',
      item('Hide Layers Panel', 'layersHidden'),
    ),
    canvas: TODAY_CANVAS,
    // The new Pages menu: Add Page opens the three ways to start a page.
    pages: replace(
      replace(TODAY_PAGES_PANEL, 'Add Page', sub('Add Page', NEW_ADD_PAGE)),
      'Hide Pages Panel',
      item('Hide Pages Panel', 'pagesHidden'),
    ),
    // The hamburger shows Add Page's submenu, so it takes that submenu's order.
    'pages-button': NEW_ADD_PAGE,
    // The Export button shows File > Export's submenu, in its new order, with the Selection row.
    'export-button': [...NEW_FORMATS, '---', sub('Selection', NEW_FORMATS, 'noSelection')],
    'close-shape-button': TODAY_CLOSE_SHAPE_BUTTON,
  };
  for (const [context, rows] of Object.entries(expected)) {
    assert.deepEqual(shape(contextItems(registry, context)), rows, context);
  }
  // The old lists, for the record of what changed: these two did not.
  assert.deepEqual(expected.canvas, TODAY_CANVAS);
  assert.deepEqual(expected['close-shape-button'], TODAY_CLOSE_SHAPE_BUTTON);
  assert.notDeepEqual(expected['pages-button'], TODAY_PAGES_BUTTON);
  assert.notDeepEqual(expected['export-button'], TODAY_EXPORT_BUTTON);
});

test('a context that is not drawn inside the window is a mistake in the caller', () => {
  assert.throws(() => contextItems(registry, 'file'), /not a menu drawn inside the window/);
  assert.throws(() => contextItems(registry, 'nowhere'), /not a menu drawn inside the window/);
});

// ---- The menu bar this release sets out ---------------------------------------------

/** A menu as an indented outline: a row's label, its chord, and its submenu below it. */
function outline(rows: readonly MenuRow[], indent = '  '): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    if (row.kind === 'separator') {
      lines.push(`${indent}---`);
      continue;
    }
    const check = row.checked === null ? '' : row.checked ? '[x] ' : '[ ] ';
    lines.push(`${indent}${check}${row.label}${row.chord ? ` (${displayChord(row.chord)})` : ''}`);
    if (row.submenu) lines.push(...outline(row.submenu, `${indent}  `));
  }
  return lines;
}

function menuBar(state: MenuState = {}): string {
  return menuTree(registry, state)
    .flatMap((menu) => [menu.label, ...outline(menu.items)])
    .join('\n');
}

/**
 * The menu bar of 1.0.0-alpha.4.5.0. Beside the rows its specification lists:
 * Edit Keyboard Shortcuts and Edit Tool Types, which it adds to Edit;
 * Close Shape's Sharp and Smooth, the choice its toolbar button already
 * offers; the ellipsis on every row that opens a dialog; and the chords the
 * app already had for Group Layer, Ungroup and Rename, which the list leaves
 * out but the app still honours. The Transform box and Stroke Profile joined
 * it when the CHANGELOG was checked against the menus before the release.
 */
const MENU_BAR = [
  'File',
  '  New Sketch (Ctrl+N)',
  '  Open… (Ctrl+O)',
  '  Import… (Ctrl+I)',
  '  ---',
  '  Save (Ctrl+S)',
  '  Save As… (Ctrl+Shift+S)',
  '  ---',
  '  Export',
  '    PNG Image…',
  '    SVG Vector…',
  '    JPEG Image…',
  '    PDF Document…',
  '  ---',
  '  Exit',
  'Edit',
  '  Undo (Ctrl+Z)',
  '  Redo (Ctrl+Shift+Z)',
  '  ---',
  '  Cut (Ctrl+X)',
  '  Copy (Ctrl+C)',
  '  Paste (Ctrl+V)',
  '  Paste in Place (Ctrl+Shift+V)',
  '  Duplicate (Ctrl+D)',
  '  ---',
  '  Delete (Delete)',
  '  Select All (Ctrl+A)',
  '  ---',
  '  Verbose Settings… (Ctrl+Alt+,)',
  '  Rearrange Toolbar',
  '  Edit Keyboard Shortcuts…',
  '  Edit Tool Types…',
  '  ---',
  '  Animation Mode (Ctrl+Shift+N)',
  'View',
  '  Toggle Pages Panel (Ctrl+B)',
  '  Toggle Layers Panel (Ctrl+L)',
  '  Toggle Properties Panel (Ctrl+P)',
  '  Quick Settings (Ctrl+,)',
  '  ---',
  '  Toggle Developer Tools (Ctrl+Shift+I)',
  '  ---',
  '  Fit All in View (Ctrl+0)',
  '  Zoom In (Ctrl++)',
  '  Zoom Out (Ctrl+-)',
  '  ---',
  '  Toggle Full Screen (F11)',
  'Transform',
  '  Vector Path (B)',
  '  ---',
  '  [ ] Transform Box (Ctrl+T)',
  '  Move… (Enter)',
  '  Rotate… (Ctrl+R)',
  '  Join (Ctrl+J)',
  '  Close Shape',
  '    Sharp',
  '    Smooth',
  '  Mirror… (O)',
  '  ---',
  '  Sharpen',
  '    Sharpen Selection…',
  '    Sharpen All (H)',
  '  Mesh Warp',
  'Sketch',
  '  Pen (P)',
  '  Marker (M)',
  '  Eraser (E)',
  '  Text (T)',
  '  Copic (K)',
  '  Direct (A)',
  '  ---',
  '  Stroke Profile…',
  'Layers',
  '  Add Layer',
  '  Group Layer (Ctrl+G)',
  '  Ungroup (Ctrl+Shift+G)',
  '  Rename (F2)',
  '  Delete Layer',
  '  ---',
  '  Move Layer',
  '    Layer Up (Ctrl+])',
  '    Layer Down (Ctrl+[)',
  '  ---',
  '  Hide Layers Panel',
  'Pages',
  '  Add Page',
  '    Default New Page',
  '    Custom New Page…',
  '    From Selection',
  '  Delete Page',
  '  ---',
  '  Page Settings…',
  '  ---',
  '  Hide Pages Panel',
  'Automate',
  '  Generate Script',
  '    From Media File…',
  '    Selected Layers…',
  '    From Session History…',
  '  [ ] Track History',
  '  History Limit…',
  'Help',
  '  Verbose',
  '  Tool Types',
  '    Transform',
  '    Draw',
  '    Pages',
  '    Layers',
  '    Automate',
  '  ---',
  '  Source Code',
  '  Source Docs',
].join('\n');

test('the menu bar is the one this release sets out, row for row', () => {
  assert.equal(menuBar(), MENU_BAR);
});

test('a row the state hides takes its separator with it', () => {
  const bar = menuBar({ animationNotInstalled: true, noDocsSite: true });
  const expected = MENU_BAR.replace('  Edit Tool Types…\n  ---\n  Animation Mode (Ctrl+Shift+N)\n', '  Edit Tool Types…\n').replace(
    '\n  Source Docs',
    '',
  );
  assert.equal(bar, expected);
  const help = menuTree(registry, { noDocsSite: true }).find((menu) => menu.label === 'Help')!;
  assert.equal(help.items[help.items.length - 1].kind, 'item', 'Help does not end on a separator');
});

test('a row the state disables or checks says so, in the menu bar and in the native template', () => {
  const edit = (state: MenuState) => nativeMenus(registry, state).find((menu) => menu.label === 'Edit')!.submenu;
  const cut = (state: MenuState) => edit(state).find((row) => 'id' in row && row.id === 'cut');
  assert.equal(cut({})!.hasOwnProperty('enabled'), false, 'enabled unless the state says otherwise');
  assert.deepEqual(cut({ noSelection: true }), { id: 'cut', label: 'Cut', accelerator: 'CmdOrCtrl+X', registerAccelerator: false, enabled: false });

  const automate = (state: MenuState) => nativeMenus(registry, state).find((menu) => menu.label === 'Automate')!.submenu;
  const track = (state: MenuState) => automate(state).find((row) => 'id' in row && row.id === 'track-history');
  assert.deepEqual(track({}), { id: 'track-history', label: 'Track History', type: 'checkbox', checked: false });
  assert.deepEqual(track({ historyTracking: true }), { id: 'track-history', label: 'Track History', type: 'checkbox', checked: true });
  assert.match(menuBar({ historyTracking: true }), /\[x\] Track History/);

  const script = menuTree(registry, { noHistory: true }).find((menu) => menu.id === 'automate')!.items[0];
  assert.ok(script.kind === 'item' && script.submenu);
  const fromHistory = script.submenu.find((row) => row.kind === 'item' && row.id === 'script-from-history');
  assert.ok(fromHistory && fromHistory.kind === 'item' && fromHistory.disabled);
});

test('the menu bar claims only the chords it claimed before; the page keeps the rest', () => {
  const claimed: string[] = [];
  const pageKept: string[] = [];
  const visit = (items: readonly NativeItem[]): void => {
    for (const row of items) {
      if (!('id' in row)) continue;
      if (row.submenu) visit(row.submenu);
      if (!row.accelerator) continue;
      (row.registerAccelerator === false ? pageKept : claimed).push(row.id);
    }
  };
  for (const menu of nativeMenus(registry)) visit(menu.submenu);
  assert.deepEqual(claimed.sort(), [
    'fit-view',
    'import',
    'new-sketch',
    'open',
    'redo',
    'save',
    'save-as',
    'toggle-animation',
    'toggle-layers',
    'toggle-pages',
    'toggle-properties',
    'toggle-settings',
    'undo',
    'verbose-settings',
  ]);
  // Every row the six new menus bring with a chord was handled by the page's key handler, and still is.
  for (const id of ['tool-vector', 'move-selection', 'rotate', 'join-strokes', 'mirror', 'sharpen-all', 'tool-pen', 'tool-point', 'group-layer', 'rename-layer', 'layer-up']) {
    assert.ok(pageKept.includes(id), id);
  }
});

test('Help > Tool Types lists the menus that name a page, in the order they give', () => {
  assert.deepEqual(
    helpTopics(registry).map((topic) => [topic.id, topic.label, topic.page]),
    [
      ['help-topic:transform', 'Transform', 'quickstart/transform'],
      ['help-topic:sketch', 'Draw', 'quickstart/draw'],
      ['help-topic:pages', 'Pages', 'quickstart/pages'],
      ['help-topic:layers', 'Layers', 'quickstart/layers'],
      ['help-topic:automate', 'Automate', 'quickstart/automate'],
    ],
  );
  const help = menuTree(registry).find((menu) => menu.id === 'help')!;
  const toolTypes = help.items.find((row) => row.kind === 'item' && row.id === 'help-tool-types');
  assert.ok(toolTypes && toolTypes.kind === 'item' && toolTypes.submenu);
  assert.ok(toolTypes.submenu.every((row) => row.kind === 'item' && row.host === 'main' && row.page !== null));
});

// ---- Types decide where a tool is shown --------------------------------------------

test('one type puts the clipboard in Edit, on the canvas and in the layers panel, and not in the Layers menu', () => {
  for (const id of ['cut', 'copy', 'paste', 'paste-in-place', 'duplicate']) {
    assert.deepEqual(
      whereShown(registry, id),
      [
        { menu: 'edit', position: 'top' },
        { menu: 'layers', position: 'panel' },
        { menu: 'canvas', position: 'panel' },
      ],
      id,
    );
  }
});

test('a row placed by hand is shown only where it is placed', () => {
  assert.deepEqual(whereShown(registry, 'deselect-all'), [{ menu: 'canvas', position: 'panel' }]);
  assert.deepEqual(whereShown(registry, 'export-selection'), [{ menu: 'export-button', position: 'panel' }]);
  assert.deepEqual(whereShown(registry, 'export-selection-pdf'), [{ menu: 'export-button', position: 'panel' }]);
  assert.deepEqual(whereShown(registry, 'export-png'), [
    { menu: 'file', position: 'top' },
    { menu: 'export-button', position: 'panel' },
  ]);
});

test('every tool the files put in a menu is shown in one, and every other tool in none', () => {
  for (const tool of registry.tools) {
    const shown = whereShown(registry, tool.id).length > 0;
    let top = tool;
    while (top.parent !== null) top = registry.tool(top.parent)!;
    assert.equal(shown, top.placement !== null, tool.id);
  }
});

test('a label follows the position it is drawn in', () => {
  const layersTop = menuTree(registry).find((menu) => menu.id === 'layers')!.items;
  const layersPanel = contextItems(registry, 'layers');
  const label = (rows: readonly MenuRow[], id: string) => rows.find((row) => row.kind === 'item' && row.id === id);
  assert.equal((label(layersTop, 'move-layer') as { label: string }).label, 'Move Layer');
  assert.equal((label(layersPanel, 'move-layer') as { label: string }).label, 'Move');
});

// ---- What can be moved, and what can be remapped ------------------------------------

test('the tools a user can move to another type are the ones the plan lists', () => {
  const movable = registry.tools.filter((tool) => tool.placementFixed === null).map((tool) => tool.id);
  assert.deepEqual(movable, [
    'cut',
    'copy',
    'paste',
    'paste-in-place',
    'duplicate',
    'delete-selection',
    'select-all',
    'tool-vector',
    'toggle-transform',
    'move-selection',
    'rotate',
    'join-strokes',
    'close-shape',
    'mirror',
    'sharpen',
    'tool-warp',
    'tool-pen',
    'tool-marker',
    'tool-eraser',
    'tool-text',
    'tool-copic',
    'tool-point',
    'add-layer',
    'group-layer',
    'ungroup-layer',
    'rename-layer',
    'delete-layer',
    'move-layer',
    'tool-select',
    'tool-rect',
    'tool-ellipse',
    'tool-curve',
    'tool-bucket',
    'tool-fill',
    'tool-eyedrop',
    'clear-page',
  ]);
  const reason = (id: string) => registry.tool(id)!.placementFixed;
  assert.equal(reason('undo'), 'it belongs to the Edit menu');
  // Its type names the Sketch menu itself, as the quick features' does.
  assert.equal(reason('stroke-profile'), 'it belongs to the Sketch menu');
  // The brief: the two editors are never offered for moving, whatever the Edit
  // menu's own rows become.
  assert.equal(reason('edit-tool-types'), 'an editor stays in the Edit menu, where it can always be found');
  assert.equal(reason('edit-shortcuts'), 'an editor stays in the Edit menu, where it can always be found');
  assert.equal(reason('quit'), 'Electron draws this row');
  assert.equal(reason('deselect-all'), 'it is placed by hand in Canvas only');
  assert.equal(reason('layer-up'), 'it moves with the Move Layer submenu');
  assert.match(reason('history-limit')!, /Automate's own setting/);
});

test("every shortcut can be changed but a role row's and a submenu's", () => {
  const fixed = registry.tools.filter((tool) => tool.shortcutFixed !== null).map((tool) => tool.id);
  assert.deepEqual(fixed, [
    'export',
    'export-selection',
    'quit',
    'toggle-dev-tools',
    'zoom-in',
    'zoom-out',
    'toggle-full-screen',
    'close-shape',
    'sharpen',
    'move-layer',
    'add-page',
    'generate-script',
    'help-tool-types',
  ]);
});

test('the types a tool can be moved to are the sub-types the menus accept, by main type', () => {
  assert.deepEqual(placeableTypes(registry), [
    { main: 'App', types: ['App:Add:layer', 'App:Modify:layer', 'App:Subtract:layer'] },
    { main: 'Composition', types: ['Composition:edit:mixed', 'Composition:Subtract:element', 'Composition:edit:selection'] },
    {
      main: 'Draw',
      types: ['Draw:Add:vector', 'Draw:Modify:element', 'Draw:Subtract:vector', 'Draw:Add:mark', 'Draw:Modify:vector', 'Draw:Subtract:mark'],
    },
    { main: 'API', types: ['API:automate:mixed'] },
  ]);
});

test('a chord is free, held by another tool, held for good, or kept by the app', () => {
  assert.equal(chordConflict(registry, 'mirror', 'O'), null, 'its own');
  assert.equal(chordConflict(registry, 'mirror', 'Ctrl+M'), null, "nobody's");
  assert.deepEqual(chordConflict(registry, 'mirror', 'ctrl+j'), { kind: 'tool', tool: 'join-strokes', fixed: false });
  assert.deepEqual(chordConflict(registry, 'mirror', 'Ctrl+Y'), { kind: 'tool', tool: 'redo', fixed: false }, 'an alias counts');
  assert.deepEqual(chordConflict(registry, 'mirror', 'Ctrl+Shift+I'), { kind: 'tool', tool: 'toggle-dev-tools', fixed: true });
  const reserved = chordConflict(registry, 'mirror', 'Space');
  assert.ok(reserved && reserved.kind === 'reserved' && /pan/.test(reserved.reason));
});

test('each chord runs one tool, and the two aliases run theirs', () => {
  assert.equal(registry.toolForChord('Ctrl+Shift+Z'), 'redo');
  assert.equal(registry.toolForChord('Ctrl+Y'), 'redo');
  assert.equal(registry.toolForChord('Backspace'), 'delete-selection');
  assert.equal(registry.toolForChord('shift+c'), 'cycle-color-back');
  assert.equal(registry.toolForChord('C'), 'cycle-color');
  assert.equal(registry.toolForChord('Ctrl+M'), null);
  assert.equal(registry.toolForChord('not a chord'), null);
  const chords = registry.tools.flatMap((tool) => [tool.chord, ...tool.aliases]).filter((chord) => chord !== null);
  assert.equal(new Set(chords).size, chords.length, 'no chord twice');
});

// ---- Where a type is listed -----------------------------------------------------------

test('where a type is listed is where a tool of that type is shown, for every tool the menus place by type', () => {
  let checked = 0;
  for (const tool of registry.tools) {
    if (tool.parent !== null || tool.only !== null) continue;
    assert.deepEqual(placesFor(registry, tool.placement), whereShown(registry, tool.id), tool.id);
    checked++;
  }
  assert.ok(checked > 60, `${checked} tools checked`);
  assert.deepEqual(placesFor(registry, 'Composition:edit:mixed'), [
    { menu: 'edit', position: 'top' },
    { menu: 'layers', position: 'panel' },
    { menu: 'canvas', position: 'panel' },
  ]);
  assert.deepEqual(placesFor(registry, 'App:Add:layer'), [
    { menu: 'layers', position: 'top' },
    { menu: 'layers', position: 'panel' },
  ]);
  assert.deepEqual(placesFor(registry, null), []);
  assert.deepEqual(placesFor(registry, 'Draw:nothing'), []);
  assert.deepEqual(placesFor(registry, 'not a type'), []);
});
