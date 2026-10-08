/**
 * The Type panel: a vector editor's Character, Paragraph and Character Styles
 * panels in one, a tab each - the last as Text Configurations. It shows what
 * the renderer gives it - core/type/panel.ts and configs.ts read it from the
 * text the panel acts on - and asks the renderer to make each change; it owns
 * no page state.
 *
 * - **Character:** the font family, a searchable list with each name in its
 *   own face and the fonts chosen lately first; the face; size, leading,
 *   kerning, tracking, word spacing, the two scales, baseline shift and
 *   rotation; All Caps, Small Caps, Superscript, Subscript, Underline and
 *   Strikethrough; the orientation; the color.
 * - **Paragraph:** the alignment; bulleted and numbered lists, their style
 *   and level; the indents; the space before and after; hyphenation.
 * - **Text Configurations:** the Default Configuration and the book's own,
 *   each name in its own style, a `+` after the one the text follows when it
 *   has attributes of its own beyond it. A click applies one, keeping those;
 *   Alt and a click clears them. Its menu makes, copies, deletes, redefines
 *   and loads them.
 *
 * A number field takes a value with its unit - `12pt`, `3 mm`, `140%` - or a
 * bare one in its own; Up and Down step it, Shift by ten, and a drag on its
 * name scrubs it, shown as it goes and kept as one change when let go. A
 * field the text differs in is blank.
 */

import { cssFamily, faceStyle } from '../core/type/measure.js';
import { DEFAULT_CONFIG_NAME, type ConfigReading } from '../core/type/configs.js';
import {
  BULLET_MARKERS,
  NUMBER_MARKERS,
  TYPE_TOGGLES,
  autoLeading,
  listChange,
  parseAmount,
  parseKerning,
  parseLeading,
  parseLength,
  primaryFamily,
  showAmount,
  showKerning,
  showLeading,
  showLength,
  toggleChange,
  toggleState,
  type TypeChange,
  type TypeReading,
  type TypeToggle,
} from '../core/type/panel.js';
import type { CharAttrs, ParaAttrs, TextConfig } from '../core/type/model.js';
import type { FontList } from './font-list.js';

/** The panel's tabs. */
export type TypePanelTab = 'character' | 'paragraph' | 'configs';

/** The Text Configurations tab's commands: a vector editor's Character Styles panel menu. */
export type ConfigCommand = 'new' | 'duplicate' | 'delete' | 'redefine' | 'options' | 'clear-overrides' | 'break-link' | 'load';

/** The tab's menu, top to bottom. */
const CONFIG_COMMANDS: ReadonlyArray<{ command: ConfigCommand; label: string; title: string }> = [
  { command: 'new', label: 'New Text Configuration', title: "A new configuration, from the selected text's own attributes, which the text then follows" },
  { command: 'duplicate', label: 'Duplicate Text Configuration', title: 'A copy of the configuration chosen in the list' },
  { command: 'delete', label: 'Delete Text Configuration', title: 'Deletes the configuration chosen in the list' },
  { command: 'redefine', label: 'Redefine Text Configuration', title: "The chosen configuration takes the selected text's attributes, and every text that follows it changes" },
  { command: 'options', label: 'Text Configuration Options...', title: "The chosen configuration's name and attributes" },
  { command: 'clear-overrides', label: 'Clear Overrides', title: 'The selected text keeps what it follows, and nothing of its own beyond it' },
  { command: 'break-link', label: 'Break Link to Configuration', title: 'The selected text keeps its look, and follows no configuration' },
  { command: 'load', label: 'Load Text Configurations...', title: "Another book's configurations, merged in by name" },
];

/**
 * What the panel acts on: a stretch of the text being edited, its caret,
 * whole text marks, or with no text the next one the Text tool makes - its
 * font, size and color.
 */
export type TypePanelScope = 'range' | 'caret' | 'marks' | 'next';

/** What the panel shows, which the renderer works out. */
export interface TypePanelView {
  /** A line naming what the panel acts on: `Editing: Sale today`, `2 Texts`, `Next Text`. */
  readonly title: string;
  readonly scope: TypePanelScope;
  readonly reading: TypeReading;
  /** Where a field is blank, the value its arrows and drag start from: the first character's and paragraph's. */
  readonly first: { char: CharAttrs; para: ParaAttrs };
  /** The book's Text Configurations, in its order. */
  readonly configs: readonly TextConfig[];
  /** What the targets follow, and whether they override it; null with no text. */
  readonly config: ConfigReading | null;
}

/** What the renderer does for the panel. */
export interface TypePanelActions {
  /**
   * Makes a change to what the panel acts on: `once`, as one undo step; or
   * `preview`, shown while a drag or a color pick goes on, and kept by
   * {@link commit} or taken back by {@link cancel}.
   */
  change(change: TypeChange, phase: 'once' | 'preview'): void;
  commit(): void;
  cancel(): void;
  /** Reads the system's fonts again. */
  refreshFonts(): void;
  /** The tab shown changed. */
  shown(tab: TypePanelTab): void;
  /** A configuration clicked - by id, null for the Default Configuration - for what the panel acts on to follow; with `clearOverrides`, nothing of its own beyond it. */
  applyConfig(id: string | null, clearOverrides: boolean): void;
  /** A command from the tab's menu or its buttons, on the configuration chosen in the list (null for the Default Configuration). */
  configCommand(command: ConfigCommand, id: string | null): void;
}

/** A number field: where it is, what it reads, and the change a value makes. */
interface NumberSpec {
  id: string;
  label: string;
  title: string;
  tab: TypePanelTab;
  show(view: TypePanelView): string;
  /** The value its arrows and drag move, in its own unit; where it is blank, the first character's. */
  value(view: TypePanelView): number;
  /** The change a typed value makes, or null when it is not one. */
  parse(text: string): TypeChange | null;
  /** The change a stepped or dragged value makes. */
  set(value: number): TypeChange;
  step: number;
  /** It sets the next text too, with no text to act on. */
  next?: boolean;
}

const PT = 4 / 3;
const pt = (px: number): number => px / PT;
const char = (patch: Partial<CharAttrs>): TypeChange => ({ kind: 'char', patch });
const para = (patch: Partial<ParaAttrs>): TypeChange => ({ kind: 'para', patch });

