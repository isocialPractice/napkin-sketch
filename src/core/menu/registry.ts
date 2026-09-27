/**
 * The menu registry: every command the app has, what kind of tool it is, its
 * keyboard shortcut, and the menus that are generated from those facts.
 *
 * Two files hold the data. `tool-types.json` names each tool, gives it a type
 * - `Main:sub`, such as `Composition:edit:mixed` for Cut or
 * `Draw:Modify:element` for Rotate - and lists the menus with the sub-types
 * each one accepts. `shortcuts.json` gives the tools their chords. Nothing
 * says which menu a tool is in: a tool is in every menu that accepts its
 * type, so the clipboard rows reach Edit, the canvas and the layers panel from
 * one type, and a new feature appears in the right menus by declaring what it
 * is. A type whose sub-part is a menu's own id (`App:file`) is that menu's
 * alone.
 *
 * The user can move a tool to another type and give it another chord. Those
 * choices live in two files of the same names in the user-data folder, which
 * hold only what differs from the shipped files; {@link loadRegistry} reads
 * both, checks every entry, and keeps the shipped files untouched.
 *
 * From the merged registry come the menu bar ({@link menuTree},
 * {@link nativeMenus}), the menus drawn inside the window
 * ({@link contextItems}), and the Help menu's Tool Types rows
 * ({@link helpTopics}). All of it is pure and DOM-free: the main process
 * builds the native menu from it, the renderer builds its right-click menus
 * and dropdowns from it, and the tests read it with neither.
 */

import toolTypesJson from './tool-types.json';
import shortcutsJson from './shortcuts.json';
import { canonicalChord, displayChord, isBareChord, reservedReason, toAccelerator } from './chords.js';
import {
  COMMAND_IDS,
  ELECTRON_ROLES,
  HELP_TOPIC_PREFIX,
  MENU_POSITIONS,
  MENU_PREDICATES,
  OVERRIDES_VERSION,
  type ElectronRole,
  type HelpTopicId,
  type MenuPosition,
  type MenuPredicate,
  type MenuState,
} from './ids.js';

// ---- The files, as written -----------------------------------------------

/** A sub-type a menu can accept, and the main type it belongs to. */
export interface SubTypeSpec {
  id: string;
  main: string;
}

/** A sub-type a menu accepts: where its rows go, and in which position. */
export interface AcceptSpec {
  type: string;
  /** The separator-delimited block the rows go in. Without it, each row's own `group`. */
  group?: number;
  /** Only in this position. Without it, in every position the menu is drawn in. */
  when?: MenuPosition;
}

/** The page Help > Tool Types opens for a menu. */
export interface HelpSpec {
  label: string;
  page: string;
  /** Where the row sits in Tool Types. Rows without one follow, in menu order. */
  order?: number;
}

/** A menu as `tool-types.json` writes it. */
export interface MenuSpec {
  id: string;
  label: string;
  type: string;
  /** False for a menu that is never in the menu bar. Default true. */
  top?: boolean;
  /** The element whose right-click menu, or whose dropdown, this menu is. */
  panel?: string;
  /** A dropdown that shows this tool's submenu, rather than rows of its own. */
  from?: string;
  accepts?: (string | AcceptSpec)[];
  help?: HelpSpec;
}

/** A tool as `tool-types.json` writes it. */
export interface ToolSpec {
  id: string;
  /** What the menus show; `{ top, panel }` when the menu bar and the window say it differently. */
  label: string | { top: string; panel: string };
  /** The tool's full name, where the label alone is too short to stand in a list. */
  name?: string;
  /**
   * One line on what the tool does beyond its name, for the notes column of
   * the generated shortcut tables: `Hold Shift for a square`.
   */
  summary?: string;
  /** `Main:sub`. Every tool outside a submenu has one; a submenu's rows take their parent's. */
  type?: string;
  parent?: string;
  group?: number;
  role?: string;
  /** `menu`: the native menu takes the chord even from a text field. The default, `page`, leaves it to the page. */
  claim?: 'menu' | 'page';
  /** The row opens a dialog, so its label ends in an ellipsis. */
  dots?: boolean;
  /** `main`: the main process runs the command itself. */
  host?: 'main';
  disabledWhen?: string;
  hiddenWhen?: string;
  checked?: string;
  /** The menus the row is in, whatever its type accepts. */
  only?: string[];
  /** False for a toolbar or keyboard command that no menu holds until the user puts it in one. */
  inMenus?: boolean;
  /** Why the tool cannot be moved to another type, for one the general rules do not cover. */
  fixed?: string;
  /** The submenu is made rather than listed. */
  generate?: 'helpTopics';
}

/** `tool-types.json`. */
export interface ToolTypesFile {
  version: number;
  mainTypes: string[];
  subTypes: SubTypeSpec[];
  menus: MenuSpec[];
  tools: ToolSpec[];
}

/** `shortcuts.json`. */
export interface ShortcutsFile {
  version: number;
  shortcuts: Record<string, string>;
  /** Chords that also run a tool but are not shown: `Ctrl+Y` redoes as well as `Ctrl+Shift+Z`. */
  aliases?: Record<string, string[]>;
}

