/**
 * Text Configurations: a vector editor's Character Styles. A configuration is
 * a named set of character attributes kept in the book
 * (`SketchBook.textConfigs`). A run of text follows one by its id, and what
 * the run has of its own beyond it are its overrides, so a character's
 * attributes are the text's base, then the configuration's, then its own
 * ({@link resolveRunAttrs}).
 *
 * A text carries a copy of each definition it follows (`TypeSpec.configs`),
 * so it looks the same set apart from its book - pasted into another,
 * imported, rendered alone. The book keeps the copies in step: changing a
 * configuration restyles every run that follows it.
 *
 * Here, with no DOM: what a stretch follows and whether it overrides it (the
 * panel's `+`); applying a configuration to a stretch, keeping its overrides
 * or clearing them (a vector editor's Alt+click); breaking the link; what a
 * new configuration takes from the selected text; and over a book, keeping
 * the copies in step, bringing in by name the configurations of text from
 * elsewhere, merging another book's, deleting one either way, and the ones
 * nothing follows.
 */

import { isTextStroke, type SketchBook, type Stroke } from '../types.js';
import {
  CONFIG_KEYS,
  CONFIG_NAME_MAX,
  baseAttrs,
  readTextConfig,
  restyleText,
  sameConfigName,
  styleSegments,
  type CharAttrs,
  type TextConfig,
  type TextRange,
} from './model.js';
import { typingAttrsAt, type TypeTarget } from './panel.js';

export type { TextConfig } from './model.js';

/** What the panel calls no configuration: a text's own attributes, a vector editor's Normal Character Style. */
export const DEFAULT_CONFIG_NAME = 'Default Configuration';

/** What a new configuration is called, numbered, until it is named. */
export const NEW_CONFIG_NAME = 'Text Configuration';

/** Whether two attribute values are one: alike, objects by their content. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b);
}

/** A configuration as the book and the copies keep it: its name trimmed, its attributes held to their ranges and in one order. */
export function canonicalConfig(config: TextConfig): TextConfig {
  return readTextConfig(config) ?? { id: config.id, name: config.name.trim().slice(0, CONFIG_NAME_MAX) || NEW_CONFIG_NAME, attrs: {} };
}

/** Whether two sets of configuration attributes are the same set. */
export function sameConfigAttrs(a: Partial<CharAttrs>, b: Partial<CharAttrs>): boolean {
  const key = (attrs: Partial<CharAttrs>): string => JSON.stringify(canonicalConfig({ id: '-', name: '-', attrs }).attrs);
  return key(a) === key(b);
}

// ---- A run ---------------------------------------------------------------------------------------------------------

/**
 * A run's attributes: the base, then its configuration's, then its own -
 * its overrides - with the configuration's link, or none.
 */
export function resolveRunAttrs(base: CharAttrs, config: TextConfig | null | undefined, overrides: Partial<CharAttrs>): CharAttrs {
  const { config: _link, ...own } = overrides;
  const out: CharAttrs = { ...base, ...(config?.attrs ?? {}), ...own };
  if (config) out.config = config.id;
  else delete out.config;
  return out;
}

/**
 * What a stretch has of its own beyond its base and the configuration it
 * follows - none, for the Default Configuration: its overrides. Kerning by
 * hand is not one; it is between two characters.
 */
