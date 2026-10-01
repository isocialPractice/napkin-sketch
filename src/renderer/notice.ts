/**
 * Session notices: a small dialog that says why an action did nothing - a
 * title, a sentence, a "Do not show this notice again" check box and OK.
 *
 * A notice ticked away stays away for the rest of the session only: nothing
 * is kept in the settings or on disk, so a new session explains itself
 * again. What it would have said still shows, as a toast, so an action is
 * never silently ignored.
 *
 * The dialog is the static `#notice-dialog` in `index.html`.
 */

/** A notice by id: its title and the sentence it says. */
export interface Notice {
  id: string;
  title: string;
  text: string;
}

export class SessionNotices {
  private readonly dismissed = new Set<string>();
  private open: Notice | null = null;
  /** Where the focus was before the notice took it, to go back to. */
  private returnFocus: { focus(): void } | null = null;

  /** `toast` shows a notice ticked away; `root` holds the dialog (the document, unless a test gives another). */
  constructor(
    private readonly toast: (text: string) => void,
    private readonly root: Pick<Document, 'getElementById' | 'activeElement'> = document,
  ) {}

  /** Shows a notice, or its toast once it has been ticked away this session. */
  show(notice: Notice): void {
    if (this.dismissed.has(notice.id)) {
      this.toast(notice.text);
      return;
    }
    const dialog = this.root.getElementById('notice-dialog');
    const title = this.root.getElementById('notice-title');
    const text = this.root.getElementById('notice-text');
    const again = this.root.getElementById('notice-again') as HTMLInputElement | null;
    const ok = this.root.getElementById('notice-ok') as HTMLButtonElement | null;
    if (!dialog || !title || !text || !again || !ok) {
      this.toast(notice.text);
      return;
    }
    this.open = notice;
    title.textContent = notice.title;
    text.textContent = notice.text;
    again.checked = false;
    ok.onclick = () => this.close();
    // The dialog keeps its keys - Enter would open the Move dialog behind it -
    // and Enter or Escape closes it, as OK does.
    dialog.onkeydown = (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter' || ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
    };
    const active = this.root.activeElement as HTMLElement | null;
    this.returnFocus = active && active !== ok && typeof active.focus === 'function' ? active : null;
    dialog.classList.remove('is-hidden');
    ok.focus();
  }

  /** Closes the notice showing, ticking it away if its box is ticked. */
  close(): void {
    const notice = this.open;
    if (!notice) return;
    const again = this.root.getElementById('notice-again') as HTMLInputElement | null;
    if (again?.checked) this.dismissed.add(notice.id);
    this.open = null;
    this.root.getElementById('notice-dialog')?.classList.add('is-hidden');
    // The focus goes back where it was, so the next key means what it meant
    // before the notice; a hidden OK keeps none.
    const back = this.returnFocus;
    this.returnFocus = null;
    (this.root.getElementById('notice-ok') as HTMLButtonElement | null)?.blur();
    back?.focus();
  }

  /** The notice showing, or null. */
  get showing(): Notice | null {
    return this.open;
  }

  /** Whether a notice has been ticked away this session. */
  isDismissed(id: string): boolean {
    return this.dismissed.has(id);
  }
}

/** The Shape Eraser's notices. */
export const SHAPE_ERASER_NOTICES = {
  noSelection: { id: 'shape-eraser-no-selection', title: 'Nothing to erase', text: 'Select the layers to erase first.' },
  openPath: { id: 'shape-eraser-open-path', title: 'The top path is open', text: 'The top path must be closed to erase with it.' },
  onePath: { id: 'shape-eraser-one-path', title: 'Only one path selected', text: 'Select the layers to erase as well as the path on top.' },
} as const satisfies Record<string, Notice>;

/** Make Clipping Mask's notices, the Shape Eraser's sentences for the clip's own case. */
export const CLIP_NOTICES = {
  openPath: { id: 'clip-open-path', title: 'The top path is open', text: 'The top path must be closed to clip with it.' },
  onePath: { id: 'clip-one-path', title: 'Only one path selected', text: 'Select what to clip as well as the path on top.' },
} as const satisfies Record<string, Notice>;

/** The Shape Stacker's notice. */
export const SHAPE_STACKER_NOTICES = {
  tooFew: { id: 'shape-stacker-too-few', title: 'Nothing to stack', text: 'Select two or more shapes to stack.' },
} as const satisfies Record<string, Notice>;
