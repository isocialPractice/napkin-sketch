/**
 * The type editor: a text mark edited where it stands on the canvas.
 *
 * A textarea cannot show runs, path type, frames, turned characters or
 * vertical text, so the canvas draws everything - the text from its layout,
 * and over it the caret, the selection and an IME's composition, which
 * {@link TypeEditor.overlay} hands the surface. A hidden textarea keeps the
 * focus all the same: it is what receives the keys, the IME and the
 * clipboard, and what a screen reader reads, its value always the mark's
 * text. Nothing the browser would do to it is let happen: each edit it
 * announces (`beforeinput`) is made on the type model instead
 * (core/type/model.ts), and the textarea is set to match. The caret model -
 * where an index stands, which index a point is nearest, where a key takes
 * the caret - is core/type/caret.ts.
 *
 * **Undo.** A burst of typing is one undo step: the editor opens a store
 * transaction at its first edit and keeps writing into it, and the burst
 * ends - the transaction is committed - after {@link BURST_MS} without an
 * edit, or when the caret jumps, an attribute changes or editing ends. A
 * paste, a cut and an attribute change are each a step of their own. A new
 * mark is not on the page until its first edit, which puts it there inside
 * that edit's step.
 *
 * **Typing attributes.** With no range selected, an attribute key sets what
 * the next typed text takes - the caret's typing attributes, as a vector
 * editor's do - and the caret shows the size. Kerning is the exception: it
 * is between the two characters either side of the caret, so it changes the
 * text there and then.
 *
 * **Markdown Flow.** In a Markdown Flow text the caret moves through the
 * Markdown, the blocks the selection is in shown as their source and the rest
 * as they render (core/type/markdown-flow.ts); Enter carries a list or a quote
 * on, as a Markdown editor does.
 */

import type { Vec } from '../core/arc-length.js';
import {
  BURST_MS,
  burstContinues,
  caretAt,
  caretAtIndex,
  caretSegment,
  moveCaret,
  nextIndex,
  paragraphBounds,
  previousIndex,
  selectionQuads,
  selectionRange,
  wordBounds,
  wordStartAfter,
  wordStartBefore,
  type BurstEdit,
  type CaretMove,
  type TextSelection,
} from '../core/type/caret.js';
import { SCRIPT_SIZE, type TypeLayout } from '../core/type/layout.js';
import { markdownEnter, markdownMissing, setMarkdownReveal } from '../core/type/markdown-flow.js';
import {
  AUTO_LEADING,
  DEFAULT_CHAR,
  applyChar,
  applyPara,
  charAttrsAt,
  clipOf,
  readCharAttrs,
  readTextConfigs,
  spliceClip,
  spliceText,
  stepChar,
  type CharAttrs,
  type ParaAttrs,
  type SteppedAttr,
  type TextConfig,
  type TypeClip,
} from '../core/type/model.js';
import type { Stroke, VectorAnchor } from '../core/types.js';
import { kernIndex } from '../core/type/panel.js';
import { toPx } from '../core/units.js';

/** The rich format a copy from a text puts on the clipboard beside plain text: the text and its runs. */
export const TYPE_CLIP_MIME = 'text/x-napkin-type';

/** How long the caret shows, and then hides, in a blink, ms: Windows' own rate. */
export const CARET_BLINK_MS = 530;

/** One point, in page pixels: the steps of the size, leading and shift keys are in points. */
const PT = toPx(1, 'pt');

/** What the editor draws over the canvas while it edits, in page units. */
export interface TypeEditOverlay {
  /** The mark being edited: its selection box is not drawn. */
  id: string;
  /** The caret while it shows: a line, top to bottom. */
  caret: { top: Vec; bottom: Vec } | null;
  /** The selection's highlight, a quadrilateral a line. */
  selection: Array<[Vec, Vec, Vec, Vec]>;
  /** An IME composition's underline. */
  composition: Array<{ from: Vec; to: Vec }>;
  /** The frame or the path the text is set in, as a guide. */
  guide: { anchors: VectorAnchor[]; closed: boolean } | null;
  /** The editor has the keyboard; without it the selection is drawn dimmed. */
  focused: boolean;
  /** A line of words to say under part of the text - a code block's language not installed - and where it starts. */
  hints: Array<{ text: string; at: Vec }>;
}

/** What the editor needs from the drawing window. */
export interface TypeEditorHost {
  /** The mark with this id on the page now, or undefined once it is gone. */
  stroke(id: string): Stroke | undefined;
  /** A text laid out as the canvas sets it. */
  layout(stroke: Stroke): TypeLayout;
  /**
   * Opens one undo step: what the editor writes until {@link closeStep} is
   * one step. `settled` is called when something else - an edit elsewhere,
   * an undo, a page turned - closes it first.
   */
  openStep(settled: () => void): void;
  /** Keeps the open step. */
  closeStep(): void;
  /** Throws the open step away, the page as it was before it. */
  dropStep(): void;
  /** Puts a new mark on the page, in the open step: in place of the path it was made from, `replaces`, when there is one. */
  add(stroke: Stroke, replaces: string | null): void;
  /** Writes a mark's text and type, in the open step. */
  write(id: string, next: Stroke): void;
  /** Takes a mark off the page: in the open step, or with `history` as a step of its own. */
  remove(id: string, history: boolean): void;
  /** A page point in client pixels: where the hidden field goes, for the IME. */
  toClient(p: Vec): { x: number; y: number };
  /** Screen pixels a page pixel spans. */
  zoom(): number;
  repaint(): void;
  /** The system clipboard's plain text, for a paste chosen from a menu. */
  readClipboard(): Promise<string>;
  writeClipboard(text: string): void;
  undo(): void;
  redo(): void;
  /** Editing ended: `kept` is the mark's id, or null when no mark was kept. */
  ended(kept: string | null): void;
  /** The text, the selection or the typing attributes changed: for the Type panel to show them. */
  changed(): void;
}