/** A length field in points over a character attribute. */
function charLength(id: string, label: string, title: string, key: 'fontSize' | 'baselineShift', next = false): NumberSpec {
  return {
    id,
    label,
    title,
    tab: 'character',
    show: (view) => showLength(view.reading.char[key]),
    value: (view) => pt(view.reading.char[key] ?? view.first.char[key]),
    parse: (text) => {
      const px = parseLength(text);
      if (px === null || (key === 'fontSize' && px <= 0)) return null;
      return char({ [key]: px });
    },
    set: (value) => char({ [key]: value * PT }),
    step: 1,
    next,
  };
}

/** A number field with its unit over a character attribute: tracking, word spacing, the scales, rotation. */
function charAmount(id: string, label: string, title: string, key: 'tracking' | 'wordSpacing' | 'hScale' | 'vScale' | 'rotation', suffix: string, step: number): NumberSpec {
  return {
    id,
    label,
    title,
    tab: 'character',
    show: (view) => showAmount(view.reading.char[key], suffix),
    value: (view) => view.reading.char[key] ?? view.first.char[key],
    parse: (text) => {
      const value = parseAmount(text, suffix);
      return value === null ? null : char({ [key]: value });
    },
    set: (value) => char({ [key]: value }),
    step,
  };
}

/** A length field in points over a paragraph attribute. */
function paraLength(id: string, label: string, title: string, key: 'leftIndent' | 'rightIndent' | 'firstIndent' | 'spaceBefore' | 'spaceAfter'): NumberSpec {
  return {
    id,
    label,
    title,
    tab: 'paragraph',
    show: (view) => showLength(view.reading.para[key]),
    value: (view) => pt(view.reading.para[key] ?? view.first.para[key]),
    parse: (text) => {
      const px = parseLength(text);
      return px === null ? null : para({ [key]: px });
    },
    set: (value) => para({ [key]: value * PT }),
    step: 1,
  };
}

/** Every number field, in the order the tabs lay them out: two to a row. */
const NUMBER_FIELDS: readonly NumberSpec[] = [
  charLength('type-size', 'Size', 'Font size, in points: type a size with its unit, or drag the name', 'fontSize', true),
  {
    id: 'type-leading',
    label: 'Leading',
    title: 'Leading, the line height: Auto, a length, or a share of the size such as 140%. Drag the name to change it',
    tab: 'character',
    show: (view) => showLeading(view.reading.char.leading),
    value: (view) => {
      const leading = view.reading.char.leading ?? view.first.char.leading;
      const size = view.reading.char.fontSize ?? view.first.char.fontSize;
      return pt(leading === 'auto' ? autoLeading(size) : leading);
    },
    parse: (text) => {
      const typed = parseLeading(text);
      if (!typed) return null;
      if ('auto' in typed) return char({ leading: 'auto' });
      if ('share' in typed) return { kind: 'leading-share', share: typed.share };
      return char({ leading: typed.px });
    },
    set: (value) => char({ leading: Math.max(0, value) * PT }),
    step: 1,
  },
  {
    id: 'type-kerning',
    label: 'Kerning',
    title: "Kerning: Auto, the font's own pairs; None; or thousandths of an em by hand, at the caret",
    tab: 'character',
    show: (view) => showKerning(view.reading.char.kerning, view.reading.char.kern),
    value: (view) => view.reading.char.kern ?? view.first.char.kern,
    parse: (text) => {
      const typed = parseKerning(text);
      if (!typed) return null;
      return 'kerning' in typed ? char({ kerning: typed.kerning, kern: 0 }) : { kind: 'kern', value: typed.kern };
    },
    set: (value) => ({ kind: 'kern', value }),
    step: 10,
  },
  charAmount('type-tracking', 'Tracking', 'Tracking: space after every character, in thousandths of an em', 'tracking', '', 10),
  charAmount('type-word-spacing', 'Words', "Word spacing: a word space's width, as a share of the font's own", 'wordSpacing', '%', 1),
  charAmount('type-rotation', 'Rotate', 'Character rotation: each character turned about its own middle', 'rotation', '°', 1),
  charAmount('type-v-scale', 'V Scale', 'Vertical scale', 'vScale', '%', 1),
  charAmount('type-h-scale', 'H Scale', 'Horizontal scale', 'hScale', '%', 1),
  charLength('type-baseline', 'Shift', 'Baseline shift, up from the baseline, in points', 'baselineShift'),
  paraLength('type-left-indent', 'Left', 'Left indent', 'leftIndent'),
  paraLength('type-right-indent', 'Right', 'Right indent', 'rightIndent'),
  paraLength('type-first-indent', 'First', "First-line indent, on top of the left one; below 0 it hangs", 'firstIndent'),
  paraLength('type-space-before', 'Before', 'Space before the paragraph', 'spaceBefore'),
  paraLength('type-space-after', 'After', 'Space after the paragraph', 'spaceAfter'),
];

/** The toggles' faces and names. */
const TOGGLE_FACES: Record<TypeToggle, { face: string; name: string; className: string }> = {
  'all-caps': { face: 'TT', name: 'All Caps', className: '' },
  'small-caps': { face: 'Tt', name: 'Small Caps', className: 'is-small-caps' },
  superscript: { face: 'T¹', name: 'Superscript', className: '' },
  subscript: { face: 'T₁', name: 'Subscript', className: '' },
  underline: { face: 'T', name: 'Underline', className: 'is-underline' },
  strike: { face: 'T', name: 'Strikethrough', className: 'is-strike' },
};

const ALIGNS: ReadonlyArray<{ value: ParaAttrs['align']; label: string; key: string }> = [
  { value: 'left', label: 'Left', key: 'L' },
  { value: 'center', label: 'Center', key: 'C' },
  { value: 'right', label: 'Right', key: 'R' },
  { value: 'justify', label: 'Justify', key: 'J' },
];

/** A color's relative luminance, 0 to 1, for `#rrggbb` and `rgb()`; null for anything else. */
function luminance(color: string): number | null {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color.trim());
  const parts = hex ? hex.slice(1).map((h) => parseInt(h, 16)) : rgb ? rgb.slice(1).map(Number) : null;
  if (!parts) return null;
  const [r, g, b] = parts.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A configuration's name drawn in its style: its family and face, its color where it reads against the panel, its lines and capitals. */
