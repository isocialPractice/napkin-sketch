/**
 * The menus drawn inside the window, from the rows the registry generates.
 *
 * The right-click menus of the canvas and the two panels, and the dropdowns
 * under the Export, page-menu and Close Shape buttons, all draw through the
 * renderer's one context-menu widget. This turns the registry's rows for one
 * of them into that widget's items: the label, the shortcut shown at the
 * row's right edge, whether it is enabled, and a click that runs the row's
 * command by id. It touches no DOM, so it is tested on its own.
 */

import { displayChord } from '../core/menu/chords.js';
import type { MenuRow } from '../core/menu/registry.js';

/** One entry in the shared right-click menu and the toolbar dropdowns. */
export interface ContextMenuItem {
  label?: string;
  /** The row's shortcut as a person reads it, shown at its right edge. */
  chord?: string;
  action?: () => void;
  disabled?: boolean;
  /** Renders a divider line instead of a button. */
  separator?: boolean;
  /**
   * Nested entries. A row that carries them opens them in a panel beside
   * itself on hover (or on focus, for the keyboard) rather than acting on a
   * click of its own.
   */
  items?: ContextMenuItem[];
}

/** How the shortcuts read: with `Cmd` and `Option` on a Mac. */
export interface ContextMenuOptions {
  mac?: boolean;
}

/**
 * A nested panel's items with every deeper submenu laid out in them. The
 * window draws one panel beside a menu, never a panel beside a panel, so a
 * submenu inside a submenu - Wipe Stacks > Wipe Out - shows its rows in
 * place, each named after it ("Wipe Out: Subtract Top from Below"), set
 * apart by separators, and greyed when it is.
 */
export function inlineDeeperSubmenus(items: readonly ContextMenuItem[]): ContextMenuItem[] {
  const out: ContextMenuItem[] = [];
  const separate = (): void => {
    if (out.length > 0 && !out[out.length - 1].separator) out.push({ separator: true });
  };
  for (const item of items) {
    if (!item.items || item.items.length === 0) {
      if (item.separator && (out.length === 0 || out[out.length - 1].separator)) continue;
      out.push(item);
      continue;
    }
    separate();
    for (const child of inlineDeeperSubmenus(item.items)) {
      if (child.separator) {
        separate();
        continue;
      }
      out.push({ ...child, label: `${item.label ?? ''}: ${child.label ?? ''}`, disabled: item.disabled === true || child.disabled === true });
    }
    out.push({ separator: true });
  }
  while (out.length > 0 && out[out.length - 1].separator) out.pop();
  return out;
}

/** The widget's items for generated rows, each row that runs a command calling `run` with its id. */
export function contextMenuItems(
  rows: readonly MenuRow[],
  run: (id: string) => void,
  options: ContextMenuOptions = {},
): ContextMenuItem[] {
  return rows.map((row): ContextMenuItem => {
    if (row.kind === 'separator') return { separator: true };
    const item: ContextMenuItem = { label: row.label, disabled: row.disabled };
    if (row.chord !== null) item.chord = displayChord(row.chord, options);
    if (row.submenu !== null) item.items = contextMenuItems(row.submenu, run, options);
    else item.action = () => run(row.id);
    return item;
  });
}