/** Both files. */
export interface MenuData {
  toolTypes: ToolTypesFile;
  shortcuts: ShortcutsFile;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * The files the app ships, frozen: whatever a user file says, these are what
 * Reset returns to, so nothing may write to them.
 */
export const SHIPPED_MENU_DATA: MenuData = deepFreeze({
  toolTypes: toolTypesJson as unknown as ToolTypesFile,
  shortcuts: shortcutsJson as unknown as ShortcutsFile,
});

// ---- The merged registry ------------------------------------------------

/** How a menu accepts one sub-type. */
export interface AcceptInfo {
  readonly type: string;
  readonly group: number | null;
  readonly when: MenuPosition | null;
}

/** A menu, as the registry holds it. */
export interface MenuInfo {
  readonly id: string;
  readonly index: number;
  readonly label: string;
  readonly type: string;
  readonly top: boolean;
  readonly panel: string | null;
  readonly from: string | null;
  readonly accepts: readonly AcceptInfo[];
  readonly help: { readonly label: string; readonly page: string; readonly order: number | null } | null;
}

/** A tool with the user's files applied. */
export interface ToolInfo {
  readonly id: string;
  /** Its place in `tool-types.json`, which orders the rows of a block. */
  readonly index: number;
  readonly label: string | { readonly top: string; readonly panel: string };
  /** The full name, for a list with no menu around it. */
  readonly name: string;
  /** One line on what the tool does beyond its name, or null. */
  readonly summary: string | null;
  /** The type the tool is now: its placement, or the shipped type when it is in no menu. */
  readonly type: string;
  readonly shippedType: string;
  /** The type the menus place it by, or null when it is in none. */
  readonly placement: string | null;
  readonly shippedPlacement: string | null;
  readonly parent: string | null;
  /** The rows of its submenu, in file order. */
  readonly children: readonly string[];
  readonly group: number | null;
  readonly role: ElectronRole | null;
  readonly claim: 'menu' | 'page';
  readonly dots: boolean;
  readonly host: 'main' | 'renderer';
  readonly disabledWhen: MenuPredicate | null;
  readonly hiddenWhen: MenuPredicate | null;
  readonly checked: MenuPredicate | null;
  readonly only: readonly string[] | null;
  readonly generate: 'helpTopics' | null;
  /** The chord, canonical, or null for none. */
  readonly chord: string | null;
  readonly shippedChord: string | null;
  /** Chords that also run it and are not shown. */
  readonly aliases: readonly string[];
  /** Why the tool cannot be moved to another type, or null when it can. */
  readonly placementFixed: string | null;
  /** Why the tool's shortcut cannot be changed, or null when it can. */
  readonly shortcutFixed: string | null;
}

/** The shipped files with the user's applied: the one place the menus are made from. */
export interface MenuRegistry {
  readonly mainTypes: readonly string[];
  readonly subTypes: readonly SubTypeSpec[];
  readonly menus: readonly MenuInfo[];
  readonly tools: readonly ToolInfo[];
  /** What the user's files said that could not be used, and what applying them changed, as sentences. */
  readonly problems: readonly string[];
  tool(id: string): ToolInfo | undefined;
  menu(id: string): MenuInfo | undefined;
  /** The tool a chord runs, by its shortcut or by an alias; null when none does. */
  toolForChord(chord: string): string | null;
}

/** The user's two files, parsed. Either may be missing. */
export interface RegistryOverrides {
  /** `{ version: 1, tools: { <id>: <type> | null } }`; null takes a tool out of every menu. */
  toolTypes?: unknown;
  /** `{ version: 1, shortcuts: { <id>: <chord> | null } }`; null leaves a tool with no shortcut. */
  shortcuts?: unknown;
}

/** A type taken apart at its first colon: `Draw:Add:vector` is `Draw` and `Add:vector`. */
export function splitType(type: string): { main: string; sub: string } | null {
  const colon = type.indexOf(':');
  if (colon <= 0 || colon === type.length - 1) return null;
  return { main: type.slice(0, colon), sub: type.slice(colon + 1) };
}

/** The menu text for a label, before any ellipsis. */
function plainLabel(label: ToolSpec['label'], position: MenuPosition = 'top'): string {
  return typeof label === 'string' ? label : label[position];
}

function asPredicate(value: string | undefined): MenuPredicate | null {
  return value !== undefined && (MENU_PREDICATES as readonly string[]).includes(value) ? (value as MenuPredicate) : null;
}

/**
 * The entries of one user file, or none when the file cannot be used - with
 * the reason added to `problems`.
 */
function overrideEntries(raw: unknown, key: 'tools' | 'shortcuts', what: string, problems: string[]): [string, unknown][] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push(`The ${what} file is not a JSON object, so it was ignored.`);
    return [];
  }
  const file = raw as Record<string, unknown>;
  if (file.version !== undefined && file.version !== OVERRIDES_VERSION) {
    problems.push(`The ${what} file is version ${String(file.version)}, which this build does not read, so it was ignored.`);
    return [];
  }
  const entries = file[key];
  if (entries === undefined) return [];
  if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) {
    problems.push(`The ${what} file's "${key}" is not an object, so it was ignored.`);
    return [];
  }
  return Object.entries(entries as Record<string, unknown>);
}

/**
 * Reads the shipped files and the user's, and merges them.
 *
 * Every user entry is checked against the shipped files. An entry that names
 * no tool, gives a type no menu can place by, asks to move a tool that stays
 * where it is, or gives a chord that is not one or that the app keeps for
 * itself, is left out, and `problems` says so in a sentence. A chord a user
 * entry gives one tool is taken from the tool that shipped with it, and two
 * entries asking for one chord leave it with the first. Aliases are kept only
 * by a tool still on its shipped chord, and only while no shortcut uses them.
 */