/** What a check reads of the editor. */
export interface TypeEditorState {
  id: string | null;
  /** The mark is new and not yet on the page. */
  fresh: boolean;
  text: string;
  anchor: number;
  focus: number;
  composing: boolean;
  focused: boolean;
  /** An undo step is open: a burst of typing under way. */
  stepOpen: boolean;
  typing: Partial<CharAttrs> | null;
  /** The caret's segment on the page, while there is one. */
  caret: { top: Vec; bottom: Vec } | null;
  /** The lines said under the text: a code block's language not installed. */
  hints: string[];
  /** The hidden field: its value, selection, label and where it is. */
  field: { value: string; start: number; end: number; label: string; left: number; top: number; focused: boolean };
}

/** A paste's text, its line ends made newlines and the control characters a text cannot show taken out. */
function cleanText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** The runs a copy from a text put on the clipboard, when they are for this `text`; else null. */
function readClip(raw: string, text: string): TypeClip | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { text?: unknown; runs?: unknown; configs?: unknown } | null;
    if (!value || typeof value !== 'object' || typeof value.text !== 'string' || cleanText(value.text) !== text || !Array.isArray(value.runs)) return null;
    const runs: TypeClip['runs'] = [];
    for (const run of value.runs as unknown[]) {
      if (!run || typeof run !== 'object') continue;
      const { start, end, attrs } = run as { start?: unknown; end?: unknown; attrs?: unknown };
      if (typeof start !== 'number' || typeof end !== 'number' || !(start >= 0 && end > start && end <= text.length)) continue;
      runs.push({ start, end, attrs: { ...DEFAULT_CHAR, ...readCharAttrs(attrs) } });
    }
    const configs = readTextConfigs(value.configs, false);
    return { text, runs, ...(configs.length > 0 ? { configs } : {}) };
  } catch {
    return null;
  }
}

/** The first words of a text, for the field's label. */
function firstWords(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  return words.length > 48 ? `${words.slice(0, 47)}…` : words;
}

/** Where a movement key takes the caret, or null for any other key. */
function moveOf(e: KeyboardEvent): CaretMove | null {
  const ctrl = e.ctrlKey || e.metaKey;
  switch (e.key) {
    case 'ArrowLeft':
      return ctrl ? 'word-left' : 'left';
    case 'ArrowRight':
      return ctrl ? 'word-right' : 'right';
    case 'ArrowUp':
      return ctrl ? 'paragraph-up' : 'up';
    case 'ArrowDown':
      return ctrl ? 'paragraph-down' : 'down';
    case 'Home':
      return ctrl ? 'text-start' : 'line-start';
    case 'End':
      return ctrl ? 'text-end' : 'line-end';
    default:
      return null;
  }
}

/** The edits {@link TypeEditor} makes: a burst's, which carry one on, or one of its own, which is its own undo step. */
type EditKind = 'typing' | 'own';

export class TypeEditor {
  private readonly field: HTMLTextAreaElement;
  private id: string | null = null;
  /** A new mark not on the page yet: its first edit puts it there. */
  private fresh: Stroke | null = null;
  /** The path a new mark was made from, which its first edit takes off the page in the same step. */
  private replaces: string | null = null;
  private selection: TextSelection = caretAtIndex(0);
  /** What the next typed text takes, set by an attribute key with no range: the caret's typing attributes. */
  private typing: Partial<CharAttrs> | null = null;
  /** The definition of the Text Configuration the typing attributes follow, which the text may not carry yet. */
  private typingConfigs: TextConfig[] = [];
  private stepOpen = false;
  /** The new mark went on the page in the step that is open: emptied, the step goes, and nothing was ever there. */
  private addedInStep = false;
  private lastEdit: BurstEdit | null = null;
  private burstTimer: number | null = null;
  /** An IME composition under way: where it starts, and how much of the text it covers now. */
  private composition: { start: number; length: number } | null = null;
  private caretShown = true;
  private blinkTimer: number | null = null;
  private focused = false;
  /** The next paste is plain text: set by Ctrl+Shift+V. */
  private plainPaste = false;
  /** The last text copied from a text, its runs and all: a paste of the same plain text gets them back. */
  private lastClip: TypeClip | null = null;
  /** True while the editor writes, so the change it hears back from the page is not taken for someone else's. */
  private writing = false;

