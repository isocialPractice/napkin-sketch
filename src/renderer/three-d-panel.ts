/**
 * The 3D Options panel (Effect > 3D > 3D Options): the selection's 3D, edited
 * live, as a vector editor's 3D panel edits it. Top to bottom:
 *
 * 1. what is selected, and a line about it - several marks are each built on
 *    their own, text takes no 3D yet;
 * 2. a cube turned as the 3D is turned and lit by its light, which a drag
 *    turns as a trackball does, or the arrow keys 5 degrees at a time;
 * 3. its fields: the kind and its depth, or its revolve; the cap; under
 *    Position its turns, perspective, move and scale; under Surface its
 *    shading and light.
 *
 * Every change shows at once on the canvas and on the gumball. A choice or a
 * check is one undo step; a number typed, a dial turned or the cube dragged is
 * one when it is left, and Escape takes it back. Several marks are set
 * together, each keeping what the change does not touch; a field they differ
 * in reads Mixed. With nothing built in 3D selected, the panel offers Extrude
 * and Revolve.
 *
 * The panel owns no page state. The renderer gives it a view of the selection
 * and does what it asks.
 */

import { EFFECT_FIELDS, effectFieldValue, type EffectField } from '../core/appearance.js';
import type { EffectOf } from '../core/effects.js';
import { rotationMatrix } from '../core/three-d/render.js';
import { angleDial, turnDial } from './effect-options.js';
import { GUMBALL_COLORS, trackballTurn } from './gumball.js';

type ThreeDEffect = EffectOf<'3d'>;

/** What the panel shows, which the renderer works out from the selection. */
export interface ThreeDPanelView {
  /** What is selected: `Path`, `3 Paths`, `Group`; null when nothing is. */
  readonly title: string | null;
  /** The 3D of the first selected mark that has one, or null when none has. */
  readonly effect: ThreeDEffect | null;
  /** The fields, by key, in which the selected marks' 3D differ. */
  readonly mixed: readonly string[];
  /** Whether anything selected can be built in 3D: a path or a shape. */
  readonly buildable: boolean;
  /** A line under the title, or null. */
  readonly note: string | null;
}

/** What the renderer does for the panel. */
export interface ThreeDPanelActions {
  /**
   * Sets a field of every selected mark's 3D, by its key - `depth`,
   * `rotation.1`, `light.azimuth`, or `rotation` whole - shown at once;
   * `done` keeps the change so far as one undo step.
   */
  set(key: string, value: unknown, done: boolean): void;
  /** Takes back a change not yet kept: Escape in a field, or during a drag of the cube. */
  revert(): void;
  /** Builds the selection in 3D. */
  add(kind: 'extrude' | 'revolve'): void;
}

/** The panel's parts, found by id, which a test holds `index.html` to. */
export const THREE_D_PANEL_PARTS = [
  'three-d-title',
  'three-d-note',
  'three-d-add',
  'three-d-extrude',
  'three-d-revolve',
  'three-d-body',
  'three-d-cube',
  'three-d-fields',
] as const;

type Part = (typeof THREE_D_PANEL_PARTS)[number];

/** What a field's number reads as: a share is shown out of 100. */
const UNITS: Partial<Record<EffectField['kind'], string>> = { length: 'px', share: '%', percent: '%', angle: '°' };

/** The cube's side on the screen, in CSS pixels, and how far one arrow key turns it. */
const CUBE_PX = 132;
const KEY_TURN = 5;