export function loadRegistry(overrides: RegistryOverrides = {}, data: MenuData = SHIPPED_MENU_DATA): MenuRegistry {
  const problems: string[] = [];
  const file = data.toolTypes;
  const specs = file.tools;
  const specById = new Map(specs.map((spec) => [spec.id, spec]));
  const menuById = new Map(file.menus.map((menu) => [menu.id, menu]));
  const subTypeMain = new Map(file.subTypes.map((sub) => [sub.id, sub.main]));

  const children = new Map<string, string[]>();
  for (const spec of specs) {
    if (spec.parent === undefined) continue;
    const list = children.get(spec.parent) ?? [];
    list.push(spec.id);
    children.set(spec.parent, list);
  }

  const topAncestor = (spec: ToolSpec): ToolSpec => {
    let current = spec;
    for (let hops = 0; current.parent !== undefined && hops < specs.length; hops++) {
      const parent = specById.get(current.parent);
      if (!parent) break;
      current = parent;
    }
    return current;
  };
  const nameOf = (spec: ToolSpec): string => spec.name ?? plainLabel(spec.label);

  const placementFixed = new Map<string, string | null>();
  const shortcutFixed = new Map<string, string | null>();
  for (const spec of specs) {
    const opensSubmenu = children.has(spec.id) || spec.generate !== undefined;
    let placement: string | null = null;
    if (spec.fixed !== undefined) placement = spec.fixed;
    else if (spec.parent !== undefined) {
      const parent = specById.get(spec.parent);
      placement = `it moves with the ${parent ? plainLabel(parent.label) : spec.parent} submenu`;
    } else if (spec.role !== undefined) placement = 'Electron draws this row';
    else if (spec.only !== undefined) {
      placement = `it is placed by hand in ${spec.only.map((id) => menuById.get(id)?.label ?? id).join(' and ')} only`;
    } else {
      const split = spec.type ? splitType(spec.type) : null;
      const own = split ? menuById.get(split.sub) : undefined;
      if (own) placement = `it belongs to the ${own.label} menu`;
    }
    placementFixed.set(spec.id, placement);
    shortcutFixed.set(
      spec.id,
      spec.role !== undefined
        ? 'Electron draws this row and owns its shortcut'
        : opensSubmenu
          ? 'it opens a submenu'
          : null,
    );
  }

  // ---- Placement: the shipped type, then the user's tool types file.
  const shippedPlacement = new Map<string, string | null>();
  for (const spec of specs) {
    shippedPlacement.set(spec.id, spec.parent !== undefined || spec.inMenus === false ? null : (spec.type ?? null));
  }
  const placement = new Map(shippedPlacement);
  const isPlaceable = (type: string): boolean => {
    const split = splitType(type);
    return split !== null && subTypeMain.get(split.sub) === split.main;
  };
  for (const [id, value] of overrideEntries(overrides.toolTypes, 'tools', 'tool types', problems)) {
    const spec = specById.get(id);
    if (!spec) {
      problems.push(`The tool types file names "${id}", which is not a tool, so that entry was left out.`);
      continue;
    }
    const fixed = placementFixed.get(id);
    if (fixed) {
      problems.push(`${nameOf(spec)} cannot be moved: ${fixed}. That entry was left out.`);
      continue;
    }
    if (value === null) {
      placement.set(id, null);
    } else if (typeof value === 'string' && isPlaceable(value)) {
      placement.set(id, value);
    } else {
      problems.push(`"${String(value)}" is not a type a tool can be given, so ${nameOf(spec)} keeps its place.`);
    }
  }

  // ---- Chords: the shipped shortcuts, then the user's shortcuts file.
  const shippedChord = new Map<string, string | null>();
  for (const spec of specs) {
    const written = data.shortcuts.shortcuts[spec.id];
    shippedChord.set(spec.id, written === undefined ? null : canonicalChord(written));
  }
  const chord = new Map(shippedChord);
  const roleChords = new Map<string, string>();
  for (const spec of specs) {
    const own = shippedChord.get(spec.id);
    if (spec.role !== undefined && own) roleChords.set(own, spec.id);
  }
  const overridden = new Set<string>();
  const taken = new Map<string, string>();
  const describe = (id: string): string => {
    const own = chord.get(id);
    return own ? displayChord(own) : 'no shortcut';
  };
  for (const [id, value] of overrideEntries(overrides.shortcuts, 'shortcuts', 'shortcuts', problems)) {
    const spec = specById.get(id);
    if (!spec) {
      problems.push(`The shortcuts file names "${id}", which is not a tool, so that entry was left out.`);
      continue;
    }
    const fixed = shortcutFixed.get(id);
    if (fixed) {
      problems.push(`The shortcut of ${nameOf(spec)} cannot be changed: ${fixed}. That entry was left out.`);
      continue;
    }
    if (value === null) {
      chord.set(id, null);
      overridden.add(id);
      continue;
    }
    const canonical = typeof value === 'string' ? canonicalChord(value) : null;
    if (canonical === null) {
      problems.push(`"${String(value)}" is not a shortcut, so ${nameOf(spec)} keeps ${describe(id)}.`);
      continue;
    }
    const reserved = reservedReason(canonical);
    if (reserved) {
      problems.push(`${displayChord(canonical)} cannot be a shortcut: ${reserved}. ${nameOf(spec)} keeps ${describe(id)}.`);
      continue;
    }
    const role = roleChords.get(canonical);
    if (role !== undefined && role !== id) {
      const roleSpec = specById.get(role);
      problems.push(
        `${displayChord(canonical)} belongs to ${roleSpec ? nameOf(roleSpec) : role}, which Electron draws, so ${nameOf(spec)} keeps ${describe(id)}.`,
      );
      continue;
    }
    const earlier = taken.get(canonical);
    if (earlier !== undefined) {
      const earlierSpec = specById.get(earlier);
      const earlierName = earlierSpec ? nameOf(earlierSpec) : earlier;
      problems.push(`${displayChord(canonical)} is given to both ${earlierName} and ${nameOf(spec)}; ${earlierName} keeps it.`);
      continue;
    }
    chord.set(id, canonical);
    overridden.add(id);
    taken.set(canonical, id);
  }
  for (const [canonical, owner] of taken) {
    for (const spec of specs) {
      if (spec.id === owner || overridden.has(spec.id) || chord.get(spec.id) !== canonical) continue;
      chord.set(spec.id, null);
      const ownerSpec = specById.get(owner);
      problems.push(
        `${displayChord(canonical)} now belongs to ${ownerSpec ? nameOf(ownerSpec) : owner}, so ${nameOf(spec)} has no shortcut.`,
      );
    }
  }

  // ---- The chord index: shortcuts first, then the aliases nothing else uses.
  const byChord = new Map<string, string>();
  for (const spec of specs) {
    const own = chord.get(spec.id);
    if (own && !byChord.has(own)) byChord.set(own, spec.id);
  }
  const aliases = new Map<string, string[]>();
  for (const [id, list] of Object.entries(data.shortcuts.aliases ?? {})) {
    if (chord.get(id) !== shippedChord.get(id)) continue;
    for (const written of list) {
      const canonical = canonicalChord(written);
      if (canonical === null || byChord.has(canonical)) continue;
      byChord.set(canonical, id);
      aliases.set(id, [...(aliases.get(id) ?? []), canonical]);
    }
  }

  // ---- Effective types: a submenu row takes its top-level ancestor's.
  const effectiveType = (spec: ToolSpec): string => {
    const top = topAncestor(spec);
    return placement.get(top.id) ?? top.type ?? '';
  };

  const tools: ToolInfo[] = specs.map((spec, index) =>
    deepFreeze({
      id: spec.id,
      index,
      label: typeof spec.label === 'string' ? spec.label : { top: spec.label.top, panel: spec.label.panel },
      name: nameOf(spec),
      summary: spec.summary ?? null,
      type: effectiveType(spec),
      shippedType: topAncestor(spec).type ?? '',
      placement: placement.get(spec.id) ?? null,
      shippedPlacement: shippedPlacement.get(spec.id) ?? null,
      parent: spec.parent ?? null,
      children: children.get(spec.id) ?? [],
      group: spec.group ?? null,
      role: spec.role !== undefined && (ELECTRON_ROLES as readonly string[]).includes(spec.role) ? (spec.role as ElectronRole) : null,
      claim: spec.claim === 'menu' ? 'menu' : 'page',
      dots: spec.dots === true,
      host: spec.host === 'main' ? 'main' : 'renderer',
      disabledWhen: asPredicate(spec.disabledWhen),
      hiddenWhen: asPredicate(spec.hiddenWhen),
      checked: asPredicate(spec.checked),
      only: spec.only ? [...spec.only] : null,
      generate: spec.generate === 'helpTopics' ? 'helpTopics' : null,
      chord: chord.get(spec.id) ?? null,
      shippedChord: shippedChord.get(spec.id) ?? null,
      aliases: aliases.get(spec.id) ?? [],
      placementFixed: placementFixed.get(spec.id) ?? null,
      shortcutFixed: shortcutFixed.get(spec.id) ?? null,
    } satisfies ToolInfo),
  );

  const menus: MenuInfo[] = file.menus.map((menu, index) =>
    deepFreeze({
      id: menu.id,
      index,
      label: menu.label,
      type: menu.type,
      top: menu.top !== false,
      panel: menu.panel ?? null,
      from: menu.from ?? null,
      accepts: (menu.accepts ?? []).map((accept) =>
        typeof accept === 'string'
          ? { type: accept, group: null, when: null }
          : { type: accept.type, group: accept.group ?? null, when: accept.when ?? null },
      ),
      help: menu.help ? { label: menu.help.label, page: menu.help.page, order: menu.help.order ?? null } : null,
    } satisfies MenuInfo),
  );

  const toolIndex = new Map(tools.map((tool) => [tool.id, tool]));
  const menuIndex = new Map(menus.map((menu) => [menu.id, menu]));
  return Object.freeze({
    mainTypes: Object.freeze([...file.mainTypes]),
    subTypes: deepFreeze(file.subTypes.map((sub) => ({ id: sub.id, main: sub.main }))),
    menus: Object.freeze(menus),
    tools: Object.freeze(tools),
    problems: Object.freeze(problems),
    tool: (id: string) => toolIndex.get(id),
    menu: (id: string) => menuIndex.get(id),
    toolForChord: (text: string) => {
      const canonical = canonicalChord(text);
      return canonical === null ? null : (byChord.get(canonical) ?? null);
    },
  });
}

