/**
 * Held keys: what Space, Ctrl and Shift mean on the canvas.
 *
 * While no press is in progress, `Space` gives the hand - a press pans - and
 * `Ctrl` gives the last selection tool (Select or Direct Select), on every
 * drawing tool. Once a press is under way on a freehand tool, `Space` turns
 * the stroke into a straight line, and with `Ctrl` into the quick curve. The
 * Copic nib-rotate keeps its hold key (`Ctrl` unless the settings say
 * otherwise), as a *still* hold that any movement, press or other key
 * cancels, so it cannot fire under someone aiming the selection tool. A
 * press with `Shift` held draws a straight line on from the end of the last
 * Pen, Marker or Copic mark (the Shift-click line).
 *
 * Nothing here touches the DOM. The drawing window feeds these functions its
 * keys, its pointer movement and its timers, and does what they say.
 */

import type { Stroke, Tool } from '../core/types.js';
import { samePencil } from '../core/pencil.js';
import type { PressKind } from './press-state.js';

/** The selection tools `Ctrl` can give. */
export type SelectionTool = 'select' | 'point';

/**
 * How long `Ctrl` is held alone before the selection tool comes up by
 * itself; a move or a press brings it sooner. A chord typed within this -
 * `Ctrl+Z`, `Ctrl+S` - never shows it, so the pointer does not flicker.
 */
export const SPRING_DELAY_MS = 200;

/** How far the pointer may drift, in screen pixels, while the nib-rotate's hold key is held still. */
export const NIB_HOLD_SLOP_PX = 4;

/**
 * Whether `Ctrl` gives the last selection tool on `tool`: every drawing tool
 * but the two whose `Ctrl` is already a selection of their own - Vector
 * Path's anchor grab and Mesh Warp's pins - and never the selection tools
 * themselves.
 */
export function springsFrom(tool: Tool): boolean {
  return tool !== 'select' && tool !== 'point' && tool !== 'vector' && tool !== 'warp';
}

/** Keys that only modify another key or a press, which never end a hold. */
export function isModifierKey(key: string): boolean {
  return key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta' || key === 'AltGraph' || key === 'CapsLock';
}

// ---- Ctrl: the last selection tool ------------------------------------------

/**
 * The selection tool `Ctrl` gives: `armed` from the moment `Ctrl` goes down,
 * `on` once the pointer moves, presses or {@link SPRING_DELAY_MS} passes.
 */
export type SpringState = 'off' | 'armed' | 'on';

/**
 * `ctrl-down`: `Ctrl` went down with no press under way. `other-key`: a key
 * that is not a modifier. `move`, `press`, `timer`: what brings the tool up.
 * `ctrl-up` and `blur` end it, and so does `nib-on`, the nib-rotate taking
 * the hold over.
 */
export type SpringEvent = 'ctrl-down' | 'other-key' | 'move' | 'press' | 'timer' | 'ctrl-up' | 'blur' | 'nib-on';

/**
 * The spring after an event, and what the window does about it: `show` puts
 * the selection tool in hand, `hide` gives the drawing tool back (after the
 * press, when one is under way). `springs` says whether the tool in hand
 * springs at all, for `ctrl-down`.
 */
export function springStep(
  state: SpringState,
  event: SpringEvent,
  springs = true,
): { state: SpringState; effect: 'show' | 'hide' | null } {
  switch (event) {
    case 'ctrl-down':
      return { state: state === 'off' ? (springs ? 'armed' : 'off') : state, effect: null };
    case 'move':
    case 'press':
    case 'timer':
      return state === 'armed' ? { state: 'on', effect: 'show' } : { state, effect: null };
    case 'other-key':
    case 'ctrl-up':
    case 'blur':
    case 'nib-on':
      return { state: 'off', effect: state === 'on' ? 'hide' : null };
  }
}

// ---- The Copic nib-rotate's still hold --------------------------------------

/** The nib-rotate: `pending` while its hold key is held still, `on` after the hold time. */
export type NibState = 'off' | 'pending' | 'on';

/**
 * `hold-down`: the hold key went down with no press under way, and `arms`
 * says whether the tool in hand and the settings allow the hold. `drift` is
 * how far the pointer has moved, in screen pixels, since the key went down.
 */
export type NibEvent =
  | { type: 'hold-down'; arms: boolean }
  | { type: 'other-key' }
  | { type: 'move'; drift: number }
  | { type: 'press' }
  | { type: 'timer' }
  | { type: 'hold-up' }
  | { type: 'blur' };

/**
 * The nib-rotate after an event: `start` turns the mode on (the Copic in
 * hand, the nib steered by its rotate keys), `end` turns it off and gives the
 * tool back. A key other than the hold key and the rotate keys, a press, or
 * the pointer moving past {@link NIB_HOLD_SLOP_PX} cancels a pending hold;
 * once on, only the hold key's release or a lost window ends it.
 */
export function nibStep(state: NibState, event: NibEvent): { state: NibState; effect: 'start' | 'end' | null } {
  switch (event.type) {
    case 'hold-down':
      return { state: state === 'off' ? (event.arms ? 'pending' : 'off') : state, effect: null };
    case 'other-key':
    case 'press':
      return { state: state === 'pending' ? 'off' : state, effect: null };
    case 'move':
      return { state: state === 'pending' && event.drift > NIB_HOLD_SLOP_PX ? 'off' : state, effect: null };
    case 'timer':
      return state === 'pending' ? { state: 'on', effect: 'start' } : { state, effect: null };
    case 'hold-up':
    case 'blur':
      return { state: 'off', effect: state === 'on' ? 'end' : null };
  }
}

