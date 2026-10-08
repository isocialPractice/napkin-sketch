/**
 * The effect options popup: one form for every effect, built from the
 * effect's fields (core/appearance.ts's EFFECT_FIELDS) - a length with its
 * unit, a plain number, a percent, an angle with a dial, a color, a blend
 * mode, or one of a few words - under the effect's name, with Preview, OK and
 * Cancel, as a vector editor's effect dialogs are.
 *
 * The form owns no page state. It tells its owner what the effect is as each
 * field changes, while Preview is on; the owner shows that on the canvas and
 * keeps it, or puts the page back, when OK or Cancel answers. A bevel's
 * Highlight and Shadow fields sit under headings of their own. A Warp's
 * form shows its style bending a grid, and changes as each field does.
 */

import { BLEND_FIELD_CHOICES, EFFECT_FIELDS, effectFieldValue, withEffectField, type EffectField } from '../core/appearance.js';
import { EFFECT_LABELS, type Effect, type EffectOf } from '../core/effects.js';
import { WARP_STYLE_LABELS, warpStyleMap } from '../core/warp-styles.js';

/** What the form is opened on. */
export interface EffectOptionsSpec {
  /** The effect as the form starts: a new one's defaults, or one in a list as it is. */
  readonly effect: Effect;
  /** True when OK adds the effect, false when it keeps a change to one already there. */
  readonly adding: boolean;
  /** Whether Preview starts on. */
  readonly preview: boolean;
  /** A line under the effect's name, about what it works on: a Warp on several marks bends each in its own box. */
  readonly note?: string | null;
}

/** What the owner does with the form's answers. */
export interface EffectOptionsActions {
  /** Shows the effect as the form has it on the canvas, or (null) takes the preview off. */
  preview(effect: Effect | null): void;
  /** OK: the effect as the form has it is kept. The form has closed. */
  commit(effect: Effect): void;
  /** Cancel or Escape: nothing is kept. The form has closed. */
  cancel(): void;
  /** Preview was switched, so the next form can open the same way. */
  previewChanged?(on: boolean): void;
}

/** The popup's parts, found by id, which a test holds `index.html` to. */
export const EFFECT_OPTIONS_PARTS = [
  'effect-options-title',
  'effect-options-fields',
  'effect-options-preview',
  'effect-options-ok',
  'effect-options-cancel',
] as const;

type Part = (typeof EFFECT_OPTIONS_PARTS)[number];

/** What a field's number reads as: a share is shown out of 100. */
const UNITS: Partial<Record<EffectField['kind'], string>> = { length: 'px', share: '%', percent: '%', angle: '°' };

/** A CSS color as `#rrggbb`, for a color field; black when it has no opaque form. */
function hexOf(color: unknown): string {
  if (typeof color !== 'string') return '#000000';
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return '#000000';
  probe.fillStyle = '#000000';
  probe.fillStyle = color;
  const value = probe.fillStyle;
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#000000';
}

const SVG = 'http://www.w3.org/2000/svg';