let shipped: MenuRegistry | null = null;

/** The registry of the shipped files alone, made once. */
export function defaultRegistry(): MenuRegistry {
  shipped ??= loadRegistry();
  return shipped;
}

// ---- Generated menus --------------------------------------------------------

/** One row of a generated menu. */
export interface MenuNode {
  readonly kind: 'item';
  /** A tool id, or a Help > Tool Types row's `help-topic:<menu>`. */
  readonly id: string;
  /** What the row says in this position, with the ellipsis of a row that opens a dialog. */
  readonly label: string;
  /** The chord shown beside it, canonical; null on a submenu row and a row with none. */
  readonly chord: string | null;
  /** The Electron role that draws and runs it, or null. */
  readonly role: ElectronRole | null;
  /** Who takes the chord: the native menu, or the page (see {@link isBareChord}). */
  readonly claim: 'menu' | 'page';
  /** Which process runs the command. */
  readonly host: 'main' | 'renderer';
  readonly disabled: boolean;
  /** The question that disables it, whatever this state answered. */
  readonly disabledWhen: MenuPredicate | null;
  /** Whether a check mark shows, for a row that has one; null for a row that has none. */
  readonly checked: boolean | null;
  /** The rows it opens, or null for a row that runs a command. */
  readonly submenu: readonly MenuRow[] | null;
  /** The documentation page a Help > Tool Types row opens, or null. */
  readonly page: string | null;
}

/** A line between two blocks of rows. */
export interface MenuSeparator {
  readonly kind: 'separator';
}

/** A row or a separator. */
export type MenuRow = MenuNode | MenuSeparator;

/** One menu of the menu bar. */
export interface TopMenu {
  readonly id: string;
  readonly label: string;
  readonly items: readonly MenuRow[];
}

/** A Help > Tool Types row: the menu it documents and the page it opens. */
export interface HelpTopic {
  readonly id: HelpTopicId;
  readonly menu: string;
  readonly label: string;
  readonly page: string;
}

const ELLIPSIS = String.fromCharCode(0x2026);

function answer(state: MenuState, question: MenuPredicate | null): boolean {
  return question !== null && state[question] === true;
}

/** Who takes a tool's chord: Electron for a role; the page for no chord or a bare one; else the tool's own claim. */
function claimOf(tool: ToolInfo): 'menu' | 'page' {
  if (tool.role !== null) return 'menu';
  if (tool.chord === null || isBareChord(tool.chord)) return 'page';
  return tool.claim;
}