function styleName(name: HTMLElement, attrs: Partial<CharAttrs>, background: string): void {
  if (attrs.fontFamily) name.style.fontFamily = `${cssFamily(attrs.fontFamily)}, system-ui, sans-serif`;
  if (attrs.fontStyle) {
    const face = faceStyle(attrs.fontStyle);
    name.style.fontWeight = String(face.weight);
    name.style.fontStyle = face.italic ? 'italic' : 'normal';
  }
  if (attrs.color) {
    // A color too near the panel's own would hide the name: it is shown in the panel's ink instead.
    const ink = luminance(attrs.color);
    const paper = luminance(background);
    const contrast = ink === null || paper === null ? 21 : (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05);
    if (contrast >= 2) name.style.color = attrs.color;
  }
  if (attrs.highlight) name.style.backgroundColor = attrs.highlight;
  const lines = [attrs.underline ? 'underline' : '', attrs.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  if (lines) name.style.textDecoration = lines;
  if (attrs.caps === 'all') name.style.textTransform = 'uppercase';
  if (attrs.caps === 'small') name.style.fontVariantCaps = 'small-caps';
}

/** How far, in screen pixels, a drag on a field's name goes for one step. */
const SCRUB_PX = 4;

/** The most families the list shows at once as it is filtered; the rest come with more typed. */
const LIST_LIMIT = 400;

export class TypePanel {
  private view: TypePanelView | null = null;
  private tab: TypePanelTab = 'character';
  private readonly tabs = new Map<TypePanelTab, { button: HTMLButtonElement; page: HTMLElement }>();
  private readonly numbers = new Map<string, { spec: NumberSpec; input: HTMLInputElement; label: HTMLElement }>();
  private readonly toggles = new Map<TypeToggle, HTMLButtonElement>();
  private readonly aligns = new Map<ParaAttrs['align'], HTMLButtonElement>();
  private readonly target: HTMLElement;
  private readonly family: HTMLInputElement;
  private readonly familyList: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly style: HTMLSelectElement;
  private readonly horizontal: HTMLButtonElement;
  private readonly vertical: HTMLButtonElement;
  private readonly color: HTMLInputElement;
  private readonly bullets: HTMLButtonElement;
  private readonly numbered: HTMLButtonElement;
  private readonly bulletStyle: HTMLSelectElement;
  private readonly numberStyle: HTMLSelectElement;
  private readonly levelDown: HTMLButtonElement;
  private readonly levelUp: HTMLButtonElement;
  private readonly hyphenate: HTMLInputElement;
  /** The family list's options as last drawn, and the one the keys are on. */
  private options: string[] = [];
  private active = -1;
  /** The arrow keys chose the option the list is on, over what was typed. */
  private keyed = false;
  /** A drag on a field's name under way. */
  private scrub: { pointerId: number; x: number; start: number; spec: NumberSpec; moved: boolean } | null = null;
  /** A color being picked: its previews are kept as one change when the picker closes. */
  private picking = false;
  /** The Text Configurations tab: its list, its menu and their buttons. */
  private readonly configList: HTMLElement;
  private readonly configMenu: HTMLElement;
  private readonly configMenuButton: HTMLButtonElement;
  private readonly configButtons = new Map<ConfigCommand, HTMLButtonElement>();
  private readonly configNew: HTMLButtonElement;
  private readonly configDelete: HTMLButtonElement;
  private readonly configClear: HTMLButtonElement;
  /** The configuration chosen in the list - the one the text follows, or the last clicked - by id, null for the Default Configuration. */
  private chosenConfig: string | null = null;
  /** The list as last drawn, so a render that changes nothing leaves its rows, and the focus, alone. */
  private configKey = '';
  /** What the text followed at the last render: a choice made since stays until it changes. */
  private readingKey = '';

  constructor(
    root: HTMLElement,
    private readonly fonts: FontList,
    private readonly actions: TypePanelActions,
  ) {
    const find = <T extends HTMLElement>(id: string): T => {
      const node = root.querySelector<T>(`#${id}`);
      if (!node) throw new Error(`The Type panel has no #${id}.`);
      return node;
    };
    this.target = find('type-target');
    const tablist = find('type-tabs');
    for (const [tab, label] of [['character', 'Character'], ['paragraph', 'Paragraph'], ['configs', 'Configurations']] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `type-tab-${tab}`;
      button.className = 'type-tab';
      button.textContent = label;
      if (tab === 'configs') button.title = 'Text Configurations';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', `type-${tab}`);
      const page = find(`type-${tab}`);
      page.setAttribute('aria-labelledby', button.id);
      tablist.append(button);
      this.tabs.set(tab, { button, page });
      button.addEventListener('click', () => this.show(tab));
    }
    tablist.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      const order = [...this.tabs.keys()];
      const next = order[(order.indexOf(this.tab) + (ev.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
      this.show(next);
      this.tabs.get(next)?.button.focus();
    });

    // ---- Character ----
    const character = find('type-character');
    const fontRow = document.createElement('div');
    fontRow.className = 'type-font-row';
    this.combo = document.createElement('div');
    this.combo.className = 'type-combo';
    this.family = document.createElement('input');
    this.family.id = 'type-family';
    this.family.type = 'text';
    this.family.autocomplete = 'off';
    this.family.spellcheck = false;
    this.family.setAttribute('role', 'combobox');
    this.family.setAttribute('aria-label', 'Font family');
    this.family.setAttribute('aria-autocomplete', 'list');
    this.family.setAttribute('aria-expanded', 'false');
    this.family.setAttribute('aria-controls', 'type-family-list');
    this.familyList = document.createElement('ul');
    this.familyList.id = 'type-family-list';
    this.familyList.className = 'type-family-list is-hidden';
    this.familyList.setAttribute('role', 'listbox');
    this.familyList.setAttribute('aria-label', 'Fonts');
    this.combo.append(this.family, this.familyList);
    const refresh = this.button('type-fonts-refresh', '↻', "Read this computer's fonts again", 'type-icon-btn');
    refresh.addEventListener('click', () => this.actions.refreshFonts());
    fontRow.append(this.combo, refresh);
    this.style = document.createElement('select');
    this.style.id = 'type-style';
    this.style.className = 'type-select';
    this.style.setAttribute('aria-label', 'Font style');
    this.style.addEventListener('change', () => {
      if (this.style.value) this.actions.change(char({ fontStyle: this.style.value }), 'once');
    });
    character.append(fontRow, this.style, this.grid('character'));

    const toggles = document.createElement('div');
    toggles.className = 'type-toggles';
    toggles.setAttribute('role', 'group');
    toggles.setAttribute('aria-label', 'Character style');
    for (const toggle of TYPE_TOGGLES) {
      const face = TOGGLE_FACES[toggle];
      const button = this.button(`type-${toggle}`, face.face, face.name, `type-toggle ${face.className}`.trim());
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        if (this.view) this.actions.change(toggleChange(toggle, this.view.reading), 'once');
      });
      this.toggles.set(toggle, button);
      toggles.append(button);
    }
    const orientation = this.segmented('Orientation');
    this.horizontal = this.button('type-horizontal', 'Horizontal', 'Lines run across', 'type-seg-btn');
    this.vertical = this.button('type-vertical', 'Vertical', 'Characters stand in columns, right to left', 'type-seg-btn');
    for (const [button, value] of [[this.horizontal, 'horizontal'], [this.vertical, 'vertical']] as const) {
      button.addEventListener('click', () => this.actions.change({ kind: 'orientation', value }, 'once'));
      orientation.group.append(button);
    }
    const colorRow = document.createElement('label');
    colorRow.className = 'type-row';
    const colorName = document.createElement('span');
    colorName.className = 'type-row-label';
    colorName.textContent = 'Color';
    this.color = document.createElement('input');
    this.color.id = 'type-color';
    this.color.type = 'color';
    this.color.setAttribute('aria-label', 'Text color');
    this.color.title = "The text's color";
    this.color.addEventListener('input', () => {
      this.picking = true;
      this.actions.change(char({ color: this.color.value }), 'preview');
    });
    this.color.addEventListener('change', () => {
      if (!this.picking) this.actions.change(char({ color: this.color.value }), 'once');
      else this.actions.commit();
      this.picking = false;
    });
    colorRow.append(colorName, this.color);
    character.append(toggles, orientation.row, colorRow);

    // ---- Paragraph ----
    const paragraph = find('type-paragraph');
    const align = this.segmented('Alignment');
    for (const { value, label, key } of ALIGNS) {
      const button = this.button(`type-align-${value}`, label, `Align ${label} (Ctrl+Shift+${key} while typing)`, 'type-seg-btn');
      button.addEventListener('click', () => this.actions.change(para({ align: value }), 'once'));
      this.aligns.set(value, button);
      align.group.append(button);
    }
    const lists = document.createElement('div');
    lists.className = 'type-lists';
    this.bullets = this.button('type-bullets', 'Bulleted', 'A bulleted list: again to take it off', 'type-seg-btn');
    this.numbered = this.button('type-numbers', 'Numbered', 'A numbered list: again to take it off', 'type-seg-btn');
    this.bulletStyle = this.select('type-bullet-style', 'Bullet', BULLET_MARKERS);
    this.numberStyle = this.select('type-number-style', 'Numbering', NUMBER_MARKERS);
    this.bullets.addEventListener('click', () => this.list('bullet'));
    this.numbered.addEventListener('click', () => this.list('number'));
    this.bulletStyle.addEventListener('change', () => this.list('bullet', this.bulletStyle.value));
    this.numberStyle.addEventListener('change', () => this.list('number', this.numberStyle.value));
    this.levelDown = this.button('type-level-down', '←', 'Decrease the list level', 'type-icon-btn');
    this.levelUp = this.button('type-level-up', '→', 'Increase the list level', 'type-icon-btn');
    this.levelDown.addEventListener('click', () => this.actions.change({ kind: 'list-level', by: -1 }, 'once'));
    this.levelUp.addEventListener('click', () => this.actions.change({ kind: 'list-level', by: 1 }, 'once'));
    lists.append(this.bullets, this.bulletStyle, this.numbered, this.numberStyle, this.levelDown, this.levelUp);
    const hyphenRow = document.createElement('label');
    hyphenRow.className = 'type-check';
    this.hyphenate = document.createElement('input');
    this.hyphenate.id = 'type-hyphenate';
    this.hyphenate.type = 'checkbox';
    this.hyphenate.addEventListener('change', () => this.actions.change(para({ hyphenate: this.hyphenate.checked }), 'once'));
    const hyphenName = document.createElement('span');
    hyphenName.textContent = 'Hyphenate';
    hyphenRow.append(this.hyphenate, hyphenName);
    hyphenRow.title = 'Break words at the end of a line, with a hyphen, where they allow it';
    paragraph.append(align.row, lists, this.grid('paragraph'), hyphenRow);

    // ---- Text Configurations ----
    const configs = find('type-configs');
    const head = document.createElement('div');
    head.className = 'type-configs-head';
    const heading = document.createElement('span');
    heading.className = 'type-configs-title';
    heading.textContent = 'Text Configurations';
    this.configMenuButton = this.button('type-configs-menu-btn', '☰', 'Text Configurations menu', 'type-icon-btn');
    this.configMenuButton.setAttribute('aria-haspopup', 'menu');
    this.configMenuButton.setAttribute('aria-expanded', 'false');
    this.configMenuButton.setAttribute('aria-controls', 'type-configs-menu');
    this.configMenu = document.createElement('div');
    this.configMenu.id = 'type-configs-menu';
    this.configMenu.className = 'type-configs-menu is-hidden';
    this.configMenu.setAttribute('role', 'menu');
    this.configMenu.setAttribute('aria-label', 'Text Configurations');
    for (const { command, label, title } of CONFIG_COMMANDS) {
      const item = this.button(`type-config-cmd-${command}`, label, title, 'type-configs-menu-item');
      item.setAttribute('role', 'menuitem');
      item.addEventListener('click', () => {
        this.closeConfigMenu();
        this.runConfigCommand(command);
      });
      this.configButtons.set(command, item);
      this.configMenu.append(item);
    }
    this.configMenuButton.addEventListener('click', () => (this.configMenu.classList.contains('is-hidden') ? this.openConfigMenu() : this.closeConfigMenu()));
    this.configMenu.addEventListener('keydown', (ev) => this.configMenuKey(ev));
    // A press anywhere else puts the menu away.
    document.addEventListener('pointerdown', (ev) => {
      if (ev.target instanceof Node && !this.configMenu.contains(ev.target) && ev.target !== this.configMenuButton) this.closeConfigMenu();
    }, true);
    head.append(heading, this.configMenuButton, this.configMenu);
    this.configList = document.createElement('ul');
    this.configList.id = 'type-configs-list';
    this.configList.className = 'type-configs-list';
    this.configList.setAttribute('role', 'listbox');
    this.configList.setAttribute('aria-label', 'Text Configurations');
    const foot = document.createElement('div');
    foot.className = 'type-configs-foot';
    this.configClear = this.button('type-config-clear', 'Clear Overrides', 'Clear Overrides: the selected text keeps what it follows, and nothing of its own beyond it', 'type-seg-btn');
    this.configNew = this.button('type-config-new', '+', "New Text Configuration: from the selected text's own attributes", 'type-icon-btn');
    this.configDelete = this.button('type-config-delete', '−', 'Delete Text Configuration: the one chosen in the list', 'type-icon-btn');
    this.configClear.addEventListener('click', () => this.runConfigCommand('clear-overrides'));
    this.configNew.addEventListener('click', () => this.runConfigCommand('new'));
    this.configDelete.addEventListener('click', () => this.runConfigCommand('delete'));
    const gap = document.createElement('span');
    gap.className = 'type-configs-gap';
    foot.append(this.configClear, gap, this.configNew, this.configDelete);
    const hint = document.createElement('p');
    hint.className = 'type-configs-hint';
    hint.textContent = 'A click applies one, keeping what the text has of its own; Alt and a click clears that.';
    configs.append(head, this.configList, foot, hint);

    this.bindFamily();
    this.bindScrub();
    this.show('character');
  }

  // ---- Showing ----------------------------------------------------------------------------------------------

  /** The tab in view. */
  get shownTab(): TypePanelTab {
    return this.tab;
  }

  /** Brings a tab into view. */
  show(tab: TypePanelTab): void {
    const changed = tab !== this.tab;
    this.tab = tab;
    for (const [each, { button, page }] of this.tabs) {
      const on = each === tab;
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
      button.classList.toggle('is-active', on);
      page.classList.toggle('is-hidden', !on);
    }
    if (changed) this.actions.shown(tab);
  }

  /** Brings Character into view with a field ready to type in: the font family, or the size. */
  focusField(field: 'family' | 'size'): void {
    this.show('character');
    const input = field === 'family' ? this.family : this.numbers.get('type-size')?.input;
    input?.focus();
    input?.select();
  }

  /** Shows a view: every control set to it, but the one being typed in or dragged left alone. */
  render(view: TypePanelView): void {
    this.view = view;
    const { reading, scope } = view;
    this.target.textContent = view.title;
    const next = scope === 'next';
    const typing = document.activeElement;
    for (const { spec, input, label } of this.numbers.values()) {
      const off = next && !spec.next;
      input.disabled = off;
      label.classList.toggle('is-disabled', off);
      if (input !== typing && this.scrub?.spec !== spec) input.value = off ? '' : spec.show(view);
    }
    // The family: its name, marked when this computer does not have it.
    const family = reading.char.fontFamily;
    if (this.family !== typing) this.family.value = family === null ? '' : primaryFamily(family);
    const missing = family !== null && !this.fonts.has(family);
    this.combo.classList.toggle('is-missing', missing);
    this.family.title = missing ? 'Not installed on this computer: drawn in a default face until it is' : 'Font family: type to search';
    this.fillStyles(family, reading.char.fontStyle);
    for (const [toggle, button] of this.toggles) {
      const state = next ? false : toggleState(toggle, reading);
      button.setAttribute('aria-pressed', String(state));
      button.disabled = next;
    }
    const orientable = !next && !reading.path;
    this.horizontal.setAttribute('aria-pressed', String(reading.orientation === 'horizontal'));
    this.vertical.setAttribute('aria-pressed', String(reading.orientation === 'vertical'));
    this.horizontal.disabled = !orientable;
    this.vertical.disabled = !orientable;
    this.vertical.title = reading.path ? 'Text along a path has no vertical' : 'Characters stand in columns, right to left';
    if (!this.picking && reading.char.color !== null && /^#[0-9a-f]{6}$/i.test(reading.char.color)) this.color.value = reading.char.color.toLowerCase();
    this.color.classList.toggle('is-mixed', reading.char.color === null);
    // The paragraph tab acts on text, never on the next text alone.
    for (const [value, button] of this.aligns) {
      button.setAttribute('aria-pressed', String(reading.para.align === value));
      button.disabled = next;
    }
    const list = reading.para.list;
    const kind = list === null ? null : list === 'none' ? 'none' : list.kind;
    this.bullets.setAttribute('aria-pressed', list === null ? 'mixed' : String(kind === 'bullet'));
    this.numbered.setAttribute('aria-pressed', list === null ? 'mixed' : String(kind === 'number'));
    const marker = list !== null && list !== 'none' ? list.marker : undefined;
    this.bulletStyle.value = kind === 'bullet' ? marker ?? BULLET_MARKERS[0] : BULLET_MARKERS[0];
    this.numberStyle.value = kind === 'number' ? marker ?? NUMBER_MARKERS[0] : NUMBER_MARKERS[0];
    for (const control of [this.bullets, this.numbered, this.bulletStyle, this.numberStyle, this.hyphenate]) control.disabled = next;
    const listed = kind === 'bullet' || kind === 'number';
    this.levelDown.disabled = next || !listed || (list !== null && list !== 'none' && list.level <= 1);
    this.levelUp.disabled = next || !listed || (list !== null && list !== 'none' && list.level >= 9);
    this.hyphenate.indeterminate = reading.para.hyphenate === null;
    this.hyphenate.checked = reading.para.hyphenate === true;
    this.renderConfigs(view);
  }

  // ---- Text Configurations ----------------------------------------------------------------------------------------

  /** The Default Configuration and the book's, the one the text follows chosen, a `+` after it for attributes of its own. */
  private renderConfigs(view: TypePanelView): void {
    const reading = view.config;
    // The text's own configuration is chosen when the text changes; mixed, with no text, or chosen since, the choice stays.
    const readingKey = JSON.stringify([view.title, reading]);
    if (readingKey !== this.readingKey) {
      this.readingKey = readingKey;
      if (reading && reading.config !== 'mixed') this.chosenConfig = reading.config;
    }
    if (this.chosenConfig !== null && !view.configs.some((config) => config.id === this.chosenConfig)) this.chosenConfig = null;
    const rows: Array<{ id: string | null; name: string; attrs: Partial<CharAttrs> }> = [{ id: null, name: DEFAULT_CONFIG_NAME, attrs: {} }, ...view.configs];
    const plusOn = reading && reading.config !== 'mixed' && reading.overrides ? reading.config : undefined;
    const background = getComputedStyle(this.configList).backgroundColor || getComputedStyle(document.body).backgroundColor;
    // The plus may be on the Default Configuration, null: none at all is told apart from it.
    const key = JSON.stringify([rows, this.chosenConfig, plusOn === undefined ? '-' : plusOn, background]);
    if (key !== this.configKey) {
      this.configKey = key;
      const hadFocus = this.configList.contains(document.activeElement);
      const items = rows.map((row, i) => {
        const item = document.createElement('li');
        item.id = `type-config-row-${i}`;
        item.className = 'type-config-row';
        item.setAttribute('role', 'option');
        item.dataset.config = row.id ?? '';
        const chosen = row.id === this.chosenConfig;
        item.classList.toggle('is-chosen', chosen);
        item.setAttribute('aria-selected', String(chosen));
        item.tabIndex = chosen ? 0 : -1;
        const name = document.createElement('span');
        name.className = row.id === null ? 'type-config-name is-default' : 'type-config-name';
        name.textContent = row.name;
        styleName(name, row.attrs, background);
        item.append(name);
        if (plusOn !== undefined && row.id === plusOn) {
          const plus = document.createElement('span');
          plus.className = 'type-config-plus';
          plus.textContent = '+';
          plus.title = 'The selected text has attributes of its own beyond this configuration: Alt and a click clears them';
          item.append(plus);
          item.setAttribute('aria-label', `${row.name}, with overrides`);
        }
        item.title = row.id === null ? "The text's own attributes: a click takes a configuration off, keeping them; Alt and a click clears them" : `${row.name}: a click applies it; Alt and a click clears what the text has of its own`;
        item.addEventListener('click', (ev) => this.pickConfig(row.id, ev.altKey));
        item.addEventListener('dblclick', () => {
          if (row.id !== null) this.actions.configCommand('options', row.id);
        });
        item.addEventListener('keydown', (ev) => this.configRowKey(ev, row.id));
        return item;
      });
      this.configList.replaceChildren(...items);
      if (hadFocus) this.configList.querySelector<HTMLElement>('.is-chosen')?.focus();
    }
    // What the commands can do: a configuration of the book chosen, and text to take from or act on.
    const text = view.scope !== 'next';
    const own = this.chosenConfig !== null;
    const able: Record<ConfigCommand, boolean> = {
      new: true,
      duplicate: own,
      delete: own,
      redefine: own && text,
      options: own,
      'clear-overrides': text && reading !== null && reading.overrides,
      'break-link': text && reading !== null && reading.config !== null,
      load: true,
    };
    for (const [command, button] of this.configButtons) button.disabled = !able[command];
    this.configDelete.disabled = !able.delete;
    this.configClear.disabled = !able['clear-overrides'];
  }

  /** Chooses a configuration in the list - one just made or copied - for the commands to act on. */
  chooseConfig(id: string | null): void {
    this.chosenConfig = id;
    if (this.view) this.renderConfigs(this.view);
  }

  /** A row clicked: chosen, and with text to act on, applied - Alt clearing what the text has of its own. */
  private pickConfig(id: string | null, clearOverrides: boolean): void {
    this.chosenConfig = id;
    if (this.view && this.view.scope !== 'next') this.actions.applyConfig(id, clearOverrides);
    else if (this.view) this.renderConfigs(this.view);
  }

  /** The rows' keys: the arrows move the choice, Enter or Space applies it - Alt clearing - Delete deletes it and F2 opens its options. */
  private configRowKey(ev: KeyboardEvent, id: string | null): void {
    const rows = [...this.configList.querySelectorAll<HTMLElement>('.type-config-row')];
    const at = rows.findIndex((row) => (row.dataset.config || null) === id);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + (ev.key === 'ArrowDown' ? 1 : -1)))];
      if (!next) return;
      for (const row of rows) row.tabIndex = row === next ? 0 : -1;
      next.focus();
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      this.pickConfig(id, ev.altKey);
    } else if (ev.key === 'Delete' && id !== null) {
      ev.preventDefault();
      this.chosenConfig = id;
      this.actions.configCommand('delete', id);
    } else if (ev.key === 'F2' && id !== null) {
      ev.preventDefault();
      this.actions.configCommand('options', id);
    }
  }

  /** A command from the menu or a button, on the chosen configuration. */
  private runConfigCommand(command: ConfigCommand): void {
    this.actions.configCommand(command, this.chosenConfig);
  }

  private openConfigMenu(): void {
    this.configMenu.classList.remove('is-hidden');
    this.configMenuButton.setAttribute('aria-expanded', 'true');
    this.configMenu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  private closeConfigMenu(): void {
    if (this.configMenu.classList.contains('is-hidden')) return;
    const inside = this.configMenu.contains(document.activeElement);
    this.configMenu.classList.add('is-hidden');
    this.configMenuButton.setAttribute('aria-expanded', 'false');
    if (inside) this.configMenuButton.focus();
  }

  /** The menu's keys: the arrows go through its rows, Escape puts it away. */
  private configMenuKey(ev: KeyboardEvent): void {
    const items = [...this.configMenu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const n = items.length;
      if (n > 0) items[(at + (ev.key === 'ArrowDown' ? 1 : n - 1) + n) % n].focus();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.closeConfigMenu();
    }
  }

  /** The face list for a family: its faces, and the face shown chosen; the face alone when the family is not here. */
  private fillStyles(family: string | null, style: string | null): void {
    const styles = family === null ? [] : this.fonts.styles(family);
    const choices = style !== null && !styles.includes(style) ? [style, ...styles] : styles;
    const key = choices.join('\n');
    if (this.style.dataset.choices !== key) {
      this.style.dataset.choices = key;
      this.style.replaceChildren(new Option('', ''), ...choices.map((name) => new Option(name, name)));
      (this.style.options[0] as HTMLOptionElement).hidden = true;
    }
    this.style.value = style ?? '';
    this.style.disabled = family === null;
  }

  /** The panel as a check reads it. */
  state(): {
    tab: TypePanelTab;
    title: string;
    scope: TypePanelScope | null;
    family: string;
    missing: boolean;
    style: string;
    fields: Record<string, string>;
    disabled: string[];
    toggles: Record<string, string>;
    align: string | null;
    list: string;
    hyphenate: boolean | 'mixed';
    color: string;
    configs: { rows: Array<{ id: string | null; name: string; chosen: boolean; plus: boolean }>; disabled: ConfigCommand[]; menuOpen: boolean };
  } {
    const fields: Record<string, string> = {};
    const disabled: string[] = [];
    for (const [id, { input }] of this.numbers) {
      fields[id] = input.value;
      if (input.disabled) disabled.push(id);
    }
    const toggles: Record<string, string> = {};
    for (const [toggle, button] of this.toggles) toggles[toggle] = button.getAttribute('aria-pressed') ?? 'false';
    const align = [...this.aligns].find(([, button]) => button.getAttribute('aria-pressed') === 'true')?.[0] ?? null;
    const list = this.view?.reading.para.list;
    return {
      tab: this.tab,
      title: this.target.textContent ?? '',
      scope: this.view?.scope ?? null,
      family: this.family.value,
      missing: this.combo.classList.contains('is-missing'),
      style: this.style.value,
      fields,
      disabled,
      toggles,
      align,
      list: list === undefined || list === null ? 'mixed' : list === 'none' ? 'none' : `${list.kind}:${list.level}:${list.marker ?? ''}`,
      hyphenate: this.hyphenate.indeterminate ? 'mixed' : this.hyphenate.checked,
      color: this.color.value,
      configs: {
        rows: [...this.configList.querySelectorAll<HTMLElement>('.type-config-row')].map((row) => ({
          id: row.dataset.config || null,
          name: row.querySelector('.type-config-name')?.textContent ?? '',
          chosen: row.classList.contains('is-chosen'),
          plus: row.querySelector('.type-config-plus') !== null,
        })),
        disabled: [...this.configButtons].filter(([, button]) => button.disabled).map(([command]) => command),
        menuOpen: !this.configMenu.classList.contains('is-hidden'),
      },
    };
  }

  // ---- Building -----------------------------------------------------------------------------------------------

  private button(id: string, text: string, title: string, className: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = className;
    button.textContent = text;
    button.title = title;
    button.setAttribute('aria-label', title.split(':')[0].replace(/ \(.*\)$/, ''));
    return button;
  }

  private select(id: string, label: string, choices: readonly string[]): HTMLSelectElement {
    const select = document.createElement('select');
    select.id = id;
    select.className = 'type-select type-list-style';
    select.setAttribute('aria-label', label);
    select.title = label;
    for (const choice of choices) select.append(new Option(choice, choice));
    return select;
  }

  private segmented(name: string): { row: HTMLElement; group: HTMLElement } {
    const row = document.createElement('div');
    row.className = 'type-row';
    const label = document.createElement('span');
    label.className = 'type-row-label';
    label.textContent = name;
    const group = document.createElement('div');
    group.className = 'type-seg';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', name);
    row.append(label, group);
    return { row, group };
  }

  /** A tab's number fields, two to a row. */
  private grid(tab: TypePanelTab): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'type-grid';
    for (const spec of NUMBER_FIELDS.filter((each) => each.tab === tab)) grid.append(this.numberField(spec));
    return grid;
  }

  /** One number field: its name, which a drag scrubs, and its box. */
  private numberField(spec: NumberSpec): HTMLElement {
    const field = document.createElement('div');
    field.className = 'type-field';
    const label = document.createElement('label');
    label.className = 'type-label';
    label.htmlFor = spec.id;
    label.textContent = spec.label;
    label.title = `${spec.title}. Drag to change it`;
    label.dataset.scrub = spec.id;
    const input = document.createElement('input');
    input.id = spec.id;
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.title = spec.title;
    input.setAttribute('aria-label', spec.title.split(':')[0].split(',')[0]);
    field.append(label, input);
    this.numbers.set(spec.id, { spec, input, label });

    let before = '';
    const restore = (): void => {
      input.value = this.view ? spec.show(this.view) : before;
    };
    input.addEventListener('focus', () => {
      before = input.value;
      input.select();
    });
    // The renderer shows the change before `change` returns, so the field reads it back as its own unit has it.
    const keep = (): void => {
      if (input.value === before) return;
      const change = spec.parse(input.value);
      if (change) this.actions.change(change, 'once');
      restore();
      before = input.value;
    };
    input.addEventListener('change', keep);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        keep();
        input.select();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        restore();
        input.blur();
      } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (!this.view) return;
        const value = spec.value(this.view) + spec.step * (ev.shiftKey ? 10 : 1) * (ev.key === 'ArrowUp' ? 1 : -1);
        this.actions.change(spec.set(Math.round(value * 100) / 100), 'once');
        restore();
        before = input.value;
        input.select();
      }
    });
    return field;
  }

  // ---- The family list ----------------------------------------------------------------------------------------

  /** The families the list shows for what is typed: the recent ones first, then every match, A to Z. */
  private matches(typed: string): string[] {
    const query = typed.trim().toLowerCase();
    const all = this.fonts.families.map((family) => family.name);
    const hit = (name: string): boolean => query === '' || name.toLowerCase().includes(query);
    const recent = this.fonts.recent.filter((name) => hit(name) && this.fonts.family(name));
    const rest = all.filter((name) => hit(name) && !recent.some((r) => r.toLowerCase() === name.toLowerCase()));
    return [...recent, ...rest].slice(0, LIST_LIMIT);
  }

  private openList(typed: string): void {
    this.options = this.matches(typed);
    const recent = this.fonts.recent.length;
    const items = this.options.map((name, i) => {
      const item = document.createElement('li');
      item.id = `type-family-option-${i}`;
      item.className = 'type-family-option';
      item.setAttribute('role', 'option');
      item.textContent = name;
      item.style.fontFamily = `${cssFamily(name)}, system-ui, sans-serif`;
      if (i < recent && this.fonts.recent.some((r) => r.toLowerCase() === name.toLowerCase())) item.classList.add('is-recent');
      item.addEventListener('pointerdown', (ev) => ev.preventDefault());
      item.addEventListener('click', () => this.chooseFamily(name));
      return item;
    });
    if (items.length === 0) {
      const none = document.createElement('li');
      none.className = 'type-family-none';
      none.textContent = 'No font by that name';
      items.push(none);
    }
    this.familyList.replaceChildren(...items);
    this.familyList.classList.remove('is-hidden');
    this.family.setAttribute('aria-expanded', 'true');
    this.keyed = false;
    this.setActive(this.options.length > 0 && typed.trim() !== '' ? 0 : -1);
  }

  private closeList(): void {
    this.familyList.classList.add('is-hidden');
    this.family.setAttribute('aria-expanded', 'false');
    this.family.removeAttribute('aria-activedescendant');
    this.active = -1;
  }

  private setActive(index: number): void {
    this.familyList.querySelector('.is-active')?.classList.remove('is-active');
    this.active = index;
    if (index < 0) {
      this.family.removeAttribute('aria-activedescendant');
      return;
    }
    const item = this.familyList.children[index] as HTMLElement | undefined;
    if (!item) return;
    item.classList.add('is-active');
    item.setAttribute('aria-selected', 'true');
    this.family.setAttribute('aria-activedescendant', item.id);
    item.scrollIntoView({ block: 'nearest' });
  }

  /** A family chosen: its face kept where it has one by that name, else its regular one. */
  private chooseFamily(name: string): void {
    this.closeList();
    const styles = this.fonts.styles(name);
    const now = this.view?.reading.char.fontStyle ?? null;
    const style = now !== null && styles.includes(now) ? now : styles.find((s) => /^regular$/i.test(s)) ?? styles[0] ?? 'Regular';
    this.family.value = name;
    this.actions.change(char({ fontFamily: name, fontStyle: style }), 'once');
  }

  private bindFamily(): void {
    const field = this.family;
    const restore = (): void => {
      const family = this.view?.reading.char.fontFamily ?? null;
      field.value = family === null ? '' : primaryFamily(family);
    };
    field.addEventListener('focus', () => field.select());
    field.addEventListener('click', () => {
      if (this.familyList.classList.contains('is-hidden')) this.openList('');
    });
    field.addEventListener('input', () => this.openList(field.value));
    field.addEventListener('blur', () => {
      this.closeList();
      restore();
    });
    field.addEventListener('keydown', (ev) => {
      const open = !this.familyList.classList.contains('is-hidden');
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!open) {
          this.openList('');
          return;
        }
        const n = this.options.length;
        if (n === 0) return;
        const next = this.active < 0 ? (ev.key === 'ArrowDown' ? 0 : n - 1) : (this.active + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n;
        this.keyed = true;
        this.setActive(next);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        const typed = field.value.trim().toLowerCase();
        const exact = this.options.find((name) => name.toLowerCase() === typed);
        // A name typed in full wins, unless the arrows went to another.
        const name = this.keyed && this.active >= 0 ? this.options[this.active] : exact ?? (this.active >= 0 ? this.options[this.active] : undefined);
        if (name) this.chooseFamily(name);
        else {
          this.closeList();
          restore();
        }
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.closeList();
        restore();
        field.blur();
      }
    });
  }

  // ---- Lists ----------------------------------------------------------------------------------------------------

  private list(kind: 'bullet' | 'number', marker?: string): void {
    if (this.view) this.actions.change(listChange(kind, this.view.reading, marker), 'once');
  }

  // ---- Scrubbing ------------------------------------------------------------------------------------------------

  /** A drag on a field's name moves its value a step every few pixels, Shift ten; shown as it goes, kept as one change. */
  private bindScrub(): void {
    for (const { spec, input, label } of this.numbers.values()) {
      label.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0 || input.disabled || !this.view) return;
        ev.preventDefault();
        label.setPointerCapture(ev.pointerId);
        this.scrub = { pointerId: ev.pointerId, x: ev.clientX, start: spec.value(this.view), spec, moved: false };
      });
      label.addEventListener('pointermove', (ev) => {
        const scrub = this.scrub;
        if (!scrub || scrub.pointerId !== ev.pointerId) return;
        const steps = Math.trunc((ev.clientX - scrub.x) / SCRUB_PX);
        if (steps === 0 && !scrub.moved) return;
        scrub.moved = true;
        const value = Math.round((scrub.start + steps * spec.step * (ev.shiftKey ? 10 : 1)) * 100) / 100;
        this.actions.change(spec.set(value), 'preview');
        if (this.view) input.value = spec.show(this.view);
      });
      const end = (ev: PointerEvent): void => {
        const scrub = this.scrub;
        if (!scrub || scrub.pointerId !== ev.pointerId) return;
        this.scrub = null;
        if (scrub.moved) this.actions.commit();
        else input.focus();
      };
      label.addEventListener('pointerup', end);
      label.addEventListener('lostpointercapture', end);
      label.addEventListener('click', (ev) => ev.preventDefault());
    }
    // Escape mid-drag takes the drag back.
    window.addEventListener(
      'keydown',
      (ev) => {
        if (ev.key !== 'Escape' || !this.scrub) return;
        ev.preventDefault();
        ev.stopPropagation();
        const scrub = this.scrub;
        this.scrub = null;
        const label = this.numbers.get(scrub.spec.id)?.label;
        if (label?.hasPointerCapture(scrub.pointerId)) label.releasePointerCapture(scrub.pointerId);
        if (scrub.moved) this.actions.cancel();
      },
      true,
    );
  }
}