/** Rounds a number for its field, so a share's 0.75 reads 75, not 75.00000000000001. */
function shown(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export class EffectOptions {
  private spec: EffectOptionsSpec | null = null;
  private current: Effect | null = null;
  private returnFocus: Element | null = null;
  private readonly parts: Record<Part, HTMLElement>;

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: EffectOptionsActions,
  ) {
    const found = {} as Record<Part, HTMLElement>;
    for (const id of EFFECT_OPTIONS_PARTS) {
      const node = root.querySelector<HTMLElement>(`#${id}`);
      if (!node) throw new Error(`The effect options popup has no #${id}.`);
      found[id] = node;
    }
    this.parts = found;
    this.bind();
  }

  /** True while the form is up. */
  get isOpen(): boolean {
    return this.spec !== null;
  }

  /** The effect as the form has it now, or null while it is closed. */
  get effect(): Effect | null {
    return this.current;
  }

  /** True while Preview is on. */
  get previewing(): boolean {
    return this.previewBox.checked;
  }

  /** Opens the form on an effect, replacing one already up (whose owner has answered it first). */
  open(spec: EffectOptionsSpec): void {
    if (!this.spec) this.returnFocus = document.activeElement;
    this.spec = spec;
    this.current = spec.effect;
    this.parts['effect-options-title'].textContent = EFFECT_LABELS[spec.effect.type] ?? spec.effect.type;
    this.parts['effect-options-ok'].title = spec.adding ? 'Add the effect, as one undo step' : 'Keep the change, as one undo step';
    this.previewBox.checked = spec.preview;
    this.build();
    this.root.classList.remove('is-hidden');
    this.parts['effect-options-fields'].querySelector<HTMLElement>('input, select, [tabindex]')?.focus();
    if (spec.preview) this.actions.preview(this.current);
  }

  /** OK, as the button does. */
  ok(): void {
    const effect = this.current;
    if (!this.spec || !effect) return;
    this.close();
    this.actions.commit(effect);
  }

  /** Cancel, as the button does. */
  cancel(): void {
    if (!this.spec) return;
    this.close();
    this.actions.cancel();
  }

  /**
   * Closes the form without an answer, when its owner already has one - an
   * edit elsewhere kept the preview, say. Nothing is called back.
   */
  dismiss(): void {
    this.close();
  }

  /**
   * Sets a field as a person would, by its key - `blur`, `highlight.color` -
   * and in the units it is stored in: the form shows it, and Preview shows
   * it on the canvas. False when the effect has no such field.
   */
  setField(key: string, value: unknown): boolean {
    const field = this.fields().find((each) => each.key === key);
    if (!field || !this.current) return false;
    this.change(field, value);
    this.build();
    return true;
  }

  private get previewBox(): HTMLInputElement {
    return this.parts['effect-options-preview'] as HTMLInputElement;
  }

  private fields(): readonly EffectField[] {
    return this.current ? (EFFECT_FIELDS[this.current.type] ?? []) : [];
  }

  private close(): void {
    if (!this.spec) return;
    this.spec = null;
    this.current = null;
    this.root.classList.add('is-hidden');
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back instanceof HTMLElement && back.isConnected && back !== document.body && !this.root.contains(back)) back.focus();
    else if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
  }

  private bind(): void {
    this.parts['effect-options-ok'].addEventListener('click', () => this.ok());
    this.parts['effect-options-cancel'].addEventListener('click', () => this.cancel());
    this.previewBox.addEventListener('change', () => {
      const on = this.previewBox.checked;
      this.actions.previewChanged?.(on);
      if (this.current) this.actions.preview(on ? this.current : null);
    });
    // Enter is OK and Escape is Cancel from anywhere in the form, as in a
    // vector editor's dialogs; the window's own keys never see them.
    this.root.addEventListener('keydown', (ev) => {
      if (!this.spec) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.cancel();
      } else if (ev.key === 'Enter' && !(ev.target instanceof HTMLButtonElement)) {
        ev.preventDefault();
        ev.stopPropagation();
        // A number typed and not yet left is part of the answer.
        if (ev.target instanceof HTMLInputElement) ev.target.dispatchEvent(new Event('change', { bubbles: true }));
        this.ok();
      }
    });
  }

  /** Writes a field's new value into the effect, held to its range, and shows it. */
  private change(field: EffectField, raw: unknown): void {
    if (!this.current) return;
    let value = raw;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return;
      if (field.min !== undefined) value = Math.max(field.min, value as number);
      if (field.max !== undefined) value = Math.min(field.max, value as number);
    }
    this.current = withEffectField(this.current, field.key, value);
    this.drawThumbnail();
    // A field changed by hand leaves the preset it matched, if any: the preset reads Custom.
    if (field.kind !== 'preset') {
      const preset = this.parts['effect-options-fields'].querySelector<HTMLSelectElement>('#effect-field-preset');
      if (preset) preset.value = String(effectFieldValue(this.current, 'preset') ?? '');
    }
    if (this.previewBox.checked) this.actions.preview(this.current);
  }

  /** Lays the form out for the effect as it is now. */
  private build(): void {
    const host = this.parts['effect-options-fields'];
    host.replaceChildren();
    const note = this.spec?.note;
    if (note) {
      const line = document.createElement('p');
      line.className = 'effect-options-note';
      line.textContent = note;
      host.append(line);
    }
    if (this.current?.type === 'warp') {
      const thumbnail = document.createElementNS(SVG, 'svg');
      thumbnail.classList.add('effect-warp-thumbnail');
      thumbnail.setAttribute('role', 'img');
      host.append(thumbnail);
      this.drawThumbnail();
    }
    let group: string | undefined;
    for (const field of this.fields()) {
      // A field this effect has no use for, as it is set now: Part, for a Warp style that bends the whole.
      if (field.shown && this.current && !field.shown(this.current)) continue;
      if (field.group !== group) {
        group = field.group;
        if (group) {
          const heading = document.createElement('p');
          heading.className = 'effect-options-group';
          heading.textContent = group;
          host.append(heading);
        }
      }
      host.append(this.row(field));
    }
  }

  /** One field's row: its label, its control, and its unit. */
  private row(field: EffectField): HTMLElement {
    const id = `effect-field-${field.key.replace('.', '-')}`;
    const row = document.createElement('div');
    row.className = 'effect-field';
    row.dataset.key = field.key;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = field.label;
    row.append(label);
    const value = this.current ? effectFieldValue(this.current, field.key) : undefined;

    if (field.kind === 'check') {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.id = id;
      box.checked = value === true;
      box.addEventListener('change', () => this.change(field, box.checked));
      row.append(box);
      return row;
    }
    if (field.kind === 'color') {
      const input = document.createElement('input');
      input.type = 'color';
      input.id = id;
      input.value = hexOf(value);
      input.addEventListener('input', () => this.change(field, input.value));
      row.append(input);
      return row;
    }
    if (field.kind === 'blend' || field.kind === 'choice' || field.kind === 'preset') {
      const select = document.createElement('select');
      select.id = id;
      const choices = field.kind === 'blend' ? BLEND_FIELD_CHOICES : field.choicesFor && this.current ? field.choicesFor(this.current) : (field.choices ?? []);
      for (const choice of choices) {
        select.append(new Option(choice.label, choice.value));
      }
      select.value = typeof value === 'string' ? value : select.options[0]?.value ?? '';
      select.addEventListener('change', () => {
        this.change(field, select.value);
        // A preset sets every other field, and a Warp's style what Part offers:
        // the form shows them as they are now.
        if (field.kind === 'preset' || field.rebuilds) {
          this.build();
          this.parts['effect-options-fields'].querySelector<HTMLElement>(`#${id}`)?.focus();
        }
      });
      row.append(select);
      return row;
    }

    // A number: a share is shown and typed out of 100.
    const share = field.kind === 'share';
    const scale = share ? 100 : 1;
    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.className = 'effect-number';
    if (field.min !== undefined) input.min = shown(field.min * scale);
    if (field.max !== undefined) input.max = shown(field.max * scale);
    input.step = shown((field.step ?? 1) * scale);
    input.value = typeof value === 'number' ? shown(value * scale) : '';
    const read = (): void => {
      if (input.value.trim() === '') return;
      this.change(field, Number(input.value) / scale);
    };
    input.addEventListener('input', read);
    // Leaving the field shows the number as it was held to its range.
    input.addEventListener('change', () => {
      read();
      const held = this.current ? effectFieldValue(this.current, field.key) : undefined;
      if (typeof held === 'number') input.value = shown(held * scale);
      if (field.kind === 'angle') turnDial(row, Number(input.value));
    });
    row.append(input);
    const unit = UNITS[field.kind];
    if (unit) {
      const tag = document.createElement('span');
      tag.className = 'effect-unit';
      tag.textContent = unit;
      row.append(tag);
    }
    if (field.kind === 'angle') {
      row.append(
        angleDial(field, () => Number(input.value || 0), (degrees) => {
          input.value = String(degrees);
          this.change(field, degrees);
        }),
      );
    }
    return row;
  }

  /**
   * The Warp's thumbnail: a box and a grid inside it, bent by the style as
   * the form has it now, framed to fit whatever the bend makes of them.
   */
  private drawThumbnail(): void {
    const svg = this.parts['effect-options-fields'].querySelector('.effect-warp-thumbnail');
    if (!svg || this.current?.type !== 'warp') return;
    const warp = this.current as EffectOf<'warp'>;
    const box = { minX: 0, minY: 0, maxX: 120, maxY: 80 };
    const map = warpStyleMap(warp.style, box, warp);
    const lines: Array<Array<{ x: number; y: number }>> = [];
    const line = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
      const points: Array<{ x: number; y: number }> = [];
      for (let k = 0; k <= 32; k++) points.push(map.point({ x: from.x + ((to.x - from.x) * k) / 32, y: from.y + ((to.y - from.y) * k) / 32 }));
      lines.push(points);
    };
    for (let i = 0; i <= 6; i++) line({ x: i * 20, y: 0 }, { x: i * 20, y: 80 });
    for (let j = 0; j <= 4; j++) line({ x: 0, y: j * 20 }, { x: 120, y: j * 20 });
    const all = lines.flat();
    const minX = Math.min(...all.map((p) => p.x));
    const minY = Math.min(...all.map((p) => p.y));
    const maxX = Math.max(...all.map((p) => p.x));
    const maxY = Math.max(...all.map((p) => p.y));
    const pad = 4;
    svg.setAttribute('viewBox', `${shown(minX - pad)} ${shown(minY - pad)} ${shown(maxX - minX + pad * 2)} ${shown(maxY - minY + pad * 2)}`);
    svg.setAttribute('aria-label', `${WARP_STYLE_LABELS[warp.style]}, bent ${warp.bend}%`);
    svg.replaceChildren(
      ...lines.map((points, k) => {
        const polyline = document.createElementNS(SVG, 'polyline');
        polyline.setAttribute('points', points.map((p) => `${shown(p.x)},${shown(p.y)}`).join(' '));
        // The box's own edges are drawn bolder than the grid inside it.
        if (k === 0 || k === 6 || k === 7 || k === 11) polyline.classList.add('is-edge');
        return polyline;
      }),
    );
  }

}