// ---- Space ------------------------------------------------------------------

/**
 * What `Space` does when it goes down. With no press under way it arms the
 * hand, and the next press pans. On a freehand press it turns the stroke into
 * a straight line - or, with `Ctrl` held, the quick curve. Any other press
 * carries on as it was.
 */
export function spaceAction(press: PressKind | null, ctrl: boolean): 'pan' | 'straight' | 'curve' | null {
  if (press === null) return 'pan';
  if (press === 'freehand') return ctrl ? 'curve' : 'straight';
  return null;
}

/** What `Ctrl` does when it joins a press: a straight line drawn with `Space` still held becomes the quick curve. */
export function ctrlJoinsPress(press: PressKind | null, spaceDown: boolean): 'curve' | null {
  return press === 'straight' && spaceDown ? 'curve' : null;
}

// ---- Shift: the Shift-click line ---------------------------------------------

/** The tools a Shift-click line is drawn with: freehand ink. */
export type LineTool = 'pen' | 'marker' | 'copic' | 'pencil';

/** Whether `tool` draws Shift-click lines. */
export function drawsLines(tool: Tool): tool is LineTool {
  return tool === 'pen' || tool === 'marker' || tool === 'copic' || tool === 'pencil';
}

/**
 * Where the next Shift-click line starts, "point 1": the last point of the
 * last Brush, Marker, Copic or Pencil mark committed, with that mark, its tool and its
 * page. The drawing window forgets it on a page turn, an undo or redo, and a
 * tool other than freehand ink taken in hand; {@link shiftLineAction} forgets
 * it once the mark is gone or its end has moved.
 */
export interface LineStart {
  strokeId: string;
  x: number;
  y: number;
  tool: LineTool;
  pageId: string;
}

/** Point 1 as `mark` leaves it: its last point, or null for a mark no line is drawn on from. */
export function lineStartOf(mark: Stroke | undefined, pageId: string): LineStart | null {
  if (!mark || !drawsLines(mark.tool) || mark.points.length === 0) return null;
  const last = mark.points[mark.points.length - 1];
  return { strokeId: mark.id, x: last.x, y: last.y, tool: mark.tool, pageId };
}

/** The paint a new mark takes from the tool in hand. */
export type InkPaint = Pick<Stroke, 'tool' | 'color' | 'width' | 'opacity' | 'nibAngle' | 'profile' | 'pencil'>;

/**
 * Whether `mark` is painted as a new mark from the tool would be: the same
 * tool, colour, width, opacity and profile (the nib, for a Copic, and the
 * pencil, for a Pencil), and none
 * of the paint only the properties panel gives - a fill, a gradient, a dash,
 * a mirrored profile, a hidden outline, effects.
 */
export function samePaint(mark: Stroke, ink: InkPaint): boolean {
  return (
    mark.tool === ink.tool &&
    mark.color === ink.color &&
    mark.width === ink.width &&
    (mark.opacity ?? null) === (ink.opacity ?? null) &&
    (mark.profile ?? null) === (ink.profile ?? null) &&
    (mark.tool !== 'copic' || mark.nibAngle === ink.nibAngle) &&
    (mark.tool !== 'pencil' || samePencil(mark.pencil, ink.pencil)) &&
    !mark.fill &&
    !mark.gradient &&
    (mark.strokeStyle ?? 'solid') === 'solid' &&
    !mark.profileMirrored &&
    !mark.noStroke &&
    !(mark.effects && mark.effects.length > 0)
  );
}

/** What a press with `Shift` held knows when it goes down. */
export interface ShiftPress {
  tool: Tool;
  pageId: string;
  activeLayerId: string;
  /** Symmetry copies are being made: a line added to one mark would leave its copies behind. */
  symmetry: boolean;
  ink: InkPaint;
}

/**
 * What a press with `Shift` held does with point 1. `append`: a straight line
 * from point 1 to the press, added to point 1's mark, which the press goes
 * on drawing. `new`: the same line as a mark of its own - the mark is not
 * painted as the tool paints now, is not on the layer in use, is closed, or
 * symmetry copies are being made. `forget`: point 1 no longer holds (another
 * page, its mark gone or its end moved), and the press snaps its start, as a
 * Shift press has always done; so does null, for no point 1 or another
 * tool's, which is kept for when that tool is back in hand.
 */
export function shiftLineAction(
  start: LineStart | null,
  press: ShiftPress,
  mark: { stroke: Stroke; layerId: string } | null,
): 'append' | 'new' | 'forget' | null {
  if (!start) return null;
  if (start.pageId !== press.pageId || !mark) return 'forget';
  const last = mark.stroke.points[mark.stroke.points.length - 1];
  if (!last || Math.hypot(last.x - start.x, last.y - start.y) > 1e-6) return 'forget';
  if (press.tool !== start.tool) return null;
  if (press.symmetry || mark.layerId !== press.activeLayerId || mark.stroke.vector?.closed === true || !samePaint(mark.stroke, press.ink)) {
    return 'new';
  }
  return 'append';
}
