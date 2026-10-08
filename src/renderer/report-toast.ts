/**
 * Report toasts: a small notice in the bottom-right corner that says what an
 * action could not do, line by line.
 *
 * The centred toast says one short sentence and is gone in under three
 * seconds. A report can hold more than anyone reads in that time - style
 * rules that matched no layer, fonts that are not installed - so it shows a
 * one-line title, opens to its details, can be closed, and fades on its own
 * only after `reportToastSeconds` (15 unless changed; 0 keeps it until it is
 * closed). It holds still while the pointer or the keyboard focus is on it, or
 * while its details are open, and gets its full time again once they leave: a
 * report being read never fades under its reader, which is what WCAG 2.2.1
 * (timing adjustable) asks of a notice that goes by itself.
 *
 * Up to three stack upward, the newest at the bottom. A fourth takes the place
 * of the oldest one nobody is holding. A report shown with the id of one on
 * screen replaces it where it is, rather than stacking a second copy.
 *
 * The rules are {@link ReportToastStack}, which knows nothing of the DOM and
 * is what the unit tests drive. {@link ReportToasts} draws the stack into
 * `#report-toasts` and wires the pointer, the focus and the keys to it.
 */

/** How a report reads: `warning` for something left undone, `info` for a plain account. */
export type ReportLevel = 'info' | 'warning';

/**
 * A button on a detail row: what it says, and what it does. A string `run`
 * returns replaces the row's text - "Renamed Titel to Title" - and the button
 * goes, since it has done its one thing.
 */
export interface ReportAction {
  label: string;
  run: () => string | void;
}

/** One line of a report's details. */
export interface ReportDetail {
  text: string;
  /** A likely fix, shown after the text: "Did you mean Title?" */
  suggestion?: string;
  action?: ReportAction;
}

/** What to report. */
export interface ReportSpec {
  /** Names the report: a second one with the same id replaces the first where it is. */
  id: string;
  /** `warning` unless given. */
  level?: ReportLevel;
  /** One line, cut with an ellipsis when long; the whole of it is the title's tooltip. */
  title: string;
  details?: readonly ReportDetail[];
}

/** What holds a report on screen. Each one keeps it from fading until it is gone. */
export type ReportHold = 'hover' | 'focus' | 'expanded';

/** A report on screen, as the stack keeps it. */
export interface ReportEntry {
  spec: ReportSpec;
  /** When it was shown, or last replaced, in the clock the stack is driven with (ms). */
  shownAt: number;
  /** When it fades, or null while something holds it, or when it never fades. */
  deadline: number | null;
  readonly holds: Set<ReportHold>;
}

/** The most reports on screen at once. */
export const MAX_REPORT_TOASTS = 3;

/** The space kept between the stack and what it sits above, in CSS pixels. */
export const REPORT_GAP_PX = 8;

/** The stack's distance from the window's right edge, and from its bottom when nothing is in the way. */
export const REPORT_EDGE_PX = 16;

/** When an entry fades from `now`: never while held or when `seconds` is 0. */
function deadlineFor(entry: ReportEntry, now: number, seconds: number): number | null {
  return entry.holds.size > 0 || !(seconds > 0) ? null : now + seconds * 1000;
}

/**
 * The stack's rules, with time passed in. `seconds` is read at each call, so a
 * change to the setting reaches the next report shown and the next release of
 * one held, without anything on screen being re-timed behind the reader's back.
 */
export class ReportToastStack {
  /** Oldest first: the top of the stack on screen. */
  readonly entries: ReportEntry[] = [];

  /**
   * Shows a report. One with the same id is replaced where it stands, keeping
   * whatever holds it (its details stay open if they were); otherwise the new
   * one goes at the bottom, and past {@link MAX_REPORT_TOASTS} the oldest that
   * nothing holds is dropped - the oldest outright if every other one is held.
   */
  show(spec: ReportSpec, now: number, seconds: number): { entry: ReportEntry; replaced: boolean; dropped: ReportEntry | null } {
    const existing = this.entries.find((entry) => entry.spec.id === spec.id);
    if (existing) {
      existing.spec = spec;
      existing.shownAt = now;
      existing.deadline = deadlineFor(existing, now, seconds);
      return { entry: existing, replaced: true, dropped: null };
    }
    const entry: ReportEntry = { spec, shownAt: now, deadline: null, holds: new Set() };
    entry.deadline = deadlineFor(entry, now, seconds);
    this.entries.push(entry);
    let dropped: ReportEntry | null = null;
    if (this.entries.length > MAX_REPORT_TOASTS) {
      const free = this.entries.slice(0, -1).findIndex((other) => other.holds.size === 0);
      [dropped] = this.entries.splice(free >= 0 ? free : 0, 1);
    }
    return { entry, replaced: false, dropped };
  }