  constructor(private readonly host: TypeEditorHost) {
    const field = document.createElement('textarea');
    field.className = 'type-input';
    field.setAttribute('aria-label', 'Text');
    field.setAttribute('aria-multiline', 'true');
    field.spellcheck = false;
    field.autocomplete = 'off';
    field.setAttribute('autocapitalize', 'off');
    field.setAttribute('autocorrect', 'off');
    field.tabIndex = -1;
    field.addEventListener('keydown', (e) => this.onKeyDown(e));
    field.addEventListener('beforeinput', (e) => this.onBeforeInput(e));
    field.addEventListener('compositionstart', () => this.onCompositionStart());
    field.addEventListener('compositionupdate', (e) => this.onComposition(e.data ?? '', false));
    field.addEventListener('compositionend', (e) => this.onComposition(e.data ?? '', true));
    field.addEventListener('copy', (e) => this.onCopy(e, false));
    field.addEventListener('cut', (e) => this.onCopy(e, true));
    field.addEventListener('paste', (e) => this.onPaste(e));
    field.addEventListener('focus', () => {
      this.focused = true;
      this.wake();
    });
    field.addEventListener('blur', () => {
      this.focused = false;
      this.stopBlink();
      this.host.repaint();
    });
    document.body.appendChild(field);
    this.field = field;
  }

  /** True while a text is being edited. */
  get active(): boolean {
    return this.id !== null;
  }

  /** The mark being edited, or null. */
  get editingId(): string | null {
    return this.id;
  }

  /**
   * What the Type panel acts on while a text is edited: the selected stretch,
   * or the caret and the typing attributes. Null when nothing is edited.
   */
  target(): { id: string; stroke: Stroke; start: number; end: number; typing: Partial<CharAttrs> | null } | null {
    const stroke = this.current();
    if (!stroke || !this.id) return null;
    const { start, end } = selectionRange(this.selection);
    return { id: this.id, stroke, start, end, typing: this.typing ? { ...this.typing } : null };
  }

  /** True while the hidden field has the keyboard. */
  get hasFocus(): boolean {
    return this.active && document.activeElement === this.field;
  }

  /** The text being edited as it stands: the new mark, or the page's. */
  private current(): Stroke | undefined {
    if (this.fresh) return this.fresh;
    return this.id ? this.host.stroke(this.id) : undefined;
  }

  // ---- Beginning and ending ---------------------------------------------------

  /**
   * Starts editing `stroke` with the caret at the index nearest `at` (a
   * page point), or at the end. A `fresh` mark is new: it goes on the page
   * with its first edit, and is never there if editing ends before one - in
   * place of the path `replaces`, when it was made from one, which stays as
   * it was until then.
   */
  begin(stroke: Stroke, at: Vec | null, fresh = false, replaces: string | null = null): void {
    if (this.active) this.end();
    this.id = stroke.id;
    this.fresh = fresh ? stroke : null;
    this.replaces = fresh ? replaces : null;
    const text = stroke.text ?? '';
    const hit = at ? caretAt(this.host.layout(stroke), text, at) : null;
    this.selection = hit ? caretAtIndex(hit.index, hit.line) : caretAtIndex(text.length);
    this.clearTyping();
    this.lastEdit = null;
    this.composition = null;
    this.sync();
    this.focus();
    this.wake();
  }

  /**
   * Ends editing, keeping what was typed: the burst under way becomes its
   * step. A text left with nothing in it goes - inside that step, so a new
   * mark typed and emptied leaves no step at all - and a new mark never
   * typed in was never on the page.
   */
  end(): void {
    const id = this.id;
    if (!id) return;
    const stroke = this.current();
    const fresh = this.fresh !== null;
    const empty = !stroke || (stroke.text ?? '') === '';
    if (!fresh && empty && stroke) {
      this.writing = true;
      try {
        if (this.stepOpen && this.addedInStep) {
          this.stepOpen = false;
          this.host.dropStep();
        } else {
          this.host.remove(id, !this.stepOpen);
        }
      } finally {
        this.writing = false;
      }
    }
    this.closeStep();
    this.reset();
    this.host.ended(fresh || empty ? null : id);
  }

  /** Stops editing without touching the page: the mark went, or the page it is on did. */
  private abandon(): void {
    if (!this.id) return;
    this.closeStep();
    this.reset();
    this.host.ended(null);
  }

  private reset(): void {
    this.id = null;
    this.fresh = null;
    this.replaces = null;
    this.clearTyping();
    this.lastEdit = null;
    this.composition = null;
    this.clearBurstTimer();
    this.stopBlink();
    if (document.activeElement === this.field) this.field.blur();
    this.field.value = '';
    this.field.setAttribute('aria-label', 'Text');
    // Editing over, every Markdown block renders.
    setMarkdownReveal(null);
    this.host.repaint();
    this.host.changed();
  }

  /**
   * Hears a change on the page: an undo or redo, a mark deleted, a page
   * turned. The caret is kept inside the text; a mark that is gone ends the
   * editing.
   */
  refresh(): void {
    if (!this.id || this.fresh || this.writing) return;
    const stroke = this.host.stroke(this.id);
    if (!stroke) {
      this.abandon();
      return;
    }
    const length = (stroke.text ?? '').length;
    if (this.selection.anchor > length || this.selection.focus > length) {
      this.selection = { anchor: Math.min(this.selection.anchor, length), focus: Math.min(this.selection.focus, length) };
    }
    this.sync();
  }

  /** Gives the hidden field the keyboard again, after a press on the canvas took it. */
  focus(): void {
    if (!this.active) return;
    if (document.activeElement !== this.field) this.field.focus({ preventScroll: true });
    this.focused = document.activeElement === this.field;
  }

  // ---- Steps ------------------------------------------------------------------

  private openStep(): void {
    if (this.stepOpen) return;
    this.host.openStep(() => {
      // Something else closed it: the burst is over.
      this.stepOpen = false;
      this.addedInStep = false;
      this.lastEdit = null;
      this.clearBurstTimer();
    });
    this.stepOpen = true;
    this.addedInStep = false;
  }

