/**
 * The menu bar, from the menu registry.
 *
 * `nativeMenus` in the registry already gives the template's shape - labels,
 * accelerators, roles, which rows the page takes the key for - so all that is
 * left here is what only the main process knows: what a click does. Every
 * row calls one function with its id, and that function decides whether the
 * main process runs it or the drawing window does.
 *
 * The menu bar is built once, and rebuilt only when its rows change: a
 * different registry, or an answer that hides or shows a row. Which rows are
 * enabled and which are checked changes far more often - every selection,
 * every undo step - and Electron lets both be set on the items it already
 * has, so {@link rowStates} gives them to the main process to apply in place
 * rather than re-creating the menu bar each time.
 *
 * Nothing here imports Electron at run time (the one import is a type), so
 * the unit tests build the template the app does.
 */

import type { MenuItemConstructorOptions } from 'electron';
import { menuTree, nativeMenus, type MenuRegistry, type MenuRow, type NativeItem } from '../core/menu/registry.js';
import type { MenuState } from '../core/menu/ids.js';

/** What a click on a row does, by the row's id. */
export type MenuClick = (id: string) => void;

function bindItem(item: NativeItem, click: MenuClick): MenuItemConstructorOptions {
  if ('role' in item) return { role: item.role };
  if (!('id' in item)) return { type: 'separator' };
  const { submenu, ...rest } = item;
  if (submenu) return { ...rest, submenu: submenu.map((child) => bindItem(child, click)) };
  return { ...rest, click: () => click(item.id) };
}

/**
 * The menu bar as an Electron template: the registry's rows for this state,
 * each row that runs a command given a click that calls `click` with its id.
 */
export function applicationMenuTemplate(registry: MenuRegistry, state: MenuState, click: MenuClick): MenuItemConstructorOptions[] {
  return nativeMenus(registry, state).map((menu) => ({
    label: menu.label,
    submenu: menu.submenu.map((item) => bindItem(item, click)),
  }));
}

/** Whether one row is enabled, and whether it is checked when it has a check mark. */
export interface RowState {
  readonly id: string;
  readonly enabled: boolean;
  /** Null for a row with no check mark. */
  readonly checked: boolean | null;
}

/** Every row of the menu bar that has an id, with what this state makes of it. */
export function rowStates(registry: MenuRegistry, state: MenuState): RowState[] {
  const found: RowState[] = [];
  const visit = (rows: readonly MenuRow[]): void => {
    for (const row of rows) {
      if (row.kind === 'separator') continue;
      if (row.role === null) found.push({ id: row.id, enabled: !row.disabled, checked: row.checked });
      if (row.submenu) visit(row.submenu);
    }
  };
  for (const menu of menuTree(registry, state)) visit(menu.items);
  return found;
}

/**
 * What decides the menu bar's rows, as opposed to their states: the answers
 * to the questions that hide rows. Two states with the same key have the same
 * rows, so the main process only rebuilds when the key changes.
 */
export function menuStructureKey(registry: MenuRegistry, state: MenuState): string {
  const questions = [...new Set(registry.tools.flatMap((tool) => (tool.hiddenWhen === null ? [] : [tool.hiddenWhen])))].sort();
  return questions.map((question) => `${question}=${state[question] === true}`).join(',');
}
