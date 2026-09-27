/**
 * The menu editors, as the configuration popup draws them: Edit Keyboard
 * Shortcuts, and Edit Tool Types.
 *
 * Edit > Edit Keyboard Shortcuts lists every tool the menu registry knows -
 * toolbar-only ones too - as `| Tool | Type | Keyboard Shortcut |`: the tool's
 * name, with where it is as the tooltip; its type in a greyed box; and its
 * shortcut in a box that takes the next keypress. A chord another tool holds
 * turns the box amber - Accept will take it from that tool - and a free one
 * green. The keys the app cannot give away are refused in place, with the
 * reason: Space, Escape and Tab ({@link chordCellState}), Electron's own rows'
 * keys, and Enter for anything but Move.
 *
 * What Accept saves is the whole mapping, settled by {@link resolveShortcuts};
 * the main process keeps only what differs from the shipped file, which is
 * never written. Reset to defaults puts the shipped chords in the table as
 * edits, so Accept keeps them - and, with nothing left that differs, the
 * user's file goes.
 *
 * Edit > Edit Tool Types lists the same tools as `| Tool | Type | Keyboard
 * Shortcut |`, now with the type in a drop-down - a group for each main type,
 * the sub-types the menus take under it, and "Not in a menu" first - and the
 * shortcut greyed. A type decides which menus list a tool and nothing else:
 * the drop-down says where a choice would list it before anything is kept.
 * The rows that cannot move - the two editors, a menu's own rows, Electron's,
 * a submenu's, the ones kept on the keyboard - are listed with the drop-down
 * greyed and the reason as its tooltip. Accept and Reset work as they do for
 * the shortcuts, on the user's tool types file.
 *
 * Nothing here touches the DOM: the rows, the checks and the settling are
 * tested on their own, and the renderer opens the popup with the spec.
 */

import { displayChord } from '../core/menu/chords.js';
import { menuPath, placeableTypes, placesFor, splitType, type MenuRegistry, type ToolInfo } from '../core/menu/registry.js';
import type { CellVerdict, ConfigDialogSpec, KeyValidator } from './config-dialog.js';

/** The one tool Enter may run: Move, which it has always opened. */
const ENTER_TOOL = 'move-selection';

/** One row of Edit Keyboard Shortcuts. */
export interface ShortcutRow {
  /** The tool's id. */
  readonly id: string;
  /** Its full name. */
  readonly tool: string;
  /** Where it is, for the tooltip: `Transform > Mirror`, or that no menu has it. */
  readonly where: string;
  /** Its type, `Main:sub`. */
  readonly type: string;
  /** Its chord, canonical, or null for none: the one field the editor changes. */
  readonly key: string | null;
  /** The chord it had when the editor opened, which tells a row taking a chord from one losing it. */
  readonly original: string | null;
  /** The chord the app ships it with, which Reset to defaults puts back. */
  readonly shipped: string | null;
  /** Chords that also run it and no menu shows, such as Redo's Ctrl+Y. */
  readonly aliases: readonly string[];
  /** Why its shortcut cannot change, or null when it can. */
  readonly fixed: string | null;
}

/** How the editors read chords: with `Cmd` and `Option` on a Mac. */
export interface EditorDisplay {
  readonly mac?: boolean;
}

function whereOf(registry: MenuRegistry, tool: ToolInfo): string {
  const path = menuPath(registry, tool);
  if (path === 'Not in a menu') return 'Not in a menu: the toolbar or its key runs it';
  const label = typeof tool.label === 'string' ? tool.label : tool.label.top;
  return `${path} > ${label}`;
}

/** Every tool in the registry as a row, in the order of the menu files. */
export function shortcutRows(registry: MenuRegistry): ShortcutRow[] {
  return registry.tools.map((tool) => ({
    id: tool.id,
    tool: tool.name,
    where: whereOf(registry, tool),
    type: tool.type,
    key: tool.chord,
    original: tool.chord,
    shipped: tool.shippedChord,
    aliases: [...tool.aliases],
    fixed: tool.shortcutFixed,
  }));
}

/** The same rows with the shipped chords in them: what Reset to defaults proposes. */
export function defaultShortcutRows(rows: readonly ShortcutRow[]): ShortcutRow[] {
  return rows.map((row) => (row.fixed === null ? { ...row, key: row.shipped } : row));
}

