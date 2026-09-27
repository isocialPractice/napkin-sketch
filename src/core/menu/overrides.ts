/**
 * The user's two menu files: what they hold, and how an editor's result
 * becomes one.
 *
 * `shortcuts.json` and `tool-types.json` in the user-data folder, beside
 * `settings.json`, hold only what differs from the files the app ships with.
 * Writing the whole mapping instead would freeze today's defaults into every
 * user's folder, so a shortcut a later release adds or moves would never reach
 * anybody who had once pressed Accept. Reset is deleting the file; the shipped
 * files are never written.
 *
 * Checking an entry is the registry's job ({@link loadRegistry}), because only
 * it knows the tools, the types and the chords the app keeps; this module
 * reads the text and writes the differences.
 */

import { canonicalChord } from './chords.js';
import { OVERRIDES_VERSION } from './ids.js';
import { loadRegistry, SHIPPED_MENU_DATA, type MenuData, type MenuRegistry, type RegistryOverrides } from './registry.js';

/** The user's shortcuts file's name, in the user-data folder. */
export const SHORTCUTS_FILE = 'shortcuts.json';

/** The user's tool types file's name, in the user-data folder. */
export const TOOL_TYPES_FILE = 'tool-types.json';

/** What the user's shortcuts file holds: a chord, or null for none, by tool id. */
export interface ShortcutOverrides {
  readonly version: typeof OVERRIDES_VERSION;
  readonly shortcuts: Readonly<Record<string, string | null>>;
}

/** What the user's tool types file holds: a type, or null for no menu, by tool id. */
export interface ToolTypeOverrides {
  readonly version: typeof OVERRIDES_VERSION;
  readonly tools: Readonly<Record<string, string | null>>;
}

/**
 * Reads a user file's text. Text that is not JSON gives no value and a
 * sentence saying so, which the host shows or logs and then carries on with
 * the shipped files - a broken file costs the user their changes, never the
 * menus.
 */
export function readOverridesText(text: string, what: 'shortcuts' | 'tool types'): { value: unknown; problem: string | null } {
  try {
    return { value: JSON.parse(text), problem: null };
  } catch (error) {
    return { value: null, problem: `The ${what} file is not JSON (${(error as Error).message}), so it was ignored.` };
  }
}

/**
 * The shortcuts file an edited mapping amounts to: every tool whose chord is
 * not the one it ships with, in the order of `tool-types.json`, with null for
 * a tool left with none. A tool the edit does not mention keeps whatever the
 * registry gives it now, so an editor that showed only some rows loses nothing
 * the file held for the rest. A tool whose shortcut cannot change is left out.
 *
 * Throws when an edited value is not a chord: the editor that built it is
 * wrong, and writing it would lose the user's change without a word.
 */
export function shortcutOverrides(registry: MenuRegistry, edited: Readonly<Record<string, string | null>>): ShortcutOverrides {
  const shortcuts: Record<string, string | null> = {};
  for (const tool of registry.tools) {
    if (tool.shortcutFixed !== null) continue;
    let chord = tool.chord;
    if (Object.prototype.hasOwnProperty.call(edited, tool.id)) {
      const value = edited[tool.id];
      chord = value === null ? null : canonicalChord(value);
      if (value !== null && chord === null) throw new Error(`shortcutOverrides: "${value}" is not a shortcut.`);
    }
    if (chord !== tool.shippedChord) shortcuts[tool.id] = chord;
  }
  return { version: OVERRIDES_VERSION, shortcuts };
}

/**
 * The tool types file an edited placement amounts to: every tool placed
 * somewhere other than where it ships, with null for a tool taken out of every
 * menu. As with {@link shortcutOverrides}, a tool the edit does not mention
 * keeps what it has, and a tool that cannot move is left out.
 */
export function toolTypeOverrides(registry: MenuRegistry, edited: Readonly<Record<string, string | null>>): ToolTypeOverrides {
  const tools: Record<string, string | null> = {};
  for (const tool of registry.tools) {
    if (tool.placementFixed !== null) continue;
    const placement = Object.prototype.hasOwnProperty.call(edited, tool.id) ? edited[tool.id] : tool.placement;
    if (placement !== tool.shippedPlacement) tools[tool.id] = placement;
  }
  return { version: OVERRIDES_VERSION, tools };
}

/** True when a file would hold nothing - the host deletes the file then, rather than writing an empty one. */
export function hasOverrides(overrides: ShortcutOverrides | ToolTypeOverrides): boolean {
  const entries = 'shortcuts' in overrides ? overrides.shortcuts : overrides.tools;
  return Object.keys(entries).length > 0;
}