function labelAt(tool: ToolInfo, position: MenuPosition): string {
  return plainLabel(tool.label, position) + (tool.dots ? ELLIPSIS : '');
}

/**
 * Whether a top-level tool is in `menu` in `position`: `null` when it is not,
 * otherwise how the menu takes it - through an accepted sub-type, or (with no
 * accept) as one of the menu's own rows.
 */
function placementIn(tool: ToolInfo, menu: MenuInfo, position: MenuPosition): { accept: AcceptInfo | null } | null {
  if (tool.parent !== null || tool.placement === null) return null;
  return typeIn(tool.placement, menu, position);
}

/**
 * Whether a menu lists a tool of this type in this position: the menu's own
 * type (`App:file` in File), or a sub-type it accepts there. The accept is
 * the entry that let it in, which may pin its block.
 */
function typeIn(type: string, menu: MenuInfo, position: MenuPosition): { accept: AcceptInfo | null } | null {
  const split = splitType(type);
  if (!split) return null;
  if (split.sub === menu.id) return { accept: null };
  const accept = menu.accepts.find((entry) => entry.type === split.sub && (entry.when === null || entry.when === position));
  return accept ? { accept } : null;
}

/**
 * The Help > Tool Types rows: one for every menu that names a help page, by
 * the order the menu gives it and then in menu order.
 */
export function helpTopics(registry: MenuRegistry): HelpTopic[] {
  return registry.menus
    .filter((menu) => menu.help !== null)
    .sort((a, b) => (a.help!.order ?? Infinity) - (b.help!.order ?? Infinity) || a.index - b.index)
    .map((menu) => ({
      id: `${HELP_TOPIC_PREFIX}${menu.id}` as HelpTopicId,
      menu: menu.id,
      label: menu.help!.label,
      page: menu.help!.page,
    }));
}

function topicNode(topic: HelpTopic): MenuNode {
  return {
    kind: 'item',
    id: topic.id,
    label: topic.label,
    chord: null,
    role: null,
    claim: 'page',
    host: 'main',
    disabled: false,
    disabledWhen: null,
    checked: null,
    submenu: null,
    page: topic.page,
  };
}

/** Rows in blocks: a separator wherever the group changes. */
function withSeparators(entries: { group: number; node: MenuNode | null }[]): MenuRow[] {
  const rows: MenuRow[] = [];
  let last: number | null = null;
  for (const entry of entries) {
    if (entry.node === null) continue;
    if (last !== null && entry.group !== last) rows.push({ kind: 'separator' });
    rows.push(entry.node);
    last = entry.group;
  }
  return rows;
}

/** A submenu's rows, as the parent's context shows them. */
function childRows(registry: MenuRegistry, parent: ToolInfo, position: MenuPosition, state: MenuState, context: string): MenuRow[] {
  if (parent.generate === 'helpTopics') return helpTopics(registry).map(topicNode);
  const kids = parent.children
    .map((id) => registry.tool(id))
    .filter((tool): tool is ToolInfo => tool !== undefined)
    .filter((tool) => (tool.only === null || tool.only.includes(context)) && !answer(state, tool.hiddenWhen))
    .sort((a, b) => (a.group ?? 1) - (b.group ?? 1) || a.index - b.index);
  return withSeparators(kids.map((tool) => ({ group: tool.group ?? 1, node: nodeFor(registry, tool, position, state, context) })));
}

/** A tool's row, or null for a submenu with nothing in it here. */
function nodeFor(registry: MenuRegistry, tool: ToolInfo, position: MenuPosition, state: MenuState, context: string): MenuNode | null {
  const opens = tool.children.length > 0 || tool.generate !== null;
  const submenu = opens ? childRows(registry, tool, position, state, context) : null;
  if (submenu !== null && submenu.length === 0) return null;
  return {
    kind: 'item',
    id: tool.id,
    label: labelAt(tool, position),
    chord: opens ? null : tool.chord,
    role: tool.role,
    claim: claimOf(tool),
    host: tool.host,
    disabled: answer(state, tool.disabledWhen),
    disabledWhen: tool.disabledWhen,
    checked: tool.checked === null ? null : answer(state, tool.checked),
    submenu,
    page: null,
  };
}

/**
 * A menu's rows in one position.
 *
 * A row's block is the one the menu's accept names for its sub-type, else the
 * tool's own `group`. A tool the user moved to another type joins the block of
 * the last shipped row of that type in the menu, after the shipped rows, and
 * opens a block of its own at the end when the menu has none; within a block,
 * rows keep the order of `tool-types.json`.
 */
function menuRows(registry: MenuRegistry, menu: MenuInfo, position: MenuPosition, state: MenuState): MenuRow[] {
  const context = menu.id;
  const shippedRows: { tool: ToolInfo; group: number; moved: boolean }[] = [];
  const movedRows: { tool: ToolInfo; group: number | null }[] = [];
  for (const tool of registry.tools) {
    const hit = placementIn(tool, menu, position);
    if (hit === null) continue;
    if (tool.only !== null && !tool.only.includes(context)) continue;
    if (answer(state, tool.hiddenWhen)) continue;
    if (tool.placement === tool.shippedPlacement) {
      shippedRows.push({ tool, group: hit.accept?.group ?? tool.group ?? 1, moved: false });
    } else {
      movedRows.push({ tool, group: hit.accept?.group ?? null });
    }
  }
  const lastGroup = shippedRows.reduce((max, row) => Math.max(max, row.group), 0);
  const all = [
    ...shippedRows,
    ...movedRows.map((row) => {
      if (row.group !== null) return { tool: row.tool, group: row.group, moved: true };
      const sub = splitType(row.tool.placement ?? '')?.sub;
      const same = shippedRows.filter((other) => splitType(other.tool.placement ?? '')?.sub === sub);
      return { tool: row.tool, group: same.length > 0 ? same[same.length - 1].group : lastGroup + 1, moved: true };
    }),
  ].sort((a, b) => a.group - b.group || Number(a.moved) - Number(b.moved) || a.tool.index - b.tool.index);
  return withSeparators(all.map((row) => ({ group: row.group, node: nodeFor(registry, row.tool, position, state, context) })));
}

