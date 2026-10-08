/**
 * The Appearance panel (View > Toggle Appearance Panel, `Shift+F6`): what the
 * selection looks like, in the order it is drawn, as a vector editor's
 * Appearance panel lists it. Top to bottom:
 *
 * 1. what is selected - a path, text, an image, a group, or several;
 * 2. its **Stroke**, and under it the effects aimed at the stroke;
 * 3. its **Fill**, and under it the effects aimed at the fill;
 * 4. the effects on the whole of it;
 * 5. its **Opacity** and blend, which are its layer's.
 *
 * An effect's row has an eye that switches it off and on, its name (where it
 * comes from in the tooltip), and an fx button that opens its options. Rows
 * are dragged to reorder, into another section to aim the effect there, and
 * right-clicked for Duplicate, Delete and the moves. A selected row aims a
 * new effect: one added while the Fill row is selected goes on the fill.
 *
 * The panel owns no page state. The renderer gives it a view of the
 * selection and does what its rows ask, each edit one undo step.
 */

import {
  appearanceSections,
  duplicateEffect,
  EFFECT_ORIGINS,
  effectName,
  moveEffect,
  retargetEffect,
  targetOf,
  toggleEffect,
  type AppearanceTarget,
} from '../core/appearance.js';
import { BLEND_MODES } from '../core/blend.js';
import type { Effect } from '../core/effects.js';
import type { ContextMenuItem } from './menus.js';

/** A Stroke or Fill row as the panel shows it. */
export interface AppearancePaint {
  /** What its swatch shows, as a CSS background; null for none, or for marks that differ. */
  readonly color: string | null;
  /** True when the marks differ, which the swatch shows with a pattern of its own. */
  readonly mixed?: boolean;
  /** What the row says after its name: `#1F2328, 2 px`, `Gradient`, `None`, `Mixed`. */
  readonly detail: string;
}

/** What the panel shows, which the renderer works out from the selection. */
export interface AppearanceView {
  /** The first row: `Path`, `3 Paths`, `Text`, `Group`, `Mixed Objects`; null when nothing is selected. */
  readonly title: string | null;
  /** The list every target shares, or null when they differ. */
  readonly effects: readonly Effect[] | null;
  /** The Stroke row, or null for targets with no outline to aim at (an image, a group). */
  readonly stroke: AppearancePaint | null;
  /** The Fill row, the same. */
  readonly fill: AppearancePaint | null;
  /** True for a group, whose effects work on its whole picture: its contents stand where Stroke and Fill do. */
  readonly group: boolean;
  /** The Opacity row's percent, or null when the layers differ. */
  readonly opacity: number | null;
  /** The Opacity row's blend, or null when the layers differ. */
  readonly blend: string | null;
}

/** What the renderer does for the panel. */
export interface AppearanceActions {
  /** Gives every target the list `change` makes of its own, as one undo step that `command` names. */
  edit(command: string, change: (effects: readonly Effect[]) => Effect[]): void;
  /** Opens the options of the effect at `index` of the shared list. */
  options(index: number): void;
  /** Drops the Effect menu's add rows down under a button. */
  addMenu(button: HTMLElement): void;
  /** Clear Appearance: every effect off every target. */
  clear(): void;
  /** Sets the layers' opacity, in percent. */
  opacity(percent: number): void;
  /** Sets the layers' blend, by its id. */
  blend(mode: string): void;
  /** Shows the shared right-click menu at a client point. */
  menu(x: number, y: number, items: ContextMenuItem[]): void;
}

/** The panel's parts, found by id, which a test holds `index.html` to. */
export const APPEARANCE_PANEL_PARTS = [
  'appearance-title',
  'appearance-rows',
  'appearance-opacity',
  'appearance-blend',
  'appearance-add',
  'appearance-clear',
  'appearance-duplicate',
  'appearance-delete',
] as const;

type Part = (typeof APPEARANCE_PANEL_PARTS)[number];

/** A selected row: a paint row, or an effect by its place in the list. */
export type AppearanceRow = { kind: 'paint'; target: 'stroke' | 'fill' } | { kind: 'effect'; index: number };

/** How far a press must travel before it is a drag rather than a click. */
const DRAG_SLOP_PX = 4;

/** What each target's section is called, in the right-click menu's moves. */
const TARGET_NAMES: Record<AppearanceTarget, string> = { stroke: 'Stroke', fill: 'Fill', object: 'Object' };

/** A blend mode as the select names it: "Stack Blend (Multiply)", or "Normal". */
function blendLabel(mode: (typeof BLEND_MODES)[number]): string {
  return mode.id === 'normal' ? mode.label : `${mode.label} (${mode.illustrator})`;
}