/** A user file's text: two-space JSON and a final newline, so it reads and diffs like the shipped files. */
export function serializeOverrides(overrides: ShortcutOverrides | ToolTypeOverrides): string {
  return `${JSON.stringify(overrides, null, 2)}\n`;
}

// ---- Saving an editor's result ------------------------------------------------------

/** What an editor hands the host on Accept: the whole mapping it edited, for one file or both. */
export interface MenuConfigUpdate {
  /** A chord, or null for none, by tool id. */
  readonly shortcuts?: Readonly<Record<string, string | null>>;
  /** A type, or null for no menu, by tool id. */
  readonly toolTypes?: Readonly<Record<string, string | null>>;
}

/** What saving an editor's result does to the user's two files. */
export interface UserFilesPlan {
  /** The shortcuts file's new text; null to delete the file; absent to leave it as it is. */
  readonly shortcuts?: string | null;
  /** The tool types file's new text; null to delete the file; absent to leave it as it is. */
  readonly toolTypes?: string | null;
  /**
   * What the new files would bring that the files there now do not, as
   * sentences. The host writes nothing while there are any, so a result the
   * registry would refuse, or quietly rewrite, is never saved.
   */
  readonly problems: readonly string[];
}

/** An editor's mapping as it came over IPC, when it is one: tool ids to a string or null. */
function asMapping(value: unknown): Record<string, string | null> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const mapping: Record<string, string | null> = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry !== null && typeof entry !== 'string') return null;
    mapping[id] = entry;
  }
  return mapping;
}

/**
 * Plans what saving an editor's accepted result writes. For each file the
 * update names, the result is the differences from the shipped files as the
 * file's text, or null when nothing differs and the file should go - which
 * is how Reset to defaults ends. `current` is the user's two files as they
 * stand, parsed; `update` arrives over IPC, so it is checked here, and
 * anything but a mapping of tools to chords (or types) and null is refused
 * with a sentence rather than written.
 *
 * The new files are read back through {@link loadRegistry} before anything is
 * written: a sentence it says of them that it does not say of the files there
 * now is a problem, and the plan carries it instead of a change.
 */
export function planUserFiles(current: RegistryOverrides, update: unknown, data: MenuData = SHIPPED_MENU_DATA): UserFilesPlan {
  if (update === null || typeof update !== 'object' || Array.isArray(update)) {
    return { problems: ['The menu changes to save are not a set of changes.'] };
  }
  const { shortcuts, toolTypes } = update as { shortcuts?: unknown; toolTypes?: unknown };
  const registry = loadRegistry(current, data);
  const next: RegistryOverrides = { shortcuts: current.shortcuts, toolTypes: current.toolTypes };
  const plan: { shortcuts?: string | null; toolTypes?: string | null } = {};
  const problems: string[] = [];
  const unknownTools = (mapping: Record<string, string | null>, what: string): void => {
    for (const id of Object.keys(mapping)) {
      if (!registry.tool(id)) problems.push(`The ${what} to save name "${id}", which is not a tool.`);
    }
  };

  if (shortcuts !== undefined) {
    const mapping = asMapping(shortcuts);
    if (mapping === null) return { problems: ['The shortcuts to save are not a list of tools and their shortcuts.'] };
    unknownTools(mapping, 'shortcuts');
    for (const value of Object.values(mapping)) {
      if (value !== null && canonicalChord(value) === null) problems.push(`"${value}" is not a shortcut.`);
    }
    if (problems.length > 0) return { problems };
    const overrides = shortcutOverrides(registry, mapping);
    next.shortcuts = hasOverrides(overrides) ? overrides : undefined;
    plan.shortcuts = hasOverrides(overrides) ? serializeOverrides(overrides) : null;
  }

  if (toolTypes !== undefined) {
    const mapping = asMapping(toolTypes);
    if (mapping === null) return { problems: ['The tool types to save are not a list of tools and their types.'] };
    unknownTools(mapping, 'tool types');
    if (problems.length > 0) return { problems };
    const overrides = toolTypeOverrides(registry, mapping);
    next.toolTypes = hasOverrides(overrides) ? overrides : undefined;
    plan.toolTypes = hasOverrides(overrides) ? serializeOverrides(overrides) : null;
  }

  const before = new Set(registry.problems);
  const brought = loadRegistry(next, data).problems.filter((problem) => !before.has(problem));
  return brought.length > 0 ? { problems: brought } : { ...plan, problems: [] };
}