/** The menu bar: every menu that is in it, in file order, with the rows this state shows. */
export function menuTree(registry: MenuRegistry, state: MenuState = {}): TopMenu[] {
  return registry.menus
    .filter((menu) => menu.top && menu.from === null)
    .map((menu) => ({ id: menu.id, label: menu.label, items: menuRows(registry, menu, 'top', state) }));
}

/**
 * The rows of a menu drawn inside the window: a panel's right-click menu (the
 * menu's rows in the panel position), or a toolbar button's dropdown (the
 * submenu its menu shows). Throws for an id that names no such menu - a
 * mistake in the code that asked, not something a user can cause.
 */
export function contextItems(registry: MenuRegistry, contextId: string, state: MenuState = {}): MenuRow[] {
  const menu = registry.menu(contextId);
  if (!menu || menu.panel === null) {
    throw new Error(`contextItems: "${contextId}" is not a menu drawn inside the window.`);
  }
  if (menu.from !== null) {
    const parent = registry.tool(menu.from);
    if (!parent) throw new Error(`contextItems: "${contextId}" shows "${menu.from}", which is not a tool.`);
    return childRows(registry, parent, 'panel', state, menu.id);
  }
  return menuRows(registry, menu, 'panel', state);
}

/** Where a tool is shown: a menu and a position. */
export interface Placement {
  readonly menu: string;
  readonly position: MenuPosition;
}

/**
 * Every menu and position a tool shows in, whatever the app's state - so an
 * editor can say that a tool is shown nowhere.
 */
export function whereShown(registry: MenuRegistry, id: string): Placement[] {
  const found: Placement[] = [];
  const visit = (rows: readonly MenuRow[], menu: string, position: MenuPosition): void => {
    for (const row of rows) {
      if (row.kind === 'separator') continue;
      if (row.id === id && !found.some((place) => place.menu === menu && place.position === position)) found.push({ menu, position });
      if (row.submenu) visit(row.submenu, menu, position);
    }
  };
  for (const menu of registry.menus) {
    if (menu.top && menu.from === null) visit(menuRows(registry, menu, 'top', {}), menu.id, 'top');
    if (menu.panel !== null) visit(contextItems(registry, menu.id, {}), menu.id, 'panel');
  }
  return found;
}

/**
 * Where a tool of this type would be listed: every menu, in each position it
 * is drawn in, that takes the type there - what {@link whereShown} finds for a
 * tool placed by that type, without building a registry for a type the tool
 * does not have yet. That is what an editor needs to say where a change would
 * put a tool. A row placed by hand (`only`) or inside a submenu goes where
 * its row puts it instead; this answers for the type alone, and null - no
 * menu - is listed nowhere.
 */
export function placesFor(registry: MenuRegistry, type: string | null): Placement[] {
  if (type === null) return [];
  const found: Placement[] = [];
  for (const menu of registry.menus) {
    if (menu.from !== null) continue;
    if (menu.top && typeIn(type, menu, 'top')) found.push({ menu: menu.id, position: 'top' });
    if (menu.panel !== null && typeIn(type, menu, 'panel')) found.push({ menu: menu.id, position: 'panel' });
  }
  return found;
}

/**
 * Where a person finds a tool: its path in the menu bar (`Transform >
 * Sharpen`), else the menu inside the window it is in (`Canvas right-click
 * menu`), else `Not in a menu` for a toolbar or keyboard command. A submenu
 * row's path ends at the row that opens its submenu; the tool itself is not
 * part of it.
 */
export function menuPath(registry: MenuRegistry, tool: ToolInfo): string {
  const chain: string[] = [];
  let top = tool;
  while (top.parent !== null) {
    const parent = registry.tool(top.parent);
    if (!parent) break;
    chain.unshift(plainLabel(parent.label));
    top = parent;
  }
  const places = whereShown(registry, top.id);
  const bar = places.find((place) => place.position === 'top');
  if (bar) return [registry.menu(bar.menu)?.label ?? bar.menu, ...chain].join(' > ');
  const inside = places.find((place) => place.position === 'panel');
  if (inside) return `${registry.menu(inside.menu)?.label ?? inside.menu} right-click menu`;
  return 'Not in a menu';
}

/** The types a tool can be moved to, by main type: every sub-type a menu can accept, written `Main:sub`. */
export function placeableTypes(registry: MenuRegistry): { main: string; types: string[] }[] {
  return registry.mainTypes
    .map((main) => ({ main, types: registry.subTypes.filter((sub) => sub.main === main).map((sub) => `${main}:${sub.id}`) }))
    .filter((group) => group.types.length > 0);
}

/** What another tool's hold on a chord means for giving it to this one. */
export type ChordConflict =
  | { readonly kind: 'reserved'; readonly reason: string }
  | { readonly kind: 'tool'; readonly tool: string; readonly fixed: boolean };

/**
 * Whether `chord` is free for tool `id`: null when it is (or is already that
 * tool's), a reason when the app keeps the key for itself, or the tool that
 * holds it - `fixed` when that tool's shortcut cannot be taken from it.
 */
export function chordConflict(registry: MenuRegistry, id: string, chord: string): ChordConflict | null {
  const canonical = canonicalChord(chord);
  if (canonical === null) return null;
  const reason = reservedReason(canonical);
  if (reason) return { kind: 'reserved', reason };
  const holder = registry.toolForChord(canonical);
  if (holder === null || holder === id) return null;
  return { kind: 'tool', tool: holder, fixed: registry.tool(holder)?.shortcutFixed != null };
}

// ---- The native menu bar ------------------------------------------------------