  /** Takes a report off the stack; null if none has that id. */
  close(id: string): ReportEntry | null {
    const at = this.entries.findIndex((entry) => entry.spec.id === id);
    return at < 0 ? null : this.entries.splice(at, 1)[0];
  }

  /**
   * Puts a hold on a report or takes one off. Only a change counts: taking off
   * a hold that was not there, or putting on one that was, leaves the timer
   * alone. When the last hold goes, the report gets its full time again.
   */
  hold(id: string, reason: ReportHold, on: boolean, now: number, seconds: number): void {
    const entry = this.entries.find((candidate) => candidate.spec.id === id);
    if (!entry || entry.holds.has(reason) === on) return;
    if (on) entry.holds.add(reason);
    else entry.holds.delete(reason);
    entry.deadline = deadlineFor(entry, now, seconds);
  }

  /** Takes off the stack every report whose time is up at `now`, oldest first. */
  expire(now: number): ReportEntry[] {
    const gone = this.entries.filter((entry) => entry.deadline !== null && entry.deadline <= now);
    for (const entry of gone) this.entries.splice(this.entries.indexOf(entry), 1);
    return gone;
  }

  /** The soonest a report fades, or null when none will. */
  nextDeadline(): number | null {
    let soonest: number | null = null;
    for (const entry of this.entries) {
      if (entry.deadline !== null && (soonest === null || entry.deadline < soonest)) soonest = entry.deadline;
    }
    return soonest;
  }
}

/**
 * How far above the window's bottom edge the stack sits, in CSS pixels: `gap`
 * clear of the highest thing in its way at the bottom of the window - the
 * status bar, and the nib indicator while it shows - or `edge` from the bottom
 * when nothing is. `obstacleTops` are those things' top edges in client
 * pixels; any that are not on screen are ignored.
 */
export function reportStackBottom(
  viewportHeight: number,
  obstacleTops: readonly number[],
  gap = REPORT_GAP_PX,
  edge = REPORT_EDGE_PX,
): number {
  const tops = obstacleTops.filter((top) => Number.isFinite(top) && top >= 0 && top < viewportHeight);
  if (tops.length === 0) return edge;
  return Math.max(edge, viewportHeight - Math.min(...tops) + gap);
}

/** A report on screen as a GUI check reads it; times in ms, `box` in client pixels. */
export interface ReportToastState {
  id: string;
  level: ReportLevel;
  title: string;
  details: { text: string; suggestion: string | null; action: string | null }[];
  expanded: boolean;
  holds: ReportHold[];
  age: number;
  remaining: number | null;
  box: { left: number; top: number; width: number; height: number };
}

/** What {@link ReportToasts} reads from the page around it. */
export interface ReportToastsOptions {
  /** How long a report stays, in seconds; 0 keeps it until it is closed. */
  seconds: () => number;
  /** What the stack keeps above. One that is hidden (`is-hidden`, or with no box) does not count. */
  obstacles: () => Iterable<Element | null>;
  /** The clock in ms; `performance.now` unless a test gives another. */
  now?: () => number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The few marks the icons are drawn with, on a 16-unit box. */
type IconPart = ['path', string, 'stroke' | 'fill'] | ['circle', number, number, number, 'stroke' | 'fill'];

const ICONS: Record<'info' | 'warning' | 'close' | 'chevron', IconPart[]> = {
  info: [
    ['circle', 8, 8, 6.5, 'stroke'],
    ['path', 'M8 7.2v4.3', 'stroke'],
    ['circle', 8, 4.9, 0.95, 'fill'],
  ],
  warning: [
    ['path', 'M8 1.8 14.8 13.8H1.2Z', 'stroke'],
    ['path', 'M8 6.2v3.9', 'stroke'],
    ['circle', 8, 11.9, 0.95, 'fill'],
  ],
  close: [['path', 'M4.5 4.5l7 7M11.5 4.5l-7 7', 'stroke']],
  chevron: [['path', 'M4.5 6.2 8 9.7l3.5-3.5', 'stroke']],
};

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const part of ICONS[name]) {
    const node = document.createElementNS(SVG_NS, part[0]);
    if (part[0] === 'path') node.setAttribute('d', part[1]);
    else {
      node.setAttribute('cx', String(part[1]));
      node.setAttribute('cy', String(part[2]));
      node.setAttribute('r', String(part[3]));
    }
    const paint = part[part.length - 1];
    if (paint === 'fill') node.setAttribute('fill', 'currentColor');
    else {
      node.setAttribute('fill', 'none');
      node.setAttribute('stroke', 'currentColor');
      node.setAttribute('stroke-width', '1.5');
      node.setAttribute('stroke-linecap', 'round');
      node.setAttribute('stroke-linejoin', 'round');
    }
    svg.appendChild(node);
  }
  return svg;
}

