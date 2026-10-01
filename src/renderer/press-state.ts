/**
 * A press on the canvas, as a record: what it is doing, which pointer owns
 * it, and the tool it began with.
 *
 * The drawing window used to know a press only by the pointer it had
 * captured and a scatter of fields each gesture set, and a release worked out
 * what to finish from the tool in hand at the time. That left three ways for
 * a press never to end, and every one of them stopped every tool, because a
 * pointer still owned turns every later press away:
 *
 * - a cancel that dropped a gesture's fields but not its pointer (Escape, or
 *   a lost window, during a quick curve);
 * - a tool changed during the press (the Copic nib-rotate after a second of
 *   Ctrl, or a shortcut key), so the release found no gesture of the new
 *   tool's to finish and returned without letting go;
 * - a release that never came (the window lost, the capture taken away).
 *
 * So a press is recorded when it takes the pointer, a release acts on the
 * record rather than on the tool, whatever ends a press lets go of the
 * pointer, and a press that outlives its pointer is recognised as stale.
 * Nothing here touches the DOM.
 */

import type { Tool } from '../core/types.js';

/** What a press on the canvas is doing, decided when it takes the pointer. */
export type PressKind =
  | 'freehand'
  | 'straight'
  | 'curve'
  | 'chord'
  | 'shape'
  | 'text'
  | 'vector-place'
  | 'vector-edit'
  | 'select-drag'
  | 'rubber-band'
  | 'point-drag'
  | 'pan'
  | 'warp'
  | 'transform'
  | 'rotate'
  | 'stack'
  | 'smear'
  | 'liquify';

/** Every kind, in a fixed order: for tests, and for a check that names them. */
export const PRESS_KINDS: readonly PressKind[] = [
  'freehand',
  'straight',
  'curve',
  'chord',
  'shape',
  'text',
  'vector-place',
  'vector-edit',
  'select-drag',
  'rubber-band',
  'point-drag',
  'pan',
  'warp',
  'transform',
  'rotate',
  'stack',
  'smear',
  'liquify',
];

/** A live press. */
export interface PressRecord {
  kind: PressKind;
  /** The pointer that owns the press, and whose capture it holds. */
  pointerId: number;
  /** The tool in hand when the press began: its moves and its release act on this one. */
  tool: Tool;
}

/**
 * Why a press is being ended by something other than its own release:
 * `blur` the window lost the focus, `hidden` the page was hidden, `capture`
 * the pointer capture was taken away, `escape` the key cancelled the gesture,
 * `stale` a new press found this one still on record after its pointer had
 * gone, `gesture` a second finger turned the press into a pan or zoom.
 */
export type PressEndReason = 'blur' | 'hidden' | 'capture' | 'escape' | 'stale' | 'gesture';

/**
 * How a press ends when something other than its release ends it: `finish`
 * completes it where it stands, as letting go there would; `drop` abandons
 * it, keeping nothing the press was about to add.
 *
 * Escape and a second finger drop, as they always have ("Esc cancels", and a
 * pan takes the canvas over). A curve is a preview until its release, so it
 * is dropped by anything, as a lost window always dropped it. Everything else
 * is finished where it stands: a stroke keeps what was drawn, a drag stays
 * where it was put and a box keeps its size - so a window that loses the
 * focus never loses work, which is also what the window already did with a
 * Vector Path in progress. An edit a drag has already made (Transform,
 * Rotate, a pin, an anchor) is real either way and one undo takes it back.
 */
export function pressEndPolicy(kind: PressKind, reason: PressEndReason): 'finish' | 'drop' {
  if (reason === 'escape' || reason === 'gesture') return 'drop';
  if (kind === 'curve' || kind === 'chord') return 'drop';
  return 'finish';
}

/**
 * Whether the press `owner` holds is stale when `down` goes down. The same
 * pointer cannot go down twice without coming up between, so a press it
 * still owns lost its release somewhere; and a pointer that is no longer
 * tracked has been seen to come up, so a press it owns has nothing left to
 * finish.
 */
export function isStalePress(owner: number, down: number, tracked: { has(id: number): boolean }): boolean {
  return owner === down || !tracked.has(owner);
}

/**
 * Work asked for while a press is live - a change of tool above all - kept
 * for the moment the press ends, and done then in the order it was asked.
 */
export class AfterPress {
  private readonly queue: Array<() => void> = [];

  /** How many are waiting. */
  get size(): number {
    return this.queue.length;
  }

  add(work: () => void): void {
    this.queue.push(work);
  }

  /**
   * Does everything waiting, first asked first, and empties the queue. One
   * that throws does not stop the rest; the first error is thrown again once
   * they have all run. Work added while this runs waits for the next flush.
   */
  flush(): void {
    const run = this.queue.splice(0);
    let failed = false;
    let first: unknown;
    for (const work of run) {
      try {
        work();
      } catch (error) {
        if (!failed) {
          failed = true;
          first = error;
        }
      }
    }
    if (failed) throw first;
  }
}