export class AppearancePanel {
  private view: AppearanceView | null = null;
  /** The view the rows were last drawn from, as text: the app redraws often, and rows drawn again lose their focus. */
  private drawn = '';
  private selected: AppearanceRow | null = null;
  private readonly parts: Record<Part, HTMLElement>;
  /** The panel itself, which the dock takes out of its overlay: what its states are written on. */
  private readonly box: HTMLElement;
  /** A press on an effect row, until it is let go: a click, or a drag once it has moved. */
  private press: { index: number; pointerId: number; x: number; y: number; dragging: boolean } | null = null;

  constructor(
    root: HTMLElement,
    private readonly actions: AppearanceActions,
  ) {
    const found = {} as Record<Part, HTMLElement>;
    for (const id of APPEARANCE_PANEL_PARTS) {
      const node = root.querySelector<HTMLElement>(`#${id}`);
      if (!node) throw new Error(`The Appearance panel has no #${id}.`);
      found[id] = node;
    }
    this.parts = found;
    this.box = root.querySelector<HTMLElement>('.export-dialog-inner') ?? root;
    fillBlendSelect(this.parts['appearance-blend'] as HTMLSelectElement);
    this.bind();
  }

  /** The row selected, if any. */
  get selection(): AppearanceRow | null {
    return this.selected;
  }

  /**
   * What a new effect is aimed at: the selected Stroke or Fill row, the
   * target of the selected effect, or the whole of the selection.
   */
  get addTarget(): AppearanceTarget {
    const row = this.selected;
    if (!row || !this.view) return 'object';
    if (row.kind === 'paint') return row.target;
    const effect = this.view.effects?.[row.index];
    return effect ? targetOf(effect) : 'object';
  }

  /** Selects a row, as a click does; null clears it. */
  select(row: AppearanceRow | null): void {
    this.selected = row;
    this.paintSelection();
  }

  /**
   * Shows a view. `fresh` says the selection changed, which clears the row
   * selected: a row of one mark means nothing on another.
   */
  render(view: AppearanceView, fresh = false): void {
    this.view = view;
    if (fresh) this.selected = null;
    // An effect row that is gone, or a paint row the targets do not have, is not selected any more.
    const row = this.selected;
    if (row?.kind === 'effect' && !view.effects?.[row.index]) this.selected = null;
    if (row?.kind === 'paint' && !view[row.target]) this.selected = null;
    // The rows are drawn again only when the view changed, and never under a
    // press: the row it holds would go from under it.
    const drawn = JSON.stringify(view);
    if (drawn !== this.drawn && this.press === null) {
      this.drawn = drawn;
      this.parts['appearance-title'].textContent = view.title ?? 'No Selection';
      this.box.classList.toggle('is-empty', view.title === null);
      this.drawRows(view);
    }
    this.drawOpacity(view);
    this.paintSelection();
  }

  // ---- Drawing ------------------------------------------------------------

  private drawRows(view: AppearanceView): void {
    const host = this.parts['appearance-rows'];
    host.replaceChildren();
    if (view.title === null) return;
    const sections = view.effects ? appearanceSections(view.effects) : null;
    if (view.group) host.append(this.plainRow('Contents', 'Its marks, each with its own appearance'));
    if (view.stroke) {
      host.append(this.paintRow('stroke', view.stroke));
      for (const entry of sections?.stroke ?? []) host.append(this.effectRow(entry.effect, entry.index, true));
    }
    if (view.fill) {
      host.append(this.paintRow('fill', view.fill));
      for (const entry of sections?.fill ?? []) host.append(this.effectRow(entry.effect, entry.index, true));
    }
    if (!sections) {
      host.append(this.plainRow('Mixed Appearances', 'The selected items have different effects: Add New Effect and Clear Appearance work on all of them'));
      return;
    }
    for (const entry of sections.object) host.append(this.effectRow(entry.effect, entry.index, false));
  }

  private plainRow(text: string, title: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'appearance-row is-plain';
    row.title = title;
    const name = document.createElement('span');
    name.className = 'appearance-name';
    name.textContent = text;
    row.append(name);
    return row;
  }