/** How long a report takes to fade out, with a margin over the stylesheet's `--motion` (160 ms). */
const LEAVE_MS = 220;

/**
 * The report toasts on the page. `host` is the empty `#report-toasts` column
 * in `index.html`; each report is drawn into it as a `.report-toast`.
 */
export class ReportToasts {
  private readonly stack = new ReportToastStack();
  private readonly nodes = new Map<string, HTMLElement>();
  private readonly now: () => number;
  private timer: number | null = null;
  private serial = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly options: ReportToastsOptions,
  ) {
    this.now = options.now ?? (() => performance.now());
    window.addEventListener('resize', () => this.place());
  }

  /** Shows a report, or replaces the one on screen with its id. */
  show(spec: ReportSpec): void {
    const { entry, replaced, dropped } = this.stack.show(spec, this.now(), this.options.seconds());
    if (dropped) this.unmount(dropped.spec.id);
    const node = replaced ? this.nodes.get(spec.id) : undefined;
    if (node) this.fill(node, entry);
    else this.mount(entry);
    this.place();
    this.schedule();
  }

  /** Closes a report now. */
  close(id: string): void {
    if (this.stack.close(id)) this.unmount(id);
    this.schedule();
  }

  /** Closes every report. */
  closeAll(): void {
    for (const entry of [...this.stack.entries]) this.close(entry.spec.id);
  }

  /**
   * Places the column again, clear of the status bar and the nib indicator.
   * Called on each show and on resize; the owner calls it when one of those
   * appears or goes.
   */
  place(): void {
    const tops: number[] = [];
    for (const node of this.options.obstacles()) {
      if (!node || node.classList.contains('is-hidden')) continue;
      const box = node.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) tops.push(box.top);
    }
    this.host.style.setProperty('--report-bottom', `${reportStackBottom(window.innerHeight, tops)}px`);
  }

  /** The reports on screen, top first, as a GUI check reads them. */
  describe(): ReportToastState[] {
    const now = this.now();
    return this.stack.entries.map((entry) => {
      const node = this.nodes.get(entry.spec.id);
      const box = node?.getBoundingClientRect();
      return {
        id: entry.spec.id,
        level: entry.spec.level ?? 'warning',
        title: entry.spec.title,
        details: Array.from(node?.querySelectorAll<HTMLElement>('.report-toast-row') ?? [], (row) => ({
          text: row.querySelector('.report-toast-text')?.textContent ?? '',
          suggestion: row.querySelector('.report-toast-suggestion')?.textContent ?? null,
          action: row.querySelector('.report-toast-action')?.textContent ?? null,
        })),
        expanded: entry.holds.has('expanded'),
        holds: [...entry.holds],
        age: now - entry.shownAt,
        remaining: entry.deadline === null ? null : entry.deadline - now,
        box: box ? { left: box.left, top: box.top, width: box.width, height: box.height } : { left: 0, top: 0, width: 0, height: 0 },
      };
    });
  }

  // ---- Drawing -------------------------------------------------------------

  private mount(entry: ReportEntry): void {
    const id = entry.spec.id;
    const node = document.createElement('section');
    node.className = 'report-toast is-entering';
    node.tabIndex = -1;
    node.dataset.reportId = id;
    this.fill(node, entry);

    const hold = (reason: ReportHold, on: boolean): void => {
      this.stack.hold(id, reason, on, this.now(), this.options.seconds());
      this.schedule();
    };
    node.addEventListener('pointerenter', () => hold('hover', true));
    node.addEventListener('pointerleave', () => hold('hover', false));
    // Only the keyboard's focus holds it. A click on Details leaves the focus
    // on that button too, and a report that a mouse had touched would then
    // never fade until something else was clicked; the pointer's own hold
    // already covers the time the mouse is on it.
    node.addEventListener('focusin', (ev) => {
      if (ev.target instanceof Element && ev.target.matches(':focus-visible')) hold('focus', true);
    });
    node.addEventListener('focusout', (ev) => {
      if (!(ev.relatedTarget instanceof Node && node.contains(ev.relatedTarget))) hold('focus', false);
    });
    // The report keeps the keys that mean something on it. Escape closes it;
    // Enter and Space press its focused button and nothing behind it - Enter
    // would open Move, and Space would start a pan.
    const ownKeys = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape' && ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.stopPropagation();
      if (ev.type === 'keydown' && ev.key === 'Escape') {
        ev.preventDefault();
        this.close(id);
      }
    };
    node.addEventListener('keydown', ownKeys);
    node.addEventListener('keyup', ownKeys);

    this.nodes.set(id, node);
    this.host.appendChild(node);
    // One frame as it was laid out, so the move into place is a transition.
    requestAnimationFrame(() => requestAnimationFrame(() => node.classList.remove('is-entering')));
  }

  /** Writes a report's content into its node: the level, the title, and the details, kept open if they were. */
  private fill(node: HTMLElement, entry: ReportEntry): void {
    const { spec } = entry;
    const level = spec.level ?? 'warning';
    const serial = ++this.serial;
    node.classList.toggle('is-warning', level === 'warning');
    node.classList.toggle('is-info', level === 'info');
    node.replaceChildren();

    const titleId = `report-toast-title-${serial}`;
    node.setAttribute('aria-labelledby', titleId);
    const head = document.createElement('div');
    head.className = 'report-toast-head';
    const mark = document.createElement('span');
    mark.className = 'report-toast-icon';
    mark.appendChild(icon(level));
    const title = document.createElement('p');
    title.className = 'report-toast-title';
    title.id = titleId;
    title.textContent = spec.title;
    title.title = spec.title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'report-toast-close';
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close (Esc)';
    close.appendChild(icon('close'));
    close.addEventListener('click', () => this.close(spec.id));
    head.append(mark, title, close);
    node.appendChild(head);

    const details = spec.details ?? [];
    if (details.length === 0) return;
    const listId = `report-toast-details-${serial}`;
    const expanded = entry.holds.has('expanded');
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'report-toast-more';
    more.setAttribute('aria-controls', listId);
    more.setAttribute('aria-expanded', String(expanded));
    const label = document.createElement('span');
    label.textContent = `Details (${details.length})`;
    more.append(label, icon('chevron'));
    const list = document.createElement('ul');
    list.className = 'report-toast-details';
    list.id = listId;
    list.hidden = !expanded;
    for (const detail of details) list.appendChild(this.row(detail));
    more.addEventListener('click', () => {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      list.hidden = !open;
      this.stack.hold(spec.id, 'expanded', open, this.now(), this.options.seconds());
      this.schedule();
    });
    node.append(more, list);
  }

  private row(detail: ReportDetail): HTMLLIElement {
    const row = document.createElement('li');
    row.className = 'report-toast-row';
    const text = document.createElement('span');
    text.className = 'report-toast-text';
    text.textContent = detail.text;
    row.appendChild(text);
    if (detail.suggestion) {
      const hint = document.createElement('span');
      hint.className = 'report-toast-suggestion';
      hint.textContent = detail.suggestion;
      row.appendChild(hint);
    }
    const action = detail.action;
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'report-toast-action';
      button.textContent = action.label;
      button.addEventListener('click', () => {
        const said = action.run();
        if (typeof said !== 'string') return;
        text.textContent = said;
        row.querySelector('.report-toast-suggestion')?.remove();
        button.remove();
        row.classList.add('is-done');
      });
      row.appendChild(button);
    }
    return row;
  }

  /** Takes a report's node off the page, fading it first. */
  private unmount(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.nodes.delete(id);
    delete node.dataset.reportId;
    // A report closed from the keyboard took the focus with it: hand it to the
    // page, so the next key goes where it would have gone before.
    if (node.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    node.classList.add('is-leaving');
    window.setTimeout(() => node.remove(), LEAVE_MS);
  }

  /** Sets the one timer the stack needs: for the soonest report to fade. */
  private schedule(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    const next = this.stack.nextDeadline();
    if (next === null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      for (const entry of this.stack.expire(this.now())) this.unmount(entry.spec.id);
      this.schedule();
    }, Math.max(0, next - this.now()));
  }
}