/**
 * What the shortcut cells say about a chord, beyond what every shortcut cell
 * refuses. The rows are the table as edited so far, so a row is taking a
 * chord when the chord is not the one it opened with, and a row whose chord a
 * taking row has is losing it.
 *
 * - A key an Electron row owns (Zoom In's `Ctrl+Plus`, Full Screen's `F11`)
 *   is refused: the menu bar answers it before the window can.
 * - Enter is refused for anything but Move: it finishes a Vector Path and
 *   applies an open palette, whatever it is bound to.
 * - A chord another row holds is a warning: on the taking row, that Accept
 *   takes it from the holder; on the losing row, that it will have none.
 *   Two rows both taking one chord cannot be settled, so the second is
 *   refused until the first lets go.
 * - A chord that is another tool's hidden second shortcut (Redo's `Ctrl+Y`)
 *   is a warning that it will run this tool alone.
 */
export function shortcutValidator(registry: MenuRegistry, display: EditorDisplay = {}): KeyValidator<ShortcutRow> {
  const shown = (chord: string): string => displayChord(chord, { mac: display.mac });
  return (row, chord, rows): CellVerdict | null => {
    const owner = registry.tools.find((tool) => tool.role !== null && tool.chord === chord);
    if (owner && owner.id !== row.id) {
      return { level: 'refuse', message: `${shown(chord)} belongs to ${owner.name}, which Electron draws` };
    }
    if (chord === 'Enter' && row.id !== ENTER_TOOL) {
      return { level: 'refuse', message: 'Enter finishes a path and applies an open palette, so only Move can have it' };
    }
    const taking = chord !== row.original;
    // Every row holding the chord counts: the one that held it all along and
    // one given it in this edit can both be there, in either order.
    const holders = rows.filter((other) => other.id !== row.id && other.key === chord);
    const takingHolder = holders.find((other) => other.key !== other.original);
    const keepingHolder = holders.find((other) => other.key === other.original);
    if (taking && takingHolder) {
      return { level: 'refuse', message: `${takingHolder.tool} is already given ${shown(chord)} here; clear it there first` };
    }
    if (taking && keepingHolder) {
      return { level: 'warn', message: `Used by ${keepingHolder.tool} - Accept will take it from ${keepingHolder.tool}` };
    }
    if (takingHolder) {
      return { level: 'warn', message: `${takingHolder.tool} takes ${shown(chord)} on Accept, so ${row.tool} will have no shortcut` };
    }
    if (keepingHolder) return { level: 'warn', message: `Also used by ${keepingHolder.tool}` };
    if (taking) {
      const second = rows.find((other) => other.id !== row.id && other.aliases.includes(chord));
      if (second) {
        return { level: 'warn', message: `${second.tool} also answers ${shown(chord)} - Accept gives it to ${row.tool} alone` };
      }
    }
    return null;
  };
}

/**
 * The mapping Accept saves: every row's chord, except that a chord a changed
 * row takes is taken from the unchanged row that held it, which is left with
 * none - the brief's "if warning and accept, remap shortcut". Rows whose
 * shortcut cannot change are left out.
 */
export function resolveShortcuts(rows: readonly ShortcutRow[]): Record<string, string | null> {
  const takers = new Map<string, string>();
  for (const row of rows) {
    if (row.key !== null && row.key !== row.original) takers.set(row.key, row.id);
  }
  const mapping: Record<string, string | null> = {};
  for (const row of rows) {
    if (row.fixed !== null) continue;
    const taker = row.key === null ? undefined : takers.get(row.key);
    mapping[row.id] = taker !== undefined && taker !== row.id ? null : row.key;
  }
  return mapping;
}

/** What the search looks in: the name, the type, and the shortcut as stored and as shown. */
function shortcutSearchText(row: ShortcutRow, display: EditorDisplay): string {
  const chords = [row.key, ...row.aliases].filter((chord): chord is string => chord !== null);
  return [row.tool, row.type, ...chords, ...chords.map((chord) => displayChord(chord, { mac: display.mac }))].join(' ');
}

/** What the renderer does with Edit Keyboard Shortcuts' buttons. */
export interface ShortcutEditorActions extends EditorDisplay {
  /** Saves the rows Accept was handed; a throw keeps the popup open with the message. */
  readonly onAccept: (rows: ShortcutRow[]) => void | Promise<void>;
  /** Reset to defaults: the renderer puts {@link defaultShortcutRows} in the table as edits. */
  readonly onReset: () => void;
}

