/**
 * The Type menu's options popup: Type on a Path Options and Area Type
 * Options, a vector editor's, and a Text Configuration's Options, built from
 * their fields (core/type/options.ts) - a choice, a length typed with its
 * unit and shown in points, a box to tick, a color that can be none, a name,
 * a number with its sign, or a leading - under the form's name, with
 * Preview, OK and Cancel, as the effect options popup is. A field that may be
 * blank reads blank as null.
 *
 * The form owns no page state. It tells its owner the values as each field
 * changes, with the fields changed so far, while Preview is on; the owner
 * shows them on the canvas and keeps them, or puts the page back, when OK or
 * Cancel answers.
 */

import { parseAmount, parseLeading, parseLength, showAmount, showLeading, showLength } from '../core/type/panel.js';
import {
  TYPE_OPTION_FIELDS,
  TYPE_OPTIONS_TITLES,
  typeOptionValue,
  type TypeOptionField,
  type TypeOptionValue,
  type TypeOptionValues,
  type TypeOptionsForm,
} from '../core/type/options.js';

/** What the form is opened on. */
export interface TypeOptionsSpec {
  readonly kind: TypeOptionsForm;
  /** The values it starts with: the first text's. */
  readonly values: TypeOptionValues;
  /** Whether Preview starts on. */
  readonly preview: boolean;
  /** A line under the title, about what the form acts on. */
  readonly note?: string | null;
  /** Why a field is greyed for the texts, by its key, as the values stand: Auto Size on a frame that cannot grow. */
  readonly disabled?: (key: string, values: TypeOptionValues) => string | null;
}

/** What the owner does with the form's answers. */
export interface TypeOptionsActions {
  /** Shows the values on the canvas - the fields `changed` only - or (null) takes the preview off. */
  preview(values: TypeOptionValues | null, changed: ReadonlySet<string>): void;
  /** OK: the changed fields are kept. The form has closed. */
  commit(values: TypeOptionValues, changed: ReadonlySet<string>): void;
  /** Cancel or Escape: nothing is kept. The form has closed. */
  cancel(): void;
  /** Preview was switched, so the next form can open the same way. */
  previewChanged?(on: boolean): void;
}

/** The popup's parts, found by id, which a test holds `index.html` to. */
export const TYPE_OPTIONS_PARTS = ['type-options-title', 'type-options-fields', 'type-options-preview', 'type-options-ok', 'type-options-cancel'] as const;

type Part = (typeof TYPE_OPTIONS_PARTS)[number];

/** A color as `#rrggbb`, for a color well; black when it has no opaque form. */
function hexOf(color: TypeOptionValue): string {
  if (typeof color !== 'string') return '#000000';
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return '#000000';
  probe.fillStyle = '#000000';
  probe.fillStyle = color;
  const value = probe.fillStyle;
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#000000';
}