  /** Ends the burst under way: its edits are one undo step. */
  private closeStep(): void {
    this.clearBurstTimer();
    this.lastEdit = null;
    if (!this.stepOpen) return;
    this.stepOpen = false;
    this.addedInStep = false;
    this.writing = true;
    try {
      this.host.closeStep();
    } finally {
      this.writing = false;
    }
  }

  private clearBurstTimer(): void {
    if (this.burstTimer !== null) {
      window.clearTimeout(this.burstTimer);
      this.burstTimer = null;
    }
  }

  /** A burst waits {@link BURST_MS} for its next edit; a composition under way holds it open. */
  private armBurstTimer(): void {
    this.clearBurstTimer();
    this.burstTimer = window.setTimeout(() => {
      this.burstTimer = null;
      if (this.composition) this.armBurstTimer();
      else this.closeStep();
    }, BURST_MS);
  }

  /**
   * Makes an edit: `change` gives the text and the selection after it. A
   * typing edit carries the burst on when it follows on from the last one;
   * an edit of its own is its own step. A new mark goes on the page with its
   * first edit, inside the step.
   */
  private edit(kind: EditKind, change: (stroke: Stroke) => { next: Stroke; selection: TextSelection } | null): void {
    const stroke = this.current();
    const id = this.id;
    if (!stroke || !id) return;
    const result = change(stroke);
    if (!result || result.next === stroke) return;
    const fromIndex = selectionRange(this.selection).start;
    const made: BurstEdit = { at: performance.now(), from: kind === 'typing' ? this.selection.focus : fromIndex, to: result.selection.focus };
    if (kind === 'own' || (this.stepOpen && !burstContinues(this.lastEdit, made))) this.closeStep();
    // A new mark changes off the page until there is text to put there.
    if (this.fresh && (result.next.text ?? '') === '') {
      this.fresh = { ...result.next, id };
      this.selection = result.selection;
      this.sync();
      this.wake();
      return;
    }
    this.writing = true;
    try {
      this.openStep();
      if (this.fresh) {
        this.host.add(this.fresh, this.replaces);
        this.fresh = null;
        this.replaces = null;
        this.addedInStep = true;
      }
      this.host.write(id, result.next);
    } finally {
      this.writing = false;
    }
    this.selection = result.selection;
    if (kind === 'own') {
      this.closeStep();
    } else {
      this.lastEdit = made;
      if (!this.composition) this.armBurstTimer();
    }
    this.sync();
    this.wake();
  }

  /** Replaces the selection with `text`: typed, it takes the typing attributes; over a range, the first character's. */
  private insert(text: string, kind: EditKind, clip: TypeClip | null = null): void {
    this.edit(kind, (stroke) => {
      const { start, end } = selectionRange(this.selection);
      if (text === '' && start === end) return null;
      let next = clip ? spliceClip(stroke, start, end, clip) : spliceText(stroke, start, end, text);
      if (!clip && text !== '') {
        const patch = start !== end ? { ...charAttrsAt(stroke, start), kern: 0 } : this.typing;
        if (patch) next = applyChar(next, { start, end: start + text.length }, patch, start !== end ? [] : this.typingConfigs);
      }
      return { next, selection: caretAtIndex(start + text.length) };
    });
    if (text !== '') this.clearTyping();
  }

  /**
   * Enter: a newline - and in a Markdown Flow text, what a Markdown editor
   * does there: the next list item's marker, or a quote's `> `, or on an empty
   * one the marker taken off; in a fenced code block, the newline alone.
   */
  private newLine(): void {
    const stroke = this.current();
    const { start, end } = selectionRange(this.selection);
    if (stroke?.typeset?.flow !== 'markdown' || start !== end) {
      this.insert('\n', 'typing');
      return;
    }
    const enter = markdownEnter(stroke.text ?? '', start);
    this.edit('typing', (s) => ({ next: spliceText(s, enter.from, enter.to, enter.insert), selection: caretAtIndex(enter.from + enter.insert.length) }));
    this.clearTyping();
  }

  /** Deletes the selection, or from the caret to `to` when there is none. */
  private deleteTo(to: (text: string, focus: number) => number, kind: EditKind = 'typing'): void {
    this.edit(kind, (stroke) => {
      const text = stroke.text ?? '';
      let { start, end } = selectionRange(this.selection);
      if (start === end) {
        const other = Math.max(0, Math.min(text.length, to(text, this.selection.focus)));
        start = Math.min(other, this.selection.focus);
        end = Math.max(other, this.selection.focus);
      }
      if (start === end) return null;
      return { next: spliceText(stroke, start, end, ''), selection: caretAtIndex(start) };
    });
  }

  /** Moves the selection: a jump, which ends the burst and the typing attributes. */
  private select(selection: TextSelection): void {
    this.closeStep();
    this.clearTyping();
    this.selection = selection;
    this.sync();
    this.wake();
  }

  // ---- The pointer ------------------------------------------------------------

  /** Whether a page point is on the text being edited, within `slop` page pixels. */
  contains(p: Vec, slop: number): boolean {
    const stroke = this.current();
    if (!stroke) return false;
    const box = this.host.layout(stroke).bounds;
    return p.x >= box.minX - slop && p.x <= box.maxX + slop && p.y >= box.minY - slop && p.y <= box.maxY + slop;
  }