/**
 * An angle's dial: a circle with a hand, turned by a drag or by the arrow
 * keys, Shift 15 degrees a press. The angle runs counterclockwise from the
 * right, as a photo editor's light does, so a hand pointing up is 90 degrees.
 * `set` is told each angle it turns to, held to the field's range - `done`
 * once a drag lets go, and for every key - and `value` reads the angle now.
 */
export function angleDial(field: EffectField, value: () => number, set: (degrees: number, done: boolean) => void): HTMLElement {
  const dial = document.createElement('span');
  dial.className = 'angle-dial';
  dial.tabIndex = 0;
  dial.setAttribute('role', 'slider');
  dial.setAttribute('aria-label', `${field.label} dial`);
  if (field.min !== undefined) dial.setAttribute('aria-valuemin', String(field.min));
  if (field.max !== undefined) dial.setAttribute('aria-valuemax', String(field.max));
  const hand = document.createElement('span');
  hand.className = 'angle-dial-hand';
  dial.append(hand);
  let last = value();
  const turn = (degrees: number, done: boolean): void => {
    const lo = field.min ?? 0;
    let angle = Math.round(degrees);
    // A dial goes round once; a field that runs further takes the turn as it is.
    while (angle < lo) angle += 360;
    while (field.max !== undefined && angle > field.max) angle -= 360;
    last = angle;
    turnDial(dial, angle);
    set(angle, done);
  };
  const fromPointer = (ev: PointerEvent, done: boolean): void => {
    const box = dial.getBoundingClientRect();
    const dx = ev.clientX - (box.left + box.width / 2);
    const dy = ev.clientY - (box.top + box.height / 2);
    if (dx === 0 && dy === 0) {
      if (done) set(last, true);
      return;
    }
    turn(((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360, done);
  };
  dial.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    dial.focus();
    dial.setPointerCapture(ev.pointerId);
    fromPointer(ev, false);
  });
  dial.addEventListener('pointermove', (ev) => {
    if (dial.hasPointerCapture(ev.pointerId)) fromPointer(ev, false);
  });
  dial.addEventListener('pointerup', (ev) => {
    if (dial.hasPointerCapture(ev.pointerId)) fromPointer(ev, true);
  });
  dial.addEventListener('pointercancel', (ev) => {
    if (dial.hasPointerCapture(ev.pointerId)) set(last, true);
  });
  dial.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 15 : 1;
    const turns: Record<string, number> = { ArrowUp: step, ArrowRight: -step, ArrowDown: -step, ArrowLeft: step };
    if (!(ev.key in turns)) return;
    ev.preventDefault();
    turn(value() + turns[ev.key], true);
  });
  turnDial(dial, last);
  return dial;
}

/** Points a dial - or the one in a row - at an angle. */
export function turnDial(within: HTMLElement, degrees: number): void {
  const dial = within.classList.contains('angle-dial') ? within : within.querySelector<HTMLElement>('.angle-dial');
  if (!dial) return;
  dial.setAttribute('aria-valuenow', String(degrees));
  dial.style.setProperty('--angle', `${-degrees}deg`);
}
