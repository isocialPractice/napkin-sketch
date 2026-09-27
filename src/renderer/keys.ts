/**
 * Keys to commands.
 *
 * The window's keydown handler gives every open mode, palette and held key
 * its turn first - Escape backing out, Enter finishing a path, Space arming a
 * straight line, digits feeding a quick entry - and asks here only once all of
 * them have let the key go. What comes back is the command the menu registry
 * gives that chord, so a shortcut changed in the user's shortcuts file changes
 * what the key does as well as what the menus and tooltips show.
 *
 * Nothing here touches the DOM, so the lookup is tested on events built by
 * hand.
 */

import { eventChords, type KeyEventLike } from '../core/menu/chords.js';
import { isMenuCommand, type MenuCommand } from '../core/menu/ids.js';
import type { MenuRegistry } from '../core/menu/registry.js';

/**
 * The command a keypress runs, or null.
 *
 * The chord as pressed comes first. When no tool holds it and Shift was held
 * on a letter or a named key, the key without Shift is tried: the key handler
 * always let Shift+P pick the pen and Ctrl+Shift+C copy, and a chord that is
 * a shortcut of its own - Shift+C, Ctrl+Shift+Z - is found first and wins. A
 * mark such as `}` has Shift inside it already, so it is never tried again
 * without it.
 *
 * A chord held by a row the page does not run - a role row, whose key
 * Electron owns, like Ctrl+Shift+I for the developer tools - gives null, and
 * is not tried without Shift either, so that key never becomes Ctrl+I.
 */
export function commandForEvent(registry: MenuRegistry, event: KeyEventLike): MenuCommand | null {
  const exact = holderOf(registry, eventChords(event));
  if (exact !== undefined) return exact;
  if (event.shiftKey && (/^[a-z]$/i.test(event.key) || event.key.length > 1)) {
    // Copied field by field: a KeyboardEvent keeps these as getters on its
    // prototype, which a spread would leave behind.
    const unshifted: KeyEventLike = {
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: false,
    };
    const plain = holderOf(registry, eventChords(unshifted));
    if (plain !== undefined) return plain;
  }
  return null;
}

/** The command the first chord a tool holds runs; null when a row the page does not run holds it; undefined when none is held. */
function holderOf(registry: MenuRegistry, chords: readonly string[]): MenuCommand | null | undefined {
  for (const chord of chords) {
    const id = registry.toolForChord(chord);
    if (id !== null) return isMenuCommand(id) ? id : null;
  }
  return undefined;
}

/**
 * True for a key Chromium reloads the page on - F5, or Ctrl+R with or without
 * Shift - whatever the menus hold. A reload throws the sketch away without
 * asking, so the window swallows these wherever the focus is.
 */
export function isReloadKey(event: KeyEventLike): boolean {
  return event.key === 'F5' || ((event.ctrlKey || event.metaKey === true) && /^r$/i.test(event.key));
}

/** True for Ctrl+T, with or without Shift: a browser's new tab, which the window also keeps for itself. */
export function isNewTabKey(event: KeyEventLike): boolean {
  return (event.ctrlKey || event.metaKey === true) && /^t$/i.test(event.key);
}