  /**
   * A press on the text: one click puts the caret at the nearest index, or
   * with `extend` (Shift) takes the selection there; two take the word; three
   * the paragraph.
   */
  press(p: Vec, clicks: number, extend: boolean): void {
    const stroke = this.current();
    if (!stroke) return;
    const text = stroke.text ?? '';
    const hit = caretAt(this.host.layout(stroke), text, p);
    if (clicks >= 2) {
      const range = clicks === 2 ? wordBounds(text, hit.index) : paragraphBounds(text, hit.index);
      this.select({ anchor: range.start, focus: range.end });
    } else if (extend) {
      this.select({ anchor: this.selection.anchor, focus: hit.index, line: hit.line });
    } else {
      this.select(caretAtIndex(hit.index, hit.line));
    }
    this.focus();
  }

  /** A drag from a press on the text: the selection runs from where it began to the index nearest `p`. */
  dragTo(p: Vec): void {
    const stroke = this.current();
    if (!stroke) return;
    const hit = caretAt(this.host.layout(stroke), stroke.text ?? '', p);
    if (hit.index === this.selection.focus && hit.line === this.selection.line) return;
    this.select({ anchor: this.selection.anchor, focus: hit.index, line: hit.line });
  }

  /** Selects all the text: Ctrl+A, or Select All from a menu, while editing. */
  selectAll(): void {
    const stroke = this.current();
    if (!stroke) return;
    this.select({ anchor: 0, focus: (stroke.text ?? '').length });
  }