/** Rounds a number for its field, so a share's 0.75 reads 75, not 75.00000000000001. */
function shown(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

type Vec3 = [number, number, number];

/** The cube's faces: each one's outward normal and its corners, the front one - the cap's side - first. */
const FACES: ReadonlyArray<{ n: Vec3; corners: Vec3[] }> = [
  { n: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], corners: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]] },
  { n: [1, 0, 0], corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { n: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], corners: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
  { n: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
];

/** The faces' colors: the front, where an extrusion's cap is, in blue; the back darker; the sides grey. */
const FRONT: Vec3 = [74, 132, 238];
const BACK: Vec3 = [39, 73, 109];
const SIDE: Vec3 = [178, 186, 196];

export class ThreeDPanel {
  private view: ThreeDPanelView | null = null;
  /** The kind the fields were laid out for: a revolve's fields are not an extrusion's. */
  private builtFor = '';
  /** A drag of the cube, from its press; `turn` is where it has turned it. */
  private cubeDrag: { pointerId: number; x: number; y: number; from: Vec3; turn: Vec3 | null } | null = null;
  /** True while a dial is being dragged: its field is not written over under it. */
  private dialing = false;
  private readonly parts: Record<Part, HTMLElement>;
  private readonly box: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly actions: ThreeDPanelActions,
  ) {
    const found = {} as Record<Part, HTMLElement>;
    for (const id of THREE_D_PANEL_PARTS) {
      const node = root.querySelector<HTMLElement>(`#${id}`);
      if (!node) throw new Error(`The 3D Options panel has no #${id}.`);
      found[id] = node;
    }
    this.parts = found;
    this.box = root.querySelector<HTMLElement>('.export-dialog-inner') ?? root;
    this.bind();
  }

  /** Shows a view: the fields laid out again only when the kind changed, and a field being edited left as it is. */
  render(view: ThreeDPanelView): void {
    this.view = view;
    this.parts['three-d-title'].textContent = view.title === null ? 'No Selection' : view.effect ? `${view.title}: ${view.effect.kind === 'revolve' ? 'Revolve' : 'Extrude'}` : view.title;
    const note = view.note ?? (view.title !== null && !view.effect && !view.buildable ? 'Nothing selected can be built in 3D: select a path or a shape.' : null);
    this.parts['three-d-note'].textContent = note ?? '';
    this.parts['three-d-note'].classList.toggle('is-hidden', note === null);
    this.parts['three-d-add'].classList.toggle('is-hidden', view.effect !== null || !view.buildable);
    this.parts['three-d-body'].classList.toggle('is-hidden', view.effect === null);
    this.box.classList.toggle('is-empty', view.effect === null);
    const effect = view.effect;
    if (!effect) {
      this.builtFor = '';
      this.parts['three-d-fields'].replaceChildren();
      this.drawCube(null);
      return;
    }
    const refocus = this.builtFor !== effect.kind ? this.build(effect) : undefined;
    this.fill(effect, view.mixed);
    if (refocus) this.parts['three-d-fields'].querySelector<HTMLElement>(`#${refocus}`)?.focus();
    this.drawCube(effect);
  }

  /** The panel as a check reads it: its title and note, whether it offers to build, and each field as it shows. */
  state(): { title: string; note: string | null; adding: boolean; fields: Record<string, string | boolean>; mixed: string[]; rotation: Vec3 | null } {
    const fields: Record<string, string | boolean> = {};
    for (const row of this.parts['three-d-fields'].querySelectorAll<HTMLElement>('.effect-field')) {
      const control = row.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
      if (!control || !row.dataset.key) continue;
      fields[row.dataset.key] = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value;
    }
    const note = this.parts['three-d-note'];
    return {
      title: this.parts['three-d-title'].textContent ?? '',
      note: note.classList.contains('is-hidden') ? null : note.textContent,
      adding: !this.parts['three-d-add'].classList.contains('is-hidden'),
      fields,
      mixed: [...(this.view?.mixed ?? [])],
      rotation: this.view?.effect ? [...this.view.effect.rotation] : null,
    };
  }

  // ---- The fields -----------------------------------------------------------

  /**
   * Lays the fields out for a kind: its own above, then Position and Surface,
   * each a section that folds. Gives the id of the field that had the focus,
   * to be given it back once the values are in.
   */
  private build(effect: ThreeDEffect): string | undefined {
    const host = this.parts['three-d-fields'];
    // A section folded by hand stays folded, and the field that had the focus - Kind, as it changes the form - keeps it.
    const folded = new Set([...host.querySelectorAll<HTMLDetailsElement>('details')].filter((d) => !d.open).map((d) => d.dataset.group ?? ''));
    const focused = host.contains(document.activeElement) ? document.activeElement?.id : undefined;
    host.replaceChildren();
    let into: HTMLElement = host;
    let group: string | undefined;
    for (const field of EFFECT_FIELDS['3d']) {
      if (field.shown && !field.shown(effect)) continue;
      if (field.group !== group) {
        group = field.group;
        if (group) {
          const section = document.createElement('details');
          section.className = 'three-d-section';
          section.dataset.group = group;
          section.open = !folded.has(group);
          const summary = document.createElement('summary');
          summary.className = 'effect-options-group';
          summary.textContent = group;
          section.append(summary);
          host.append(section);
          into = section;
        } else {
          into = host;
        }
      }
      into.append(this.row(field));
    }
    this.builtFor = effect.kind;
    return focused || undefined;
  }

  /** Writes each field's value in, but not into the one being edited, or under a dial being turned. */
  private fill(effect: ThreeDEffect, mixed: readonly string[]): void {
    const active = document.activeElement;
    for (const row of this.parts['three-d-fields'].querySelectorAll<HTMLElement>('.effect-field')) {
      const key = row.dataset.key ?? '';
      const field = EFFECT_FIELDS['3d'].find((each) => each.key === key);
      if (!field) continue;
      const differs = mixed.includes(key);
      const value = effectFieldValue(effect, key);
      const control = row.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
      if (!control || control === active) continue;
      if (control instanceof HTMLSelectElement) {
        control.value = differs ? '' : String(value ?? '');
      } else if (control.type === 'checkbox') {
        control.indeterminate = differs;
        control.checked = value === true;
      } else {
        const scale = field.kind === 'share' ? 100 : 1;
        control.value = differs || typeof value !== 'number' ? '' : shown(value * scale);
        control.placeholder = differs ? 'Mixed' : '';
        if (field.kind === 'angle' && !this.dialing && typeof value === 'number') turnDial(row, value);
        // A dial of a Mixed angle shows no hand: the first mark's angle is not the others'.
        row.querySelector('.angle-dial')?.classList.toggle('is-mixed', differs);
      }
    }
  }

  /** One field's row: its label, its control, its unit, and an angle's dial. */
  private row(field: EffectField): HTMLElement {
    const id = `three-d-field-${field.key.replace('.', '-')}`;
    const row = document.createElement('div');
    row.className = 'effect-field';
    row.dataset.key = field.key;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = field.label;
    row.append(label);

    if (field.kind === 'check') {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.id = id;
      box.addEventListener('change', () => this.actions.set(field.key, box.checked, true));
      row.append(box);
      return row;
    }
    if (field.kind === 'choice') {
      const select = document.createElement('select');
      select.id = id;
      const mixed = new Option('Mixed', '');
      mixed.disabled = true;
      mixed.hidden = true;
      select.append(mixed);
      for (const choice of field.choices ?? []) select.append(new Option(choice.label, choice.value));
      select.addEventListener('change', () => {
        if (select.value) this.actions.set(field.key, select.value, true);
      });
      row.append(select);
      return row;
    }

    // A number: a share is shown and typed out of 100.
    const scale = field.kind === 'share' ? 100 : 1;
    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.className = 'effect-number';
    if (field.min !== undefined) input.min = shown(field.min * scale);
    if (field.max !== undefined) input.max = shown(field.max * scale);
    input.step = shown((field.step ?? 1) * scale);
    const held = (raw: number): number => {
      let value = raw / scale;
      if (field.min !== undefined) value = Math.max(field.min, value);
      if (field.max !== undefined) value = Math.min(field.max, value);
      return value;
    };
    /** The field as typed, held to its range; null while it holds no number. */
    const typed = (): number | null => (input.value.trim() === '' || !Number.isFinite(Number(input.value)) ? null : held(Number(input.value)));
    let before = '';
    input.addEventListener('focus', () => {
      before = input.value;
    });
    input.addEventListener('input', () => {
      const value = typed();
      if (value !== null) this.actions.set(field.key, value, false);
    });
    // A number left or changed by its arrows is kept, and shown as it was held to its range.
    const keep = (): void => {
      const value = typed();
      if (value === null) {
        this.actions.revert();
        return;
      }
      this.actions.set(field.key, value, true);
      input.value = shown(value * scale);
      if (field.kind === 'angle') turnDial(row, value);
    };
    input.addEventListener('change', keep);
    input.addEventListener('blur', keep);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        input.value = before;
        this.actions.revert();
        input.blur();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        input.blur();
      }
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
        angleDial(field, () => Number(input.value || 0), (degrees, done) => {
          this.dialing = !done;
          input.value = String(degrees);
          this.actions.set(field.key, degrees, done);
        }),
      );
    }
    return row;
  }

  // ---- The cube -------------------------------------------------------------

  /**
   * Draws the cube as the 3D turns its solid, through the same perspective,
   * lit by its light and shaded its way - the front, where an extrusion's
   * cap faces, in blue - and in its corner the three axes in the gumball's
   * colors. Wireframe draws every edge.
   */
  private drawCube(effect: ThreeDEffect | null): void {
    const canvas = this.parts['three-d-cube'] as HTMLCanvasElement;
    const dpr = window.devicePixelRatio || 1;
    const side = Math.round(CUBE_PX * dpr);
    if (canvas.width !== side || canvas.height !== side) {
      canvas.width = side;
      canvas.height = side;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CUBE_PX, CUBE_PX);
    if (!effect) return;
    const m = rotationMatrix(effect.rotation);
    const turn = (v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
    const half = 30;
    const middle = CUBE_PX / 2;
    const reach = half * Math.sqrt(3);
    const fov = Math.min(160, Math.max(0, effect.perspective));
    const focal = fov > 0 ? reach / Math.sin((fov * Math.PI) / 360) : 0;
    const project = (v: Vec3): { x: number; y: number } => {
      const k = focal > 0 ? focal / Math.max(focal * 0.05, focal - v[2]) : 1;
      return { x: middle + v[0] * k, y: middle + v[1] * k };
    };
    const rad = (d: number): number => (d * Math.PI) / 180;
    const light: Vec3 = [
      Math.cos(rad(effect.light.elevation)) * Math.cos(rad(effect.light.azimuth)),
      -Math.cos(rad(effect.light.elevation)) * Math.sin(rad(effect.light.azimuth)),
      Math.sin(rad(effect.light.elevation)),
    ];
    const lit = (base: Vec3, n: Vec3): string => {
      if (effect.shading === 'none') return `rgb(${base.join(', ')})`;
      const k = effect.light.ambient + effect.light.intensity * Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
      return `rgb(${base.map((c) => Math.round(Math.min(255, c * k))).join(', ')})`;
    };
    const wire = effect.shading === 'wireframe';
    ctx.lineJoin = 'round';
    FACES.forEach((face, index) => {
      const corners = face.corners.map((c) => turn([c[0] * half, c[1] * half, c[2] * half]));
      const n = turn(face.n);
      const centre = corners.reduce<Vec3>((s, c) => [s[0] + c[0] / 4, s[1] + c[1] / 4, s[2] + c[2] / 4], [0, 0, 0]);
      const facing = focal > 0 ? n[0] * -centre[0] + n[1] * -centre[1] + n[2] * (focal - centre[2]) : n[2];
      if (!wire && facing <= 0) return;
      const points = corners.map(project);
      ctx.beginPath();
      points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      if (!wire) {
        ctx.fillStyle = lit(index === 0 ? FRONT : index === 1 ? BACK : SIDE, n);
        ctx.fill();
      }
      ctx.strokeStyle = wire ? 'rgba(31, 35, 40, 0.75)' : 'rgba(31, 35, 40, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    // The axes, in the corner, the farthest first: which way X, Y and Z point now.
    const corner = { x: 22, y: CUBE_PX - 24 };
    const axes = [0, 1, 2].map((i) => ({ i, d: [m[i], m[3 + i], m[6 + i]] as Vec3 })).sort((a, b) => a.d[2] - b.d[2]);
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { i, d } of axes) {
      const tip = { x: corner.x + d[0] * 11, y: corner.y + d[1] * 11 };
      ctx.globalAlpha = d[2] < -0.05 ? 0.55 : 1;
      ctx.strokeStyle = GUMBALL_COLORS[i];
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(corner.x, corner.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.fillStyle = GUMBALL_COLORS[i];
      ctx.fillText(['X', 'Y', 'Z'][i], corner.x + d[0] * 17, corner.y + d[1] * 17);
    }
    ctx.globalAlpha = 1;
    const [x, y, z] = effect.rotation.map((a) => Math.round(a));
    canvas.setAttribute('aria-label', `The turn: ${x} degrees about X, ${y} about Y, ${z} about Z. Drag to turn it, or use the arrow keys.`);
  }

  // ---- What the parts do ----------------------------------------------------

  private bind(): void {
    this.parts['three-d-extrude'].addEventListener('click', () => this.actions.add('extrude'));
    this.parts['three-d-revolve'].addEventListener('click', () => this.actions.add('revolve'));
    const cube = this.parts['three-d-cube'] as HTMLCanvasElement;
    const radius = CUBE_PX / 2;
    const endDrag = (keep: boolean): void => {
      const drag = this.cubeDrag;
      this.cubeDrag = null;
      if (!drag?.turn) return;
      if (keep) this.actions.set('rotation', drag.turn, true);
      else this.actions.revert();
    };
    cube.addEventListener('pointerdown', (ev) => {
      const effect = this.view?.effect;
      if (!effect || ev.button !== 0) return;
      ev.preventDefault();
      cube.focus();
      cube.setPointerCapture(ev.pointerId);
      this.cubeDrag = { pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, from: [...effect.rotation], turn: null };
    });
    cube.addEventListener('pointermove', (ev) => {
      const drag = this.cubeDrag;
      if (!drag || drag.pointerId !== ev.pointerId) return;
      drag.turn = trackballTurn(drag.from, ev.clientX - drag.x, ev.clientY - drag.y, radius).map((a) => Math.round(a * 100) / 100) as Vec3;
      this.actions.set('rotation', drag.turn, false);
    });
    cube.addEventListener('pointerup', (ev) => {
      if (this.cubeDrag?.pointerId === ev.pointerId) endDrag(true);
    });
    cube.addEventListener('lostpointercapture', (ev) => {
      if (this.cubeDrag?.pointerId === ev.pointerId) endDrag(true);
    });
    cube.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.cubeDrag) {
        ev.preventDefault();
        ev.stopPropagation();
        const drag = this.cubeDrag;
        this.cubeDrag = null;
        if (cube.hasPointerCapture(drag.pointerId)) cube.releasePointerCapture(drag.pointerId);
        if (drag.turn) this.actions.revert();
        return;
      }
      const effect = this.view?.effect;
      const step = ((ev.shiftKey ? 15 : KEY_TURN) * Math.PI * radius) / 180;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (!effect || !(ev.key in moves) || this.cubeDrag) return;
      ev.preventDefault();
      ev.stopPropagation();
      const [dx, dy] = moves[ev.key];
      this.actions.set('rotation', trackballTurn(effect.rotation, dx, dy, radius).map((a) => Math.round(a * 100) / 100), true);
    });
  }
}