/** A native menu row that runs a command or opens a submenu, in Electron's template shape without its click. */
export interface NativeCommand {
  readonly id: string;
  readonly label: string;
  readonly accelerator?: string;
  readonly registerAccelerator?: false;
  readonly enabled?: false;
  readonly type?: 'checkbox';
  readonly checked?: boolean;
  readonly submenu?: readonly NativeItem[];
}

/** One row of the native menu template. */
export type NativeItem = { readonly type: 'separator' } | { readonly role: ElectronRole } | NativeCommand;

/** One menu of the native menu template. */
export interface NativeMenu {
  readonly label: string;
  readonly submenu: readonly NativeItem[];
}

function nativeItem(row: MenuRow): NativeItem {
  if (row.kind === 'separator') return { type: 'separator' };
  if (row.role !== null) return { role: row.role };
  const item: {
    id: string;
    label: string;
    accelerator?: string;
    registerAccelerator?: false;
    enabled?: false;
    type?: 'checkbox';
    checked?: boolean;
    submenu?: NativeItem[];
  } = { id: row.id, label: row.label };
  if (row.submenu !== null) {
    item.submenu = row.submenu.map(nativeItem);
  } else if (row.chord !== null) {
    const accelerator = toAccelerator(row.chord);
    if (accelerator !== null) {
      item.accelerator = accelerator;
      if (row.claim === 'page') item.registerAccelerator = false;
    }
  }
  if (row.checked !== null) {
    item.type = 'checkbox';
    item.checked = row.checked;
  }
  if (row.disabled) item.enabled = false;
  return item;
}

/**
 * The menu bar as an Electron template, less the click handlers: the main
 * process adds one to every row by its `id`. A role row is `{ role }` alone,
 * for Electron to label and run; a chord the page takes is shown with
 * `registerAccelerator: false`, so a text field keeps the key.
 */
export function nativeMenus(registry: MenuRegistry, state: MenuState = {}): NativeMenu[] {
  return menuTree(registry, state).map((menu) => ({ label: menu.label, submenu: menu.items.map(nativeItem) }));
}

// ---- Checking the shipped files ------------------------------------------------

/** An en or an em dash, which the documentation does not use. */
const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

/**
 * Everything wrong with a pair of menu files, as sentences; none for the
 * shipped pair, which `test/menu-registry.test.ts` holds to. A user file is
 * checked by {@link loadRegistry} instead, entry by entry.
 */