/** Edit Keyboard Shortcuts, for the configuration popup. */
export function shortcutEditorSpec(
  registry: MenuRegistry,
  rows: readonly ShortcutRow[],
  actions: ShortcutEditorActions,
): ConfigDialogSpec<ShortcutRow> {
  const display: EditorDisplay = { mac: actions.mac };
  const shown = (chord: string): string => displayChord(chord, display);
  return {
    title: 'Edit Keyboard Shortcuts',
    hint: "Click a shortcut, then press the keys for it. Accept saves your changes in a file of your own; the app's own shortcuts are always kept.",
    search: { placeholder: 'Search tools, types and shortcuts', text: (row) => shortcutSearchText(row, display) },
    filters: registry.mainTypes.map((main) => ({ label: main, test: (row: ShortcutRow) => row.type.startsWith(`${main}:`) })),
    columns: [
      { kind: 'text', heading: 'Tool', field: 'tool', width: '34%', title: (row) => row.where },
      { kind: 'text', heading: 'Type', field: 'type', width: '30%', editable: () => false },
      {
        kind: 'key',
        heading: 'Keyboard Shortcut',
        field: 'key',
        validate: shortcutValidator(registry, display),
        disabled: (row) => row.fixed !== null,
        title: (row) => {
          if (row.fixed !== null) return `This shortcut cannot change: ${row.fixed}.`;
          if (row.aliases.length > 0) {
            return `${row.aliases.map(shown).join(' and ')} also runs it. Click here, then press the keys for the shortcut.`;
          }
          return undefined;
        },
      },
    ],
    rows,
    rowLabel: (row) => row.tool,
    empty: 'No tools match.',
    accept: { onAccept: actions.onAccept },
    extra: [
      {
        label: 'Reset to defaults',
        title: "Put the app's own shortcuts in the table; Accept keeps them",
        onClick: actions.onReset,
      },
    ],
  };
}

// ---- Edit Tool Types -------------------------------------------------------------------

/** The drop-down's value for a tool in no menu. */
const NO_MENU = '';

/** One row of Edit Tool Types. */
export interface ToolTypeRow {
  /** The tool's id. */
  readonly id: string;
  /** Its full name. */
  readonly tool: string;
  /** Where it is when the editor opens, for the tooltip. */
  readonly where: string;
  /**
   * The type the menus list it by, or `''` for none: the one field the editor
   * changes. A row that cannot move shows the type it has.
   */
  readonly type: string;
  /** The type it had when the editor opened. */
  readonly original: string;
  /** The type the app ships it with, which Reset to defaults puts back. */
  readonly shipped: string;
  /** The main type the radios file it under when it is in no menu: the one it ships with. */
  readonly main: string;
  /** Its chord, shown greyed. */
  readonly key: string | null;
  /** Why it cannot move, or null when it can. */
  readonly fixed: string | null;
}

/** Every tool in the registry as a row, in the order of the menu files. */
export function toolTypeRows(registry: MenuRegistry): ToolTypeRow[] {
  return registry.tools.map((tool) => {
    const fixed = tool.placementFixed;
    const type = fixed !== null ? tool.type : (tool.placement ?? NO_MENU);
    return {
      id: tool.id,
      tool: tool.name,
      where: whereOf(registry, tool),
      type,
      original: type,
      shipped: fixed !== null ? tool.type : (tool.shippedPlacement ?? NO_MENU),
      main: splitType(tool.shippedType)?.main ?? '',
      key: tool.chord,
      fixed,
    };
  });
}

/** The same rows with the shipped types in them: what Reset to defaults proposes. */
export function defaultToolTypeRows(rows: readonly ToolTypeRow[]): ToolTypeRow[] {
  return rows.map((row) => (row.fixed === null ? { ...row, type: row.shipped } : row));
}

/** The main type a row is filed under: its type's, or the one it ships with when it is in no menu. */
function mainOf(row: ToolTypeRow): string {
  return row.type === NO_MENU ? row.main : (splitType(row.type)?.main ?? row.main);
}

/**
 * The menus that list a tool of this type, as a person names them: a menu
 * bar menu by its name (`Edit`), a panel's right-click menu as that panel
 * (`Layers panel`), and the canvas's as `Canvas`. Empty for no menu.
 */
export function listedIn(registry: MenuRegistry, type: string | null): string {
  return placesFor(registry, type)
    .map((place) => {
      const menu = registry.menu(place.menu);
      const label = menu?.label ?? place.menu;
      return place.position === 'top' || menu?.top !== true ? label : `${label} panel`;
    })
    .join(', ');
}