  // ---- The keyboard -----------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    // The IME has the keys while it composes, Escape and Enter included.
    if (!this.active || e.isComposing || this.composition) return;
    this.wake();
    const ctrl = e.ctrlKey || e.metaKey;
    // AltGr is Ctrl+Alt to the page, and types a character: never a chord here.
    const altGr = e.getModifierState('AltGraph');
    if (e.key === 'Escape' || (e.key === 'Enter' && ctrl)) {
      e.preventDefault();
      this.end();
      return;
    }
    // Undo and redo are the document's, burst by burst. Handled here, the key never reaches the menu's accelerator.
    if (ctrl && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
      e.preventDefault();
      this.closeStep();
      if (e.code === 'KeyY' || e.shiftKey) this.host.redo();
      else this.host.undo();
      return;
    }
    if (!altGr && this.attributeKey(e)) {
      e.preventDefault();
      return;
    }
    if (ctrl && !e.altKey && !e.shiftKey && e.code === 'KeyA') {
      e.preventDefault();
      this.selectAll();
      return;
    }
    if (ctrl && e.shiftKey && !e.altKey && e.code === 'KeyV') {
      // The browser's own paste follows, as plain text.
      this.plainPaste = true;
      window.setTimeout(() => (this.plainPaste = false), 0);
      return;
    }
    // Tab stays in the text, as it would in a text box: Escape is the way out.
    if (e.key === 'Tab') {
      e.preventDefault();
      return;
    }
    const move = e.altKey ? null : moveOf(e);
    if (move) {
      e.preventDefault();
      const stroke = this.current();
      if (stroke) this.select(moveCaret(this.host.layout(stroke), stroke.text ?? '', this.selection, move, e.shiftKey));
    }
  }

  /**
   * The editor's own keys, a vector editor's: size, leading, kerning or
   * tracking, baseline shift, alignment, All Caps, horizontal scale and
   * spacing back to none. True when `e` was one.
   */
  private attributeKey(e: KeyboardEvent): boolean {
    const ctrl = e.ctrlKey || e.metaKey;
    const { altKey: alt, shiftKey: shift } = e;
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    const across = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    if (ctrl && shift && (e.code === 'Period' || e.code === 'Comma')) {
      this.step('fontSize', (alt ? 10 : 2) * PT * (e.code === 'Period' ? 1 : -1));
      return true;
    }
    if (alt && shift && !ctrl && vertical) {
      this.step('baselineShift', 2 * PT * (e.key === 'ArrowUp' ? 1 : -1));
      return true;
    }
    if (alt && !shift && !ctrl && vertical) {
      // Up draws the lines together, down apart.
      this.step('leading', 2 * PT * (e.key === 'ArrowUp' ? -1 : 1));
      return true;
    }
    if (alt && !shift && across) {
      this.space(20 * (ctrl ? 5 : 1) * (e.key === 'ArrowRight' ? 1 : -1));
      return true;
    }
    if (ctrl && shift && !alt) {
      const align = ({ KeyL: 'left', KeyC: 'center', KeyR: 'right', KeyJ: 'justify' } as Record<string, ParaAttrs['align']>)[e.code];
      if (align) {
        this.setPara({ align });
        return true;
      }
      if (e.code === 'KeyK') {
        this.toggleCaps();
        return true;
      }
      if (e.code === 'KeyX') {
        this.setChar({ hScale: 100 });
        return true;
      }
    }
    if (ctrl && alt && !shift && e.code === 'KeyQ') {
      this.resetSpacing();
      return true;
    }
    return false;
  }

  /** What typing at the caret would set: the character before it, or at the start the one after, and the typing attributes. */
  private typingAttrs(stroke: Stroke): CharAttrs {
    const focus = this.selection.focus;
    return { ...charAttrsAt(stroke, focus > 0 ? focus - 1 : 0), ...(this.typing ?? {}) };
  }

  /** Steps an attribute: of the selected characters, each from its own; with none, the typing attributes'. */
  private step(key: SteppedAttr, by: number): void {
    const stroke = this.current();
    if (!stroke) return;
    const { start, end } = selectionRange(this.selection);
    if (start === end) {
      const now = this.typingAttrs(stroke);
      const value = key === 'leading' ? (now.leading === 'auto' ? AUTO_LEADING * now.fontSize : now.leading) : now[key];
      this.setTyping(readCharAttrs({ [key]: value + by }));
      return;
    }
    this.edit('own', (s) => ({ next: stepChar(s, { start, end }, key, by), selection: this.selection }));
  }

  /** Sets character attributes: on the selected characters, or with none as the typing attributes. */
  private setChar(patch: Partial<CharAttrs>): void {
    const { start, end } = selectionRange(this.selection);
    if (start === end) {
      this.setTyping(patch);
      return;
    }
    this.edit('own', (s) => ({ next: applyChar(s, { start, end }, patch), selection: this.selection }));
  }

  /**
   * Sets what the next typed text takes, with only the caret: an editor key,
   * or the Type panel - with the definition of a Text Configuration it
   * follows, in `configs`, which the text may not carry yet.
   */
  setTypingAttrs(patch: Partial<CharAttrs>, configs: readonly TextConfig[] = []): void {
    this.setTyping(patch, configs);
  }

  /** The typing attributes gone, and the definitions they carried with them. */
  private clearTyping(): void {
    this.typing = null;
    this.typingConfigs = [];
  }

  private setTyping(patch: Partial<CharAttrs>, configs: readonly TextConfig[] = []): void {
    this.closeStep();
    this.typing = { ...(this.typing ?? {}), ...patch };
    if (configs.length > 0) this.typingConfigs = [...configs];
    this.wake();
    this.host.changed();
  }

  /** Sets paragraph attributes on every paragraph the selection touches, the caret's with none. */
  private setPara(patch: Partial<ParaAttrs>): void {
    const { start, end } = selectionRange(this.selection);
    this.edit('own', (s) => ({ next: applyPara(s, { start, end }, patch), selection: this.selection }));
  }

  /** All Caps on, or off when every selected character - or the typing attributes - already has it. */
  private toggleCaps(): void {
    const stroke = this.current();
    if (!stroke) return;
    const { start, end } = selectionRange(this.selection);
    let all = start === end ? this.typingAttrs(stroke).caps === 'all' : true;
    for (let i = start; i < end && all; i++) if (charAttrsAt(stroke, i).caps !== 'all') all = false;
    this.setChar({ caps: all ? 'normal' : 'all' });
  }

  /** Kerning between the characters either side of the caret, or tracking over a range, by thousandths of an em. */
  private space(by: number): void {
    const stroke = this.current();
    if (!stroke) return;
    const { start, end } = selectionRange(this.selection);
    if (start !== end) {
      this.edit('own', (s) => ({ next: stepChar(s, { start, end }, 'tracking', by), selection: this.selection }));
      return;
    }
    const before = kernIndex(stroke.text ?? '', this.selection.focus);
    if (before === null) return;
    this.edit('own', (s) => ({ next: stepChar(s, { start: before, end: this.selection.focus }, 'kern', by), selection: this.selection }));
  }

  /** Tracking and kerning back to none: of a range, or the caret's kerning and the typing attributes' tracking. */
  private resetSpacing(): void {
    const stroke = this.current();
    if (!stroke) return;
    const { start, end } = selectionRange(this.selection);
    if (start !== end) {
      this.edit('own', (s) => ({ next: applyChar(s, { start, end }, { tracking: 0, kern: 0 }), selection: this.selection }));
      return;
    }
    const before = kernIndex(stroke.text ?? '', this.selection.focus);
    if (before !== null) this.edit('own', (s) => ({ next: applyChar(s, { start: before, end: this.selection.focus }, { kern: 0 }), selection: this.selection }));
    this.setTyping({ tracking: 0 });
  }

  /** Each edit the field announces, made on the type model instead. */
  private onBeforeInput(e: InputEvent): void {
    if (!this.active) return;
    // A composition's own edits run their course; compositionupdate and compositionend carry them.
    if (this.composition || e.isComposing || e.inputType.includes('Composition')) return;
    e.preventDefault();
    switch (e.inputType) {
      case 'insertText':
      case 'insertReplacementText':
        this.insert(cleanText(e.data ?? e.dataTransfer?.getData('text/plain') ?? ''), 'typing');
        break;
      case 'insertLineBreak':
      case 'insertParagraph':
        this.newLine();
        break;
      case 'deleteContentBackward':
        this.deleteTo((text, focus) => previousIndex(text, focus));
        break;
      case 'deleteContentForward':
        this.deleteTo((text, focus) => nextIndex(text, focus));
        break;
      case 'deleteWordBackward':
        this.deleteTo((text, focus) => wordStartBefore(text, focus));
        break;
      case 'deleteWordForward':
        this.deleteTo((text, focus) => wordStartAfter(text, focus));
        break;
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward':
        this.deleteTo((text, focus) => this.lineEdge(text, 'line-start', focus));
        break;
      case 'deleteSoftLineForward':
      case 'deleteHardLineForward':
        this.deleteTo((text, focus) => this.lineEdge(text, 'line-end', focus));
        break;
      default:
        // Undo and redo come by the keys; drags and drops are not the field's.
        break;
    }
  }

  /** Where the caret's line starts or ends. */
  private lineEdge(text: string, move: 'line-start' | 'line-end', focus: number): number {
    const stroke = this.current();
    if (!stroke) return focus;
    return moveCaret(this.host.layout(stroke), text, { ...this.selection, anchor: focus, focus }, move, false).focus;
  }

  // ---- IME composition --------------------------------------------------------

  private onCompositionStart(): void {
    if (!this.active) return;
    const { start, end } = selectionRange(this.selection);
    // A composition is typing: it carries on a burst it follows.
    if (this.stepOpen && this.lastEdit?.to !== start) this.closeStep();
    this.composition = { start, length: end - start };
  }

  /** The composition as it stands, written over what it covered; at its end, kept. */
  private onComposition(data: string, done: boolean): void {
    const composing = this.composition;
    if (!this.active || !composing) return;
    const text = cleanText(data);
    this.edit('typing', (stroke) => {
      const { start, length } = composing;
      if (length === 0 && text === '') return null;
      let next = spliceText(stroke, start, start + length, text);
      if (this.typing && text !== '') next = applyChar(next, { start, end: start + text.length }, this.typing, this.typingConfigs);
      return { next, selection: caretAtIndex(start + text.length) };
    });
    composing.length = text.length;
    if (done) {
      this.composition = null;
      if (text !== '') this.clearTyping();
      if (this.stepOpen) this.armBurstTimer();
      this.sync();
    }
    this.host.repaint();
  }

  // ---- The clipboard ----------------------------------------------------------

  /** The selected stretch as a copy carries it, or null with nothing selected. */
  private copySelection(): TypeClip | null {
    const stroke = this.current();
    if (!stroke) return null;
    const { start, end } = selectionRange(this.selection);
    if (start === end) return null;
    const clip = clipOf(stroke, start, end);
    this.lastClip = clip;
    return clip;
  }

  private onCopy(e: ClipboardEvent, cut: boolean): void {
    if (!this.active) return;
    const clip = this.copySelection();
    // With nothing selected the browser's own copy copies nothing, and the clipboard keeps what it had.
    if (!clip || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', clip.text);
    e.clipboardData.setData(TYPE_CLIP_MIME, JSON.stringify(clip));
    if (cut) this.deleteTo((_, focus) => focus, 'own');
  }

  private onPaste(e: ClipboardEvent): void {
    if (!this.active) return;
    e.preventDefault();
    const plain = this.plainPaste;
    this.plainPaste = false;
    const data = e.clipboardData;
    if (!data) return;
    const text = cleanText(data.getData('text/plain'));
    const clip = plain ? null : readClip(data.getData(TYPE_CLIP_MIME), text) ?? (this.lastClip?.text === text ? this.lastClip : null);
    this.insert(text, 'own', clip);
  }

  /** Copy, from a menu: the selected text goes out as plain text, and its runs stay here for a paste back. */
  copy(): boolean {
    const clip = this.copySelection();
    if (!clip) return false;
    this.host.writeClipboard(clip.text);
    return true;
  }

  /** Cut, from a menu. */
  cut(): void {
    if (this.copy()) this.deleteTo((_, focus) => focus, 'own');
  }

  /** Delete, from a menu: the selected text, as a step of its own. */
  deleteSelection(): void {
    this.deleteTo((_, focus) => focus, 'own');
  }

  /** Paste, from a menu: the clipboard's text, with its runs when it is what was last copied from a text here. */
  async paste(plain: boolean): Promise<void> {
    const text = cleanText(await this.host.readClipboard());
    if (!this.active || text === '') return;
    const clip = !plain && this.lastClip?.text === text ? this.lastClip : null;
    this.insert(text, 'own', clip);
    this.focus();
  }

  // ---- The field and the caret --------------------------------------------------

  /** Sets the hidden field to the text and the selection, and puts it at the caret for the IME. */
  private sync(): void {
    const stroke = this.current();
    if (!stroke) return;
    const text = stroke.text ?? '';
    // A composition writes the field itself: touching it now would end the composition.
    if (!this.composition) {
      if (this.field.value !== text) this.field.value = text;
      const { start, end } = selectionRange(this.selection);
      const direction = this.selection.focus < this.selection.anchor ? 'backward' : 'forward';
      if (this.field.selectionStart !== start || this.field.selectionEnd !== end) this.field.setSelectionRange(start, end, direction);
    }
    const words = firstWords(text);
    const label = words ? `Text: ${words}` : 'Text: new';
    if (this.field.getAttribute('aria-label') !== label) this.field.setAttribute('aria-label', label);
    // A Markdown Flow text shows the blocks the selection is in as their source, the rest as they render.
    if (stroke.typeset?.flow === 'markdown' && this.id) {
      const { start, end } = selectionRange(this.selection);
      setMarkdownReveal(this.id, start, end);
    } else {
      setMarkdownReveal(null);
    }
    this.place();
    this.host.changed();
  }

  /** Puts the hidden field at the caret, as tall as it is on the screen: where an IME shows its candidates. */
  place(): void {
    const stroke = this.current();
    if (!stroke) return;
    const caret = caretSegment(this.host.layout(stroke), stroke.text ?? '', this.selection);
    const top = caret ? this.host.toClient(caret.top) : this.host.toClient(stroke.points[0] ?? { x: 0, y: 0 });
    const height = caret ? Math.hypot(caret.bottom.x - caret.top.x, caret.bottom.y - caret.top.y) * this.host.zoom() : 16;
    const size = Math.max(8, Math.min(200, Math.round(height)));
    this.field.style.left = `${Math.round(top.x)}px`;
    this.field.style.top = `${Math.round(top.y)}px`;
    this.field.style.height = `${size}px`;
    this.field.style.fontSize = `${size}px`;
  }

  /** The caret shows, and blinks from now: after a key, a click or a change. */
  private wake(): void {
    this.caretShown = true;
    this.stopBlink();
    if (this.active && this.focused) {
      this.blinkTimer = window.setInterval(() => {
        this.caretShown = !this.caretShown;
        if (!document.hidden) this.host.repaint();
      }, CARET_BLINK_MS);
    }
    this.host.repaint();
  }

  private stopBlink(): void {
    if (this.blinkTimer !== null) {
      window.clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }
  }

  /** The caret as the typing attributes would set it: their size, about the same baseline, and their shift. */
  private typedCaret(stroke: Stroke, caret: { at: Vec; top: Vec; bottom: Vec }): { top: Vec; bottom: Vec } {
    const typing = this.typing;
    if (!typing || (typing.fontSize === undefined && typing.baselineShift === undefined && typing.position === undefined)) return caret;
    const focus = this.selection.focus;
    const was = charAttrsAt(stroke, focus > 0 ? focus - 1 : 0);
    const now = { ...was, ...typing };
    const size = (attrs: CharAttrs): number => attrs.fontSize * (attrs.position === 'normal' ? 1 : SCRIPT_SIZE);
    const k = size(now) / (size(was) || 1);
    const length = Math.hypot(caret.bottom.x - caret.top.x, caret.bottom.y - caret.top.y) || 1;
    const down = { x: (caret.bottom.x - caret.top.x) / length, y: (caret.bottom.y - caret.top.y) / length };
    const lift = now.baselineShift - was.baselineShift;
    const at = { x: caret.at.x - down.x * lift, y: caret.at.y - down.y * lift };
    const scaled = (p: Vec): Vec => ({ x: at.x + (p.x - caret.at.x) * k, y: at.y + (p.y - caret.at.y) * k });
    return { top: scaled(caret.top), bottom: scaled(caret.bottom) };
  }

  /** What the surface draws over the text being edited, or null when nothing is. */
  overlay(): TypeEditOverlay | null {
    const stroke = this.current();
    const id = this.id;
    if (!stroke || !id) return null;
    const layout = this.host.layout(stroke);
    const text = stroke.text ?? '';
    const { start, end } = selectionRange(this.selection);
    const segment = start === end && this.caretShown && this.focused ? caretSegment(layout, text, this.selection) : null;
    const composition = this.composition
      ? selectionQuads(layout, text, this.composition.start, this.composition.start + this.composition.length).map((q) => ({ from: q[3], to: q[2] }))
      : [];
    const guide = layout.frame ? { anchors: layout.frame.anchors, closed: true } : layout.path ? { anchors: layout.path.anchors, closed: layout.path.closed } : null;
    return {
      id,
      caret: segment ? this.typedCaret(stroke, segment) : null,
      selection: selectionQuads(layout, text, start, end),
      composition,
      guide,
      focused: this.focused,
      hints: this.hints(stroke, layout),
    };
  }

  /**
   * A line under each Markdown code block whose language is not installed,
   * where its last line ends: said while the text is edited, and not part of
   * it.
   */
  private hints(stroke: Stroke, layout: TypeLayout): TypeEditOverlay['hints'] {
    return markdownMissing(stroke).flatMap((missing) => {
      const lines = layout.lines.filter((line) => line.start >= missing.start && line.start <= missing.end);
      const last = lines[lines.length - 1];
      if (!last) return [];
      return [{ text: `${missing.language} is not installed - Type > Clean Language Accents > Languages`, at: { x: last.x, y: last.y + last.descent } }];
    });
  }

  /** Where the caret meets its baseline, on the page; null with nothing edited. */
  caretPoint(): Vec | null {
    const stroke = this.current();
    if (!stroke) return null;
    return caretSegment(this.host.layout(stroke), stroke.text ?? '', this.selection)?.at ?? null;
  }

  /** What a check reads. */
  state(): TypeEditorState {
    const stroke = this.current();
    const caret = stroke ? caretSegment(this.host.layout(stroke), stroke.text ?? '', this.selection) : null;
    const rect = this.field.getBoundingClientRect();
    return {
      id: this.id,
      fresh: this.fresh !== null,
      text: stroke?.text ?? '',
      anchor: this.selection.anchor,
      focus: this.selection.focus,
      composing: this.composition !== null,
      focused: this.focused,
      stepOpen: this.stepOpen,
      typing: this.typing ? { ...this.typing } : null,
      caret: caret && stroke ? this.typedCaret(stroke, caret) : null,
      hints: stroke ? this.hints(stroke, this.host.layout(stroke)).map((hint) => hint.text) : [],
      field: {
        value: this.field.value,
        start: this.field.selectionStart,
        end: this.field.selectionEnd,
        label: this.field.getAttribute('aria-label') ?? '',
        left: rect.left,
        top: rect.top,
        focused: document.activeElement === this.field,
      },
    };
  }
}