export function validateMenuData(data: MenuData = SHIPPED_MENU_DATA): string[] {
  const problems: string[] = [];
  const say = (message: string): void => {
    problems.push(message);
  };
  const file = data.toolTypes;
  const isGroup = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value) && value >= 1;

  if (file.version !== 1) say(`tool-types.json is version ${file.version}, not 1.`);
  const mains = new Set(file.mainTypes);
  const subs = new Map<string, string>();
  for (const sub of file.subTypes) {
    if (subs.has(sub.id)) say(`The sub-type ${sub.id} is declared twice.`);
    if (!mains.has(sub.main)) say(`The sub-type ${sub.id} belongs to ${sub.main}, which is not a main type.`);
    subs.set(sub.id, sub.main);
  }

  const menus = new Map<string, MenuSpec>();
  for (const menu of file.menus) {
    if (menus.has(menu.id)) say(`The menu ${menu.id} is declared twice.`);
    if (subs.has(menu.id)) say(`The menu ${menu.id} has a sub-type's name.`);
    if (!mains.has(menu.type)) say(`The menu ${menu.id} has ${menu.type}, which is not a main type.`);
    if (typeof menu.label !== 'string' || menu.label === '') say(`The menu ${menu.id} has no label.`);
    if (menu.top === false && menu.panel === undefined) say(`The menu ${menu.id} is drawn nowhere: not in the menu bar, and in no panel.`);
    if (menu.from !== undefined && menu.top !== false) say(`The menu ${menu.id} shows a submenu, so it cannot be in the menu bar.`);
    if (menu.from !== undefined && (menu.accepts ?? []).length > 0) say(`The menu ${menu.id} shows a submenu, so it accepts no types.`);
    for (const accept of menu.accepts ?? []) {
      const type = typeof accept === 'string' ? accept : accept.type;
      if (!subs.has(type)) say(`The menu ${menu.id} accepts ${type}, which is not a sub-type.`);
      if (typeof accept !== 'string') {
        if (accept.group !== undefined && !isGroup(accept.group)) say(`The menu ${menu.id} puts ${type} in a group that is not a whole number from 1.`);
        if (accept.when !== undefined && !(MENU_POSITIONS as readonly string[]).includes(accept.when)) {
          say(`The menu ${menu.id} accepts ${type} when "${String(accept.when)}", which is not a position.`);
        }
      }
    }
    if (menu.help) {
      if (!menu.help.label || !menu.help.page) say(`The menu ${menu.id}'s help page has no label or no page.`);
      if (menu.help.order !== undefined && typeof menu.help.order !== 'number') say(`The menu ${menu.id}'s help order is not a number.`);
    }
    menus.set(menu.id, menu);
  }

  const tools = new Map<string, ToolSpec>();
  for (const tool of file.tools) {
    if (tools.has(tool.id)) say(`The tool ${tool.id} is declared twice.`);
    if (menus.has(tool.id)) say(`The tool ${tool.id} has a menu's name.`);
    if (tool.id.startsWith(HELP_TOPIC_PREFIX)) say(`The tool ${tool.id} starts with ${HELP_TOPIC_PREFIX}, which the Help rows use.`);
    tools.set(tool.id, tool);
  }
  const parents = new Set(file.tools.flatMap((tool) => (tool.parent === undefined ? [] : [tool.parent])));

  for (const tool of file.tools) {
    const label = tool.label;
    if (typeof label === 'string' ? label === '' : !label || typeof label.top !== 'string' || typeof label.panel !== 'string') {
      say(`The tool ${tool.id} has no label, or a label without both a top and a panel form.`);
    }
    if (tool.parent !== undefined) {
      const parent = tools.get(tool.parent);
      if (!parent) say(`The tool ${tool.id} is in the submenu of ${tool.parent}, which is not a tool.`);
      else if (parent.role !== undefined) say(`The tool ${tool.id} is in the submenu of a role row.`);
      if (tool.type !== undefined) say(`The tool ${tool.id} is in a submenu, so it takes its parent's type and has none of its own.`);
      if (tool.inMenus !== undefined) say(`The tool ${tool.id} is in a submenu, so it cannot be kept out of the menus by itself.`);
    } else if (tool.type === undefined) {
      say(`The tool ${tool.id} has no type.`);
    } else {
      const split = splitType(tool.type);
      if (!split || !mains.has(split.main)) say(`The tool ${tool.id} has ${tool.type}, whose main type is unknown.`);
      else if (subs.has(split.sub)) {
        if (subs.get(split.sub) !== split.main) say(`The tool ${tool.id} has ${tool.type}, but ${split.sub} belongs to ${subs.get(split.sub)}.`);
      } else if (menus.has(split.sub)) {
        if (menus.get(split.sub)!.type !== split.main) say(`The tool ${tool.id} has ${tool.type}, but the ${split.sub} menu is ${menus.get(split.sub)!.type}.`);
      } else {
        say(`The tool ${tool.id} has ${tool.type}, which names no sub-type and no menu.`);
      }
      if (tool.inMenus !== false && !isGroup(tool.group)) say(`The tool ${tool.id} is in a menu and has no group.`);
    }
    if (tool.group !== undefined && !isGroup(tool.group)) say(`The tool ${tool.id} has a group that is not a whole number from 1.`);
    if (tool.summary !== undefined) {
      if (typeof tool.summary !== 'string' || tool.summary.trim() === '') say(`The tool ${tool.id} has an empty summary.`);
      else if (LONG_DASH.test(tool.summary)) say(`The tool ${tool.id}'s summary has a long dash; the docs use hyphens.`);
    }
    if (tool.inMenus !== undefined && tool.inMenus !== false) say(`The tool ${tool.id} has inMenus ${String(tool.inMenus)}; it is only ever written false.`);
    if (tool.role !== undefined && !(ELECTRON_ROLES as readonly string[]).includes(tool.role)) say(`The tool ${tool.id} has the role ${tool.role}, which the menus do not use.`);
    if (tool.role !== undefined && parents.has(tool.id)) say(`The tool ${tool.id} is a role row with a submenu.`);
    if (tool.claim !== undefined && tool.claim !== 'menu' && tool.claim !== 'page') say(`The tool ${tool.id} has the claim ${String(tool.claim)}.`);
    if (tool.host !== undefined && tool.host !== 'main') say(`The tool ${tool.id} has the host ${String(tool.host)}.`);
    for (const [field, value] of [
      ['disabledWhen', tool.disabledWhen],
      ['hiddenWhen', tool.hiddenWhen],
      ['checked', tool.checked],
    ] as const) {
      if (value !== undefined && asPredicate(value) === null) say(`The tool ${tool.id} has ${field} ${value}, which is not a question the menus ask.`);
    }
    for (const menu of tool.only ?? []) if (!menus.has(menu)) say(`The tool ${tool.id} is only in ${menu}, which is not a menu.`);
    if (tool.generate !== undefined && tool.generate !== 'helpTopics') say(`The tool ${tool.id} generates ${String(tool.generate)}.`);
    if (tool.generate !== undefined && parents.has(tool.id)) say(`The tool ${tool.id} has a generated submenu and rows of its own.`);
  }
  for (const tool of file.tools) {
    const seen = new Set<string>();
    let current: ToolSpec | undefined = tool;
    while (current?.parent !== undefined) {
      if (seen.has(current.id)) {
        say(`The tool ${tool.id} is in a submenu that contains itself.`);
        break;
      }
      seen.add(current.id);
      current = tools.get(current.parent);
    }
  }
  for (const menu of file.menus) {
    if (menu.from === undefined) continue;
    if (!tools.has(menu.from)) say(`The menu ${menu.id} shows ${menu.from}, which is not a tool.`);
    else if (!parents.has(menu.from)) say(`The menu ${menu.id} shows ${menu.from}, which has no submenu.`);
  }

  const shortcuts = data.shortcuts;
  if (shortcuts.version !== 1) say(`shortcuts.json is version ${shortcuts.version}, not 1.`);
  const holders = new Map<string, string>();
  const checkChord = (id: string, written: string, what: string): void => {
    const canonical = canonicalChord(written);
    if (canonical !== written) say(`${what} ${written} of ${id} is not written canonically${canonical ? ` (${canonical})` : ''}.`);
    if (canonical === null) return;
    const reserved = reservedReason(canonical);
    if (reserved) say(`${what} ${canonical} of ${id} is kept by the app: ${reserved}.`);
    const holder = holders.get(canonical);
    if (holder !== undefined) say(`${canonical} is both ${holder}'s and ${id}'s.`);
    holders.set(canonical, id);
  };
  for (const [id, written] of Object.entries(shortcuts.shortcuts)) {
    const tool = tools.get(id);
    if (!tool) {
      say(`shortcuts.json gives ${written} to ${id}, which is not a tool.`);
      continue;
    }
    if (parents.has(id) || tool.generate !== undefined) say(`shortcuts.json gives ${written} to ${id}, which opens a submenu.`);
    checkChord(id, written, 'The shortcut');
  }
  for (const [id, list] of Object.entries(shortcuts.aliases ?? {})) {
    if (!(id in shortcuts.shortcuts)) say(`${id} has aliases but no shortcut.`);
    for (const written of list) checkChord(id, written, 'The alias');
  }

  const ids = file.tools.map((tool) => tool.id);
  if (ids.length !== COMMAND_IDS.length || ids.some((id, i) => id !== COMMAND_IDS[i])) {
    say('COMMAND_IDS in src/core/menu/ids.ts does not list the tools of tool-types.json in their order.');
  }
  return problems;
}