  private paintRow(target: 'stroke' | 'fill', paint: AppearancePaint): HTMLElement {
    const row = document.createElement('div');
    row.className = 'appearance-row is-paint';
    row.dataset.target = target;
    row.tabIndex = 0;
    row.setAttribute('role', 'option');
    const label = target === 'stroke' ? 'Stroke' : 'Fill';
    row.title = `${label}: select it, and a new effect goes on the ${target}`;
    const swatch = document.createElement('span');
    swatch.className = 'appearance-swatch';
    swatch.classList.toggle('is-none', paint.color === null && paint.mixed !== true);
    swatch.classList.toggle('is-mixed', paint.mixed === true);
    if (paint.color !== null) swatch.style.background = paint.color;
    swatch.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'appearance-name';
    name.textContent = `${label}:`;
    const detail = document.createElement('span');
    detail.className = 'appearance-detail';
    detail.textContent = paint.detail;
    row.append(name, swatch, detail);
    row.setAttribute('aria-label', `${label}: ${paint.detail}`);
    row.addEventListener('click', () => this.select({ kind: 'paint', target }));
    row.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        ev.stopPropagation();
        this.select({ kind: 'paint', target });
      }
    });
    return row;
  }

  private effectRow(effect: Effect, index: number, nested: boolean): HTMLElement {
    const label = effectName(effect);
    const off = effect.on === false;
    const row = document.createElement('div');
    row.className = 'appearance-row is-effect';
    row.classList.toggle('is-nested', nested);
    row.classList.toggle('is-off', off);
    row.dataset.index = String(index);
    row.dataset.target = targetOf(effect);
    row.tabIndex = 0;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-label', `${label}${off ? ', switched off' : ''}`);

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'layer-toggle appearance-eye';
    eye.classList.toggle('is-off', off);
    eye.textContent = off ? '○' : '◉';
    eye.title = off ? `Show ${label}` : `Hide ${label}`;
    eye.setAttribute('aria-label', eye.title);
    eye.setAttribute('aria-pressed', String(!off));
    eye.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.actions.edit('appearance-toggle', (effects) => toggleEffect(effects, index));
    });

    const name = document.createElement('span');
    name.className = 'appearance-name';
    name.textContent = label;
    const origin = EFFECT_ORIGINS[effect.type];
    name.title = origin ? `${label}: in a vector or photo editor, ${origin}. Double-click for its options.` : label;

    const fx = document.createElement('button');
    fx.type = 'button';
    fx.className = 'appearance-fx';
    fx.textContent = 'fx';
    fx.title = `${label} options`;
    fx.setAttribute('aria-label', `${label} options`);
    fx.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.select({ kind: 'effect', index });
      this.actions.options(index);
    });

    row.append(eye, name, fx);
    // A press selects the row (see onPressEnd); a click no pointer made - from
    // assistive technology - selects it the same way.
    row.addEventListener('click', (ev) => {
      if (ev.detail === 0 && ev.target === row) this.select({ kind: 'effect', index });
    });
    row.addEventListener('dblclick', () => this.actions.options(index));
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.select({ kind: 'effect', index });
      this.actions.menu(ev.clientX, ev.clientY, this.rowMenu(index));
    });
    row.addEventListener('keydown', (ev) => this.onRowKey(ev, index));
    row.addEventListener('pointerdown', (ev) => this.onPressStart(ev, row, index));
    row.addEventListener('pointermove', (ev) => this.onPressMove(ev));
    row.addEventListener('pointerup', (ev) => this.onPressEnd(ev, true));
    row.addEventListener('pointercancel', (ev) => this.onPressEnd(ev, false));
    return row;
  }

  private drawOpacity(view: AppearanceView): void {
    const opacity = this.parts['appearance-opacity'] as HTMLInputElement;
    const blend = this.parts['appearance-blend'] as HTMLSelectElement;
    const none = view.title === null;
    opacity.disabled = none;
    blend.disabled = none;
    if (document.activeElement !== opacity) opacity.value = view.opacity === null ? '' : String(view.opacity);
    opacity.placeholder = view.opacity === null && !none ? 'Mixed' : '';
    if (document.activeElement !== blend) blend.value = view.blend ?? '';
  }

  /** Lights the selected row and sets what the footer can do. */
  private paintSelection(): void {
    const row = this.selected;
    for (const node of this.parts['appearance-rows'].querySelectorAll<HTMLElement>('.appearance-row')) {
      const on =
        row !== null &&
        ((row.kind === 'paint' && node.classList.contains('is-paint') && node.dataset.target === row.target) ||
          (row.kind === 'effect' && node.dataset.index === String(row.index)));
      node.classList.toggle('is-selected', on);
      if (node.tabIndex >= 0) node.setAttribute('aria-selected', String(on));
    }
    const view = this.view;
    const any = view !== null && view.title !== null;
    const effectRow = row?.kind === 'effect';
    const anyEffects = (view?.effects?.length ?? 0) > 0 || view?.effects === null;
    (this.parts['appearance-add'] as HTMLButtonElement).disabled = !any;
    (this.parts['appearance-clear'] as HTMLButtonElement).disabled = !any || !anyEffects;
    (this.parts['appearance-duplicate'] as HTMLButtonElement).disabled = !any || !effectRow;
    (this.parts['appearance-delete'] as HTMLButtonElement).disabled = !any || !effectRow;
  }

  // ---- What the rows do ---------------------------------------------------

  private bind(): void {
    this.parts['appearance-add'].addEventListener('click', () => this.actions.addMenu(this.parts['appearance-add']));
    this.parts['appearance-clear'].addEventListener('click', () => this.actions.clear());
    this.parts['appearance-duplicate'].addEventListener('click', () => this.duplicateSelected());
    this.parts['appearance-delete'].addEventListener('click', () => this.deleteSelected());
    const opacity = this.parts['appearance-opacity'] as HTMLInputElement;
    opacity.addEventListener('change', () => {
      const value = Number(opacity.value);
      if (opacity.value.trim() !== '' && Number.isFinite(value)) this.actions.opacity(Math.max(0, Math.min(100, value)));
    });
    opacity.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        opacity.blur();
      }
    });
    const blend = this.parts['appearance-blend'] as HTMLSelectElement;
    blend.addEventListener('change', () => {
      if (blend.value) this.actions.blend(blend.value);
      blend.blur();
    });
    // A click on the panel's empty space clears the row selection, so the next effect goes on the whole.
    this.parts['appearance-rows'].addEventListener('click', (ev) => {
      if (ev.target === this.parts['appearance-rows']) this.select(null);
    });
  }

  /** Duplicate Selected Item: a copy of the selected effect, just after it. */
  duplicateSelected(): void {
    const row = this.selected;
    if (row?.kind !== 'effect') return;
    this.actions.edit('appearance-duplicate', (effects) => duplicateEffect(effects, row.index));
    this.select({ kind: 'effect', index: row.index + 1 });
  }

  /** Delete Selected Item: the selected effect, gone. */
  deleteSelected(): void {
    const row = this.selected;
    if (row?.kind !== 'effect') return;
    this.actions.edit('appearance-delete', (effects) => effects.filter((_, k) => k !== row.index));
    this.select(null);
  }

  private rowMenu(index: number): ContextMenuItem[] {
    const effect = this.view?.effects?.[index];
    const at = effect ? targetOf(effect) : 'object';
    const targets: AppearanceTarget[] = [];
    if (this.view?.fill) targets.push('fill');
    if (this.view?.stroke) targets.push('stroke');
    targets.push('object');
    return [
      { label: 'Duplicate', action: () => this.duplicateSelected() },
      { label: 'Delete', action: () => this.deleteSelected() },
      { separator: true },
      ...targets.map(
        (target): ContextMenuItem => ({
          label: `Move to ${TARGET_NAMES[target]}`,
          disabled: target === at,
          action: () => this.actions.edit('appearance-move', (effects) => retargetEffect(effects, index, target)),
        }),
      ),
    ];
  }

  /** An effect row's keys: Enter opens its options, Delete removes it, Alt with an arrow moves it in its section. */
  private onRowKey(ev: KeyboardEvent, index: number): void {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      this.select({ kind: 'effect', index });
      this.actions.options(index);
      return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      ev.stopPropagation();
      this.select({ kind: 'effect', index });
      this.deleteSelected();
      return;
    }
    if (ev.key === ' ') {
      ev.preventDefault();
      ev.stopPropagation();
      this.select({ kind: 'effect', index });
      return;
    }
    if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      ev.preventDefault();
      ev.stopPropagation();
      const effects = this.view?.effects;
      const effect = effects?.[index];
      if (!effects || !effect) return;
      // It changes places with the next effect up or down in its own section.
      const same = appearanceSections(effects)[targetOf(effect)].map((entry) => entry.index);
      const up = ev.key === 'ArrowUp';
      const other = same[same.indexOf(index) + (up ? -1 : 1)];
      if (other === undefined) return;
      this.actions.edit('appearance-move', (list) => moveEffect(list, index, up ? other : other + 1));
      // Going down, the rows between close up behind it: it lands where the other was.
      this.select({ kind: 'effect', index: other });
      requestAnimationFrame(() => this.focusEffect(other));
    }
  }

  private focusEffect(index: number): void {
    this.parts['appearance-rows'].querySelector<HTMLElement>(`.appearance-row[data-index="${index}"]`)?.focus();
  }

  // ---- Dragging a row -----------------------------------------------------

  private onPressStart(ev: PointerEvent, row: HTMLElement, index: number): void {
    if (ev.button !== 0 || (ev.target instanceof Element && ev.target.closest('button'))) return;
    this.press = { index, pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, dragging: false };
    row.setPointerCapture(ev.pointerId);
  }

  private onPressMove(ev: PointerEvent): void {
    const press = this.press;
    if (!press || press.pointerId !== ev.pointerId) return;
    if (!press.dragging && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) < DRAG_SLOP_PX) return;
    press.dragging = true;
    this.box.classList.add('is-dragging');
    this.markDrop(this.dropAt(ev.clientX, ev.clientY));
  }

  private onPressEnd(ev: PointerEvent, keep: boolean): void {
    const press = this.press;
    if (!press || press.pointerId !== ev.pointerId) return;
    // Where it lands is read while the press is still the one under way.
    const drop = keep && press.dragging ? this.dropAt(ev.clientX, ev.clientY) : null;
    this.press = null;
    this.box.classList.remove('is-dragging');
    this.markDrop(null);
    if (!press.dragging) {
      if (keep) this.select({ kind: 'effect', index: press.index });
      return;
    }
    if (!drop) return;
    const from = press.index;
    this.actions.edit('appearance-move', (effects) => moveEffect(effects, from, drop.to, drop.target));
    this.select(null);
  }

  /**
   * Where a drag let go at a client point would put the effect: before the
   * effect row under it, over the row's top half, or after it, over its
   * bottom half, in that row's section; at the end of a section, over its
   * Stroke or Fill row; and at the end of the whole list, below the last row.
   * Null where it would not move.
   */
  private dropAt(x: number, y: number): { to: number; target: AppearanceTarget; node: HTMLElement | null; edge: 'above' | 'below' | 'into' } | null {
    const press = this.press;
    const effects = this.view?.effects;
    if (!press || !effects) return null;
    const node = document.elementFromPoint(x, y)?.closest<HTMLElement>('.appearance-row') ?? null;
    if (!node || !this.parts['appearance-rows'].contains(node)) {
      const rows = this.parts['appearance-rows'].getBoundingClientRect();
      if (x < rows.left || x > rows.right || y < rows.top || y > rows.bottom) return null;
      return { to: effects.length, target: 'object', node: null, edge: 'below' };
    }
    if (node.classList.contains('is-paint')) {
      const target = node.dataset.target === 'stroke' ? 'stroke' : 'fill';
      return { to: effects.length, target, node, edge: 'into' };
    }
    if (!node.classList.contains('is-effect')) return null;
    const index = Number(node.dataset.index);
    const box = node.getBoundingClientRect();
    const below = y > box.top + box.height / 2;
    const to = below ? index + 1 : index;
    const target: AppearanceTarget = node.dataset.target === 'stroke' || node.dataset.target === 'fill' ? node.dataset.target : 'object';
    const moving = effects[press.index];
    if ((to === press.index || to === press.index + 1) && moving && targetOf(moving) === target) return null;
    return { to, target, node, edge: below ? 'below' : 'above' };
  }

  private markDrop(drop: { node: HTMLElement | null; edge: 'above' | 'below' | 'into' } | null): void {
    for (const node of this.parts['appearance-rows'].querySelectorAll('.drop-above, .drop-below, .drop-into')) {
      node.classList.remove('drop-above', 'drop-below', 'drop-into');
    }
    if (drop?.node) drop.node.classList.add(`drop-${drop.edge}`);
  }
}

/**
 * Fills a blend select with the modes, a group a family, as the layers panel
 * offers them, and a Mixed the select shows, never offers, when the layers differ.
 */
export function fillBlendSelect(select: HTMLSelectElement): void {
  const mixed = new Option('Mixed', '');
  mixed.disabled = true;
  mixed.hidden = true;
  select.append(mixed);
  const families: Record<string, string> = { darken: 'Darken', lighten: 'Lighten', contrast: 'Contrast', comparative: 'Compare', component: 'Component' };
  let group: HTMLOptGroupElement | null = null;
  for (const mode of BLEND_MODES) {
    const option = new Option(blendLabel(mode), mode.id);
    if (mode.family === 'normal') {
      select.append(option);
      continue;
    }
    if (group?.dataset.family !== mode.family) {
      group = document.createElement('optgroup');
      group.label = families[mode.family];
      group.dataset.family = mode.family;
      select.append(group);
    }
    group.append(option);
  }
}