/**
 * What the Type drop-down says about a choice: where the tool would be
 * listed, in green once it is changed; and in amber, a tool that was in a
 * menu taken out of every one, with the key that still runs it. A tool that
 * was never in a menu says so, and what runs it.
 */
export function toolTypeValidator(
  registry: MenuRegistry,
  display: EditorDisplay = {},
): (row: ToolTypeRow, value: string, rows: readonly ToolTypeRow[]) => CellVerdict | null {
  const shown = (chord: string): string => displayChord(chord, { mac: display.mac });
  return (row, value) => {
    if (value === NO_MENU) {
      if (row.original === NO_MENU) return { level: 'ok', message: 'In no menu: the toolbar or its key runs it' };
      const still = row.key !== null ? `; ${shown(row.key)} still runs it` : '';
      return { level: 'warn', message: `${row.tool} will be in no menu${still}` };
    }
    const where = listedIn(registry, value);
    if (where === '') return { level: 'warn', message: `No menu lists ${value}, so ${row.tool} will be in none` };
    return { level: 'ok', message: value === row.original ? `Listed in ${where}` : `${row.tool} will be listed in ${where}` };
  };
}

/** The mapping Accept saves: every row that can move, with null for one in no menu. */
export function resolveToolTypes(rows: readonly ToolTypeRow[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  for (const row of rows) {
    if (row.fixed === null) mapping[row.id] = row.type === NO_MENU ? null : row.type;
  }
  return mapping;
}

/** What the search looks in: the name, the type or "Not in a menu", and the shortcut as stored and as shown. */
function toolTypeSearchText(row: ToolTypeRow, display: EditorDisplay): string {
  const chords = row.key === null ? [] : [row.key, displayChord(row.key, { mac: display.mac })];
  return [row.tool, row.type === NO_MENU ? 'Not in a menu' : row.type, ...chords].join(' ');
}

/** What the renderer does with Edit Tool Types' buttons. */
export interface ToolTypeEditorActions extends EditorDisplay {
  /** Saves the rows Accept was handed; a throw keeps the popup open with the message. */
  readonly onAccept: (rows: ToolTypeRow[]) => void | Promise<void>;
  /** Reset to defaults: the renderer puts {@link defaultToolTypeRows} in the table as edits. */
  readonly onReset: () => void;
}

/** Edit Tool Types, for the configuration popup. */
export function toolTypeEditorSpec(
  registry: MenuRegistry,
  rows: readonly ToolTypeRow[],
  actions: ToolTypeEditorActions,
): ConfigDialogSpec<ToolTypeRow> {
  const display: EditorDisplay = { mac: actions.mac };
  return {
    title: 'Edit Tool Types',
    hint: "Choose the type each tool is listed by. A type changes only which menus list a tool, never what the tool does. Accept saves your changes in a file of your own; the app's own types are always kept.",
    search: { placeholder: 'Search tools, types and shortcuts', text: (row) => toolTypeSearchText(row, display) },
    filters: registry.mainTypes.map((main) => ({ label: main, test: (row: ToolTypeRow) => mainOf(row) === main })),
    columns: [
      { kind: 'text', heading: 'Tool', field: 'tool', width: '34%', title: (row) => row.where },
      {
        kind: 'select',
        heading: 'Type',
        field: 'type',
        width: '38%',
        options: [{ value: NO_MENU, label: 'Not in a menu' }],
        optgroups: placeableTypes(registry).map((group) => ({
          label: group.main,
          options: group.types.map((type) => ({ value: type, label: type })),
        })),
        disabled: (row) => row.fixed !== null,
        validate: toolTypeValidator(registry, display),
        title: (row) => (row.fixed !== null ? `This tool stays where it is: ${row.fixed}.` : undefined),
      },
      {
        kind: 'text',
        heading: 'Keyboard Shortcut',
        field: 'key',
        editable: () => false,
        format: (row) => (row.key === null ? '' : displayChord(row.key, display)),
      },
    ],
    rows,
    rowLabel: (row) => row.tool,
    empty: 'No tools match.',
    accept: { onAccept: actions.onAccept },
    extra: [
      {
        label: 'Reset to defaults',
        title: "Put the app's own types in the table; Accept keeps them",
        onClick: actions.onReset,
      },
    ],
  };
}