export function overridesOf(attrs: CharAttrs, base: CharAttrs, config: TextConfig | null | undefined): Partial<CharAttrs> {
  const under: Partial<CharAttrs> = { ...base, ...(config?.attrs ?? {}) };
  const out: Partial<CharAttrs> = {};
  for (const key of CONFIG_KEYS) {
    const value = attrs[key];
    if (value !== undefined && !same(value, under[key])) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** The configurations a text's runs follow, by id. */
export function configsOf(stroke: Stroke): Map<string, TextConfig> {
  return new Map((stroke.typeset?.configs ?? []).map((config) => [config.id, config]));
}

// ---- The panel's reading ---------------------------------------------------------------------------------------------

/** What the Text Configurations tab shows of its targets. */
export interface ConfigReading {
  /** The configuration every stretch follows: its id, null for none - the Default Configuration - or `mixed`. */
  config: string | null | 'mixed';
  /** Some stretch has attributes of its own beyond what it follows: the panel's `+`. */
  overrides: boolean;
}

/**
 * What the targets follow: over a stretch, every character; at a caret, what
 * typing there would follow - its typing attributes may name one the text
 * does not follow yet, found in `known`, the book's. Null with no targets.
 */
export function readConfigTargets(targets: readonly TypeTarget[], known: readonly TextConfig[] = []): ConfigReading | null {
  if (targets.length === 0) return null;
  const links = new Set<string | null>();
  let overrides = false;
  for (const target of targets) {
    const stroke = target.stroke;
    const text = stroke.text ?? '';
    const start = Math.max(0, Math.min(text.length, target.start));
    const end = Math.max(start, Math.min(text.length, target.end));
    const base = baseAttrs(stroke);
    const table = configsOf(stroke);
    const visit = (attrs: CharAttrs): void => {
      const config = attrs.config === undefined ? undefined : table.get(attrs.config) ?? known.find((each) => each.id === attrs.config);
      links.add(config ? config.id : null);
      if (Object.keys(overridesOf(attrs, base, config)).length > 0) overrides = true;
    };
    if (end > start) {
      for (const segment of styleSegments(stroke)) if (segment.end > start && segment.start < end) visit(segment.attrs);
    } else {
      visit(typingAttrsAt(stroke, start, target.typing));
    }
  }
  return { config: links.size === 1 ? [...links][0] : 'mixed', overrides };
}

/**
 * The attributes the targets share that the first one's base does not have:
 * what New Text Configuration takes from the selected text, and Redefine
 * gives the configuration. Its kerning by hand is a pair's, and stays out.
 */
export function captureConfigAttrs(targets: readonly TypeTarget[]): Partial<CharAttrs> {
  const chars: CharAttrs[] = [];
  for (const target of targets) {
    const stroke = target.stroke;
    const text = stroke.text ?? '';
    const start = Math.max(0, Math.min(text.length, target.start));
    const end = Math.max(start, Math.min(text.length, target.end));
    if (end > start) {
      for (const segment of styleSegments(stroke)) if (segment.end > start && segment.start < end) chars.push(segment.attrs);
    } else {
      chars.push(typingAttrsAt(stroke, start, target.typing));
    }
  }
  if (chars.length === 0) return {};
  const base = baseAttrs(targets[0].stroke);
  const out: Partial<CharAttrs> = {};
  for (const key of CONFIG_KEYS) {
    const first = chars[0][key];
    if (first === undefined || !chars.every((attrs) => same(attrs[key], first))) continue;
    if (!same(first, base[key])) (out as Record<string, unknown>)[key] = first;
  }
  return canonicalConfig({ id: '-', name: '-', attrs: out }).attrs;
}

// ---- A text --------------------------------------------------------------------------------------------------------

/**
 * A stretch of text made to follow `config` - or with null, none: the
 * Default Configuration. Each part keeps its overrides, what it had beyond
 * what it followed, unless `clearOverrides` - a vector editor's Alt+click -
 * takes them off. Kerning by hand stays either way.
 */
export function applyTextConfig(stroke: Stroke, range: TextRange, config: TextConfig | null, clearOverrides = false): Stroke {
  const base = baseAttrs(stroke);
  const table = configsOf(stroke);
  const target = config ? canonicalConfig(config) : null;
  return restyleText(
    stroke,
    range,
    (attrs) => {
      const was = attrs.config !== undefined ? table.get(attrs.config) : undefined;
      return { ...resolveRunAttrs(base, target, clearOverrides ? {} : overridesOf(attrs, base, was)), kern: attrs.kern };
    },
    target ? [target] : [],
  );
}

/** A stretch's overrides taken off: each part keeps what it follows, and nothing of its own beyond it (Clear Overrides). */
export function clearTextOverrides(stroke: Stroke, range: TextRange): Stroke {
  const base = baseAttrs(stroke);
  const table = configsOf(stroke);
  return restyleText(stroke, range, (attrs) => {
    const config = attrs.config !== undefined ? table.get(attrs.config) ?? null : null;
    return { ...resolveRunAttrs(base, config, {}), kern: attrs.kern };
  });
}

/** A stretch's link to its configuration broken: it keeps the look the configuration gave it, as its own (Break Link to Configuration). */
export function breakTextConfigLink(stroke: Stroke, range: TextRange): Stroke {
  return restyleText(stroke, range, (attrs) => {
    const { config: _link, ...rest } = attrs;
    return rest as CharAttrs;
  });
}

/** Whether a text follows the configuration `id` anywhere: a run of it, or - a Markdown Flow text - what it carries, which its Markdown is shown in. */
export function followsConfig(stroke: Stroke, id: string): boolean {
  const spec = stroke.typeset;
  if (spec?.flow === 'markdown' && spec.configs?.some((config) => config.id === id)) return true;
  return spec?.runs?.some((run) => run.attrs.config === id) === true;
}

/**
 * Each stretch of a text that follows `id` restyled; the text itself when
 * none does. A Markdown Flow text lets the definition go too, and shows its
 * Markdown in the theme's again.
 */
function restyleFollowing(stroke: Stroke, id: string, restyle: (attrs: CharAttrs) => CharAttrs): Stroke {
  if (!followsConfig(stroke, id)) return stroke;
  const out = restyleText(stroke, { start: 0, end: (stroke.text ?? '').length }, (attrs) => (attrs.config === id ? restyle(attrs) : attrs));
  const spec = out.typeset;
  if (spec?.flow !== 'markdown' || !spec.configs?.some((config) => config.id === id)) return out;
  const configs = spec.configs.filter((config) => config.id !== id);
  const { configs: _all, ...rest } = spec;
  return { ...out, typeset: configs.length > 0 ? { ...rest, configs } : rest };
}

/** A text that no longer follows `id`, keeping the look it gave: a deleted configuration's Break Link. */
export function detachTextConfig(stroke: Stroke, id: string): Stroke {
  return restyleFollowing(stroke, id, (attrs) => {
    const { config: _link, ...rest } = attrs;
    return rest as CharAttrs;
  });
}

/** A text that no longer follows `id`, back to its own attributes and its overrides: a deleted configuration's Revert to Default. */
export function revertTextConfig(stroke: Stroke, id: string): Stroke {
  const base = baseAttrs(stroke);
  const config = configsOf(stroke).get(id);
  return restyleFollowing(stroke, id, (attrs) => ({ ...resolveRunAttrs(base, null, overridesOf(attrs, base, config)), kern: attrs.kern }));
}

/**
 * A text carrying `configs`' definitions of the configurations it follows:
 * one changed or renamed. Its runs are as they were - what they have is
 * their own - so each takes the new definition under its overrides. The text
 * itself when nothing it carries changed.
 */
export function withConfigDefinitions(stroke: Stroke, configs: readonly TextConfig[]): Stroke {
  const spec = stroke.typeset;
  const carried = spec?.configs;
  if (!spec || !carried) return stroke;
  let changed = false;
  const next = carried.map((config) => {
    const now = configs.find((each) => each.id === config.id);
    if (!now) return config;
    const canonical = canonicalConfig(now);
    if (same(canonical, config)) return config;
    changed = true;
    return canonical;
  });
  return changed ? { ...stroke, typeset: { ...spec, configs: next } } : stroke;
}

// ---- A book's list -----------------------------------------------------------------------------------------------------

/** The ids of the configurations the text of a book follows. */
export function followedConfigIds(book: Pick<SketchBook, 'sketches'>): Set<string> {
  const ids = new Set<string>();
  for (const sketch of book.sketches) {
    for (const stroke of sketch.strokes) {
      for (const run of stroke.typeset?.runs ?? []) if (run.attrs.config !== undefined) ids.add(run.attrs.config);
      if (stroke.typeset?.flow === 'markdown') for (const config of stroke.typeset.configs ?? []) ids.add(config.id);
    }
  }
  return ids;
}

/** Whether any text of a book follows the configuration `id`. */
export function configInUse(book: Pick<SketchBook, 'sketches'>, id: string): boolean {
  return book.sketches.some((sketch) => sketch.strokes.some((stroke) => followsConfig(stroke, id)));
}

/** The configurations of a book that no text follows. */
export function unusedTextConfigs(book: SketchBook): TextConfig[] {
  const used = followedConfigIds(book);
  return (book.textConfigs ?? []).filter((config) => !used.has(config.id));
}

/** A book without the configurations no text follows: a clearing out, made only when asked for. */
export function dropUnusedTextConfigs(book: SketchBook): SketchBook {
  const unused = new Set(unusedTextConfigs(book).map((config) => config.id));
  if (unused.size === 0) return book;
  const kept = (book.textConfigs ?? []).filter((config) => !unused.has(config.id));
  if (kept.length > 0) return { ...book, textConfigs: kept };
  const { textConfigs: _all, ...rest } = book;
  return rest;
}

/**
 * `name` made one no configuration of `list` has but `except`, the one being
 * named: the name itself, else it numbered - `Callout 2`, `Callout 3`.
 */
export function uniqueConfigName(list: readonly TextConfig[], name: string, except?: string): string {
  const wanted = name.trim().slice(0, CONFIG_NAME_MAX) || NEW_CONFIG_NAME;
  const taken = (candidate: string): boolean => list.some((config) => config.id !== except && sameConfigName(config.name, candidate));
  if (!taken(wanted)) return wanted;
  const stem = wanted.replace(/ \d+$/, '').slice(0, CONFIG_NAME_MAX - 6);
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}`;
    if (!taken(candidate)) return candidate;
  }
}

/** The name the next new configuration takes: `Text Configuration 1`, or the first number free. */
export function nextConfigName(list: readonly TextConfig[]): string {
  for (let n = 1; ; n++) {
    const candidate = `${NEW_CONFIG_NAME} ${n}`;
    if (!list.some((config) => sameConfigName(config.name, candidate))) return candidate;
  }
}

/** A new configuration with these attributes: named `name`, made one the list does not have, or the next `Text Configuration n`. */
export function newTextConfig(list: readonly TextConfig[], attrs: Partial<CharAttrs>, id: string, name?: string): TextConfig {
  return canonicalConfig({ id, name: name !== undefined && name.trim() !== '' ? uniqueConfigName(list, name) : nextConfigName(list), attrs });
}

/** A copy of a configuration, `<name> copy`, put after it in the list. Null when the list has no such configuration. */
export function duplicateTextConfig(list: readonly TextConfig[], id: string, newId: string): { list: TextConfig[]; config: TextConfig } | null {
  const at = list.findIndex((config) => config.id === id);
  if (at < 0) return null;
  const config = canonicalConfig({ id: newId, name: uniqueConfigName(list, `${list[at].name} copy`), attrs: list[at].attrs });
  return { list: [...list.slice(0, at + 1), config, ...list.slice(at + 1)], config };
}

/** A list with one configuration's definition in place of the one of its id; its name kept one the rest do not have. */
export function replaceTextConfig(list: readonly TextConfig[], config: TextConfig): TextConfig[] {
  const named = canonicalConfig({ ...config, name: uniqueConfigName(list, config.name, config.id) });
  return list.map((each) => (each.id === config.id ? named : each));
}

/** What merging another book's configurations did. */
export interface ConfigMerge {
  list: TextConfig[];
  /** The configurations added, as they were named. */
  added: TextConfig[];
  /** Those the list had already, alike: kept once. */
  same: number;
  /** Those renamed, their name clashing with a different one's. */
  renamed: Array<{ from: string; to: string }>;
}

/**
 * Another book's configurations merged into a list, by name: one the list
 * has alike is kept once; one of a name the list has but set differently is
 * added under the name numbered, `Callout 2`; any other is added as it is.
 * Ids are kept where the list does not have them.
 */
export function mergeTextConfigs(list: readonly TextConfig[], incoming: readonly TextConfig[], newId: () => string): ConfigMerge {
  const out = [...list];
  const added: TextConfig[] = [];
  const renamed: Array<{ from: string; to: string }> = [];
  let alike = 0;
  for (const raw of incoming) {
    const config = canonicalConfig(raw);
    const named = out.find((each) => sameConfigName(each.name, config.name));
    if (named && sameConfigAttrs(named.attrs, config.attrs)) {
      alike++;
      continue;
    }
    const name = named ? uniqueConfigName(out, config.name) : config.name;
    const id = out.some((each) => each.id === config.id) ? newId() : config.id;
    const made = { ...config, id, name };
    out.push(made);
    added.push(made);
    if (named) renamed.push({ from: config.name, to: name });
  }
  return { list: out, added, same: alike, renamed };
}

/**
 * The configurations marks from elsewhere carry - pasted, imported, copied in
 * by a script - brought into a list, as a vector editor pastes styled text:
 * one the list has, by its id and its name or by its name alone, is the
 * list's, and the marks follow the list's definition of it; one it has not is
 * added. Gives the list and the marks, each mark itself when nothing about it
 * changed.
 */
export function adoptTextConfigs(list: readonly TextConfig[], strokes: readonly Stroke[], newId: () => string): { list: TextConfig[]; strokes: Stroke[] } {
  const out = [...list];
  const relink = new Map<string, TextConfig>();
  const marks = strokes.map((stroke) => {
    const carried = isTextStroke(stroke) ? stroke.typeset?.configs : undefined;
    if (!carried || carried.length === 0) return stroke;
    for (const config of carried) {
      if (relink.has(config.id)) continue;
      const byId = out.find((each) => each.id === config.id);
      const byName = byId && sameConfigName(byId.name, config.name) ? byId : out.find((each) => sameConfigName(each.name, config.name));
      if (byName) {
        relink.set(config.id, byName);
        continue;
      }
      const made = canonicalConfig({ ...config, id: byId ? newId() : config.id });
      out.push(made);
      relink.set(config.id, made);
    }
    return relinked(stroke, relink);
  });
  return { list: out, strokes: marks };
}

/** A text following the configurations `relink` maps those it follows to, and carrying their definitions; itself when nothing changes. */
function relinked(stroke: Stroke, relink: ReadonlyMap<string, TextConfig>): Stroke {
  const spec = stroke.typeset;
  if (!spec?.configs) return stroke;
  let changed = false;
  const runs = spec.runs?.map((run) => {
    const to = run.attrs.config !== undefined ? relink.get(run.attrs.config) : undefined;
    if (!to || to.id === run.attrs.config) return run;
    changed = true;
    return { ...run, attrs: { ...run.attrs, config: to.id } };
  });
  const configs: TextConfig[] = [];
  for (const config of spec.configs) {
    const to = relink.get(config.id) ?? config;
    if (!configs.some((each) => each.id === to.id)) configs.push(to);
  }
  if (!changed && configs.length === spec.configs.length && configs.every((config, i) => same(config, spec.configs![i]))) return stroke;
  return { ...stroke, typeset: { ...spec, ...(runs ? { runs } : {}), configs } };
}

/**
 * A book with its text in step with its list of configurations: each text
 * carries the list's definitions, and one a text carries that the list has
 * not - a file written by hand, a book from before its list - joins the list.
 * The list keeps those no text follows ({@link dropUnusedTextConfigs} clears
 * them out when asked). Changes the book in place, and gives it.
 */
export function syncBookConfigs(book: SketchBook, newId: () => string): SketchBook {
  let list = (book.textConfigs ?? []).map(canonicalConfig);
  for (const sketch of book.sketches) {
    if (!sketch.strokes.some((stroke) => stroke.typeset?.configs)) continue;
    const adopted = adoptTextConfigs(list, sketch.strokes, newId);
    list = adopted.list;
    sketch.strokes = adopted.strokes;
  }
  if (list.length > 0) book.textConfigs = list;
  else delete book.textConfigs;
  return book;
}