export class TypeOptions {
  private spec: TypeOptionsSpec | null = null;
  private values: Record<string, TypeOptionValue> = {};
  private readonly changed = new Set<string>();
  private returnFocus: Element | null = null;
  private readonly parts: Record<Part, HTMLElement>;

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: TypeOptionsActions,
  ) {
    const found = {} as Record<Part, HTMLElement>;
    for (const id of TYPE_OPTIONS_PARTS) {
      const node = root.querySelector<HTMLElement>(`#${id}`);
      if (!node) throw new Error(`The type options popup has no #${id}.`);
      found[id] = node;
    }
    this.parts = found;
    this.bind();
  }

  /** True while the form is up. */
  get isOpen(): boolean {
    return this.spec !== null;
  }

  /** Which form is up, or null. */
  get kind(): TypeOptionsForm | null {
    return this.spec?.kind ?? null;
  }

  /** The form as a check reads it: its values, the fields changed, and the greyed ones. */
  state(): { open: boolean; kind: TypeOptionsForm | null; values: TypeOptionValues; changed: string[]; disabled: string[]; preview: boolean } {
    const disabled = [...this.parts['type-options-fields'].querySelectorAll<HTMLElement>('.effect-field.is-disabled')].map((row) => row.dataset.key ?? '');
    return { open: this.isOpen, kind: this.kind, values: { ...this.values }, changed: [...this.changed], disabled, preview: this.previewBox.checked };
  }

  /** Opens the form, replacing one already up (whose owner has answered it first). */
  open(spec: TypeOptionsSpec): void {
    if (!this.spec) this.returnFocus = document.activeElement;
    this.spec = spec;
    this.values = { ...spec.values };
    this.changed.clear();
    this.parts['type-options-title'].textContent = TYPE_OPTIONS_TITLES[spec.kind];
    this.previewBox.checked = spec.preview;
    this.build();
    this.root.classList.remove('is-hidden');
    this.parts['type-options-fields'].querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled)')?.focus();
  }

  /** OK, as the button does. */
  ok(): void {
    if (!this.spec) return;
    const values = { ...this.values };
    const changed = new Set(this.changed);
    this.close();
    this.actions.commit(values, changed);
  }

  /** Cancel, as the button does. */
  cancel(): void {
    if (!this.spec) return;
    this.close();
    this.actions.cancel();
  }

  /** Closes the form without an answer, when its owner already has one. Nothing is called back. */
  dismiss(): void {
    this.close();
  }

  /**
   * Sets a field as a person would, by its key, in the units it is stored
   * in: the form shows it, and Preview shows it on the canvas. False when the
   * form has no such field, or the field cannot take the value.
   */
  setField(key: string, value: unknown): boolean {
    const field = this.fields().find((each) => each.key === key);
    if (!field || !this.spec || typeOptionValue(field, value) === undefined) return false;
    this.change(field, value);
    this.build();
    return true;
  }

  private get previewBox(): HTMLInputElement {
    return this.parts['type-options-preview'] as HTMLInputElement;
  }

  private fields(): readonly TypeOptionField[] {
    return this.spec ? TYPE_OPTION_FIELDS[this.spec.kind] : [];
  }

  private close(): void {
    if (!this.spec) return;
    this.spec = null;
    this.values = {};
    this.changed.clear();
    this.root.classList.add('is-hidden');
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back instanceof HTMLElement && back.isConnected && back !== document.body && !this.root.contains(back)) back.focus();
    else if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
  }

  private bind(): void {
    this.parts['type-options-ok'].addEventListener('click', () => this.ok());
    this.parts['type-options-cancel'].addEventListener('click', () => this.cancel());
    this.previewBox.addEventListener('change', () => {
      const on = this.previewBox.checked;
      this.actions.previewChanged?.(on);
      if (this.spec) this.actions.preview(on ? { ...this.values } : null, new Set(this.changed));
    });
    // Enter is OK and Escape is Cancel from anywhere in the form; the window's own keys never see them.
    this.root.addEventListener('keydown', (ev) => {
      if (!this.spec) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.cancel();
      } else if (ev.key === 'Enter' && !(ev.target instanceof HTMLButtonElement)) {
        ev.preventDefault();
        ev.stopPropagation();
        // A length typed and not yet left is part of the answer.
        if (ev.target instanceof HTMLInputElement) ev.target.dispatchEvent(new Event('change', { bubbles: true }));
        this.ok();
      }
    });
  }

  /** A field's new value, held to its range: kept, marked changed, and shown on the canvas while Preview is on. */
  private change(field: TypeOptionField, raw: unknown): void {
    const value = typeOptionValue(field, raw);
    if (value === undefined) return;
    this.values[field.key] = value;
    this.changed.add(field.key);
    this.refreshDisabled();
    if (this.previewBox.checked) this.actions.preview({ ...this.values }, new Set(this.changed));
  }

  /** Lays the form out for its values as they are now. */
  private build(): void {
    const host = this.parts['type-options-fields'];
    host.replaceChildren();
    const note = this.spec?.note;
    if (note) {
      const line = document.createElement('p');
      line.className = 'effect-options-note';
      line.textContent = note;
      host.append(line);
    }
    for (const field of this.fields()) host.append(this.row(field));
    this.refreshDisabled();
  }

  /** Greys the fields that have nothing to do as the values stand, each with its reason as its tooltip. */
  private refreshDisabled(): void {
    const spec = this.spec;
    if (!spec) return;
    for (const row of this.parts['type-options-fields'].querySelectorAll<HTMLElement>('.effect-field')) {
      const key = row.dataset.key ?? '';
      const field = this.fields().find((each) => each.key === key);
      const reason = spec.disabled?.(key, this.values) ?? null;
      row.classList.toggle('is-disabled', reason !== null);
      row.title = reason ?? field?.title ?? '';
      for (const control of row.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) {
        // A paint's color well is greyed with no paint as well.
        control.disabled = reason !== null || (control.dataset.part === 'color' && this.values[key] === null);
      }
    }
  }

  /** One field's row: its label and its control. */
  private row(field: TypeOptionField): HTMLElement {
    const id = `type-option-${field.key}`;
    const row = document.createElement('div');
    row.className = 'effect-field type-option';
    row.dataset.key = field.key;
    row.title = field.title;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = field.label;
    row.append(label);
    const value = this.values[field.key];

    if (field.kind === 'check') {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.id = id;
      box.checked = value === true;
      box.addEventListener('change', () => this.change(field, box.checked));
      row.append(box);
      return row;
    }
    if (field.kind === 'paint') {
      // A paint: a box for whether there is one, and its color.
      const span = document.createElement('span');
      span.className = 'type-option-paint';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.id = id;
      box.checked = value !== null;
      const well = document.createElement('input');
      well.type = 'color';
      well.dataset.part = 'color';
      well.value = hexOf(value);
      well.setAttribute('aria-label', `${field.label} color`);
      box.addEventListener('change', () => this.change(field, box.checked ? well.value : null));
      well.addEventListener('input', () => this.change(field, well.value));
      span.append(box, well);
      row.append(span);
      return row;
    }
    if (field.kind === 'choice') {
      const select = document.createElement('select');
      select.id = id;
      // A blank for a field that may be left unset: a configuration's attribute it does not set.
      if (field.optional) select.append(new Option('', ''));
      for (const choice of field.choices ?? []) select.append(new Option(choice.label, choice.value));
      select.value = typeof value === 'string' ? value : field.optional ? '' : (select.options[0]?.value ?? '');
      select.addEventListener('change', () => this.change(field, select.value === '' && field.optional ? null : select.value));
      row.append(select);
      return row;
    }

    // Typed: a name, or a length with its unit - points by default - a number with its sign, or a leading.
    const input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.className = field.kind === 'text' ? 'type-option-text' : 'type-option-length';
    input.spellcheck = false;
    const shown = (held: TypeOptionValue | undefined): string => {
      if (held === null || held === undefined) return '';
      if (field.kind === 'text') return String(held);
      if (field.kind === 'number') return showAmount(typeof held === 'number' ? held : null, field.suffix ?? '');
      if (field.kind === 'leading') return showLeading(held === 'auto' || typeof held === 'number' ? held : null);
      return showLength(typeof held === 'number' ? held : null);
    };
    input.value = shown(value);
    const parsed = (): TypeOptionValue | undefined => {
      const text = input.value;
      if (text.trim() === '') return field.optional ? null : undefined;
      if (field.kind === 'text') return text;
      if (field.kind === 'number') return parseAmount(text, field.suffix ?? '') ?? undefined;
      if (field.kind === 'leading') {
        const leading = parseLeading(text);
        return leading === null || 'share' in leading ? undefined : 'auto' in leading ? 'auto' : leading.px;
      }
      return parseLength(text) ?? undefined;
    };
    const read = (): void => {
      const next = parsed();
      if (next !== undefined) this.change(field, next);
    };
    input.addEventListener('input', read);
    // Leaving the field shows the value as it was held to its range, or as it was when it does not read.
    input.addEventListener('change', () => {
      read();
      input.value = shown(this.values[field.key]);
    });
    input.addEventListener('focus', () => input.select());
    row.append(input);
    return row;
  }
}
