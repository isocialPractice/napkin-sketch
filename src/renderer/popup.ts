/**
 * Shared behaviour for the app's editing popups.
 *
 * Move, Rotate, Page Settings and Sharpen Selection are all the same kind of
 * thing: a small panel that edits what is on the canvas while the canvas stays
 * visible and usable underneath. Each one grew its own copy of "drag me by the
 * title", and the moment a second one appeared the copies started to differ -
 * so the behaviour lives here once and each popup says which parts it wants.
 *
 * Four capabilities, granted per popup:
 *
 * - **moveable** - dragged by its title or by the narrow band at its border.
 * - **resize** - pulled bigger or smaller from its own corner grip.
 * - **dockable** - parked into the side dock, where it becomes a column beside
 *   the layers and properties panels instead of floating over the drawing.
 * - **undockable** - taken back out of the dock to exactly where it floated
 *   before, which is what makes docking worth trying rather than a commitment.
 *
 * Docking reuses the workspace's own layout idiom rather than inventing one:
 * the panels either side of the stage are flex columns that collapse to zero
 * width, and a docked popup is one more of those. So a docked popup pushes the
 * canvas narrower instead of covering it, which is the whole point - a floating
 * palette is in the way exactly when the drawing under it is what is being
 * edited.
 *
 * The module owns no application state. It reads the same `is-hidden` class the
 * rest of the app already toggles to open and close a dialog, so nothing had to
 * change at the call sites to become dockable.
 */

/** What a popup is allowed to do. Everything defaults off except the two the floating palettes always had. */
export interface PopupCapabilities {
  /** Dragged by its title bar and its border. Default true. */
  moveable?: boolean;
  /** Resized from its bottom-right corner. Default true. */
  resize?: boolean;
  /**
   * Offered a dock button, which parks it in the side dock and takes it back
   * out again. Default false: a wizard step is moveable so it can be pushed
   * aside, but docking one would leave a step of a modal flow sitting in a
   * column with nothing to return to.
   */
  dockable?: boolean;
}

/** How far a placed panel must stay on screen, so it can always be grabbed again. */
const REACHABLE_PX = 64;

/** Width of the border band that drags the panel. Narrow on purpose - see {@link PopupManager}. */
const BORDER_BAND_PX = 3;

/** The bottom-right square the browser draws its own resize grip in. */
const RESIZE_GRIP_PX = 18;

/** A viewport, as the clamp sees it. Passed in rather than read, so the maths can be tested. */
export interface ViewportBox {
  width: number;
  height: number;
}

/**
 * Where a panel of `panelWidth` may sit, given where it was asked to go.
 *
 * A panel dragged off the edge cannot be dragged back, so enough of it is kept
 * within the viewport to grab: the title bar never goes above the top, and at
 * least {@link REACHABLE_PX} of its width stays inside either side. The top is
 * clamped to zero rather than to a negative offset for the same reason - the
 * title is the one part that has to remain hittable.
 *
 * Pure, and the only arithmetic in this module worth testing on its own.
 */
export function clampToViewport(
  left: number,
  top: number,
  panelWidth: number,
  viewport: ViewportBox,
): { left: number; top: number } {
  const maxLeft = viewport.width - REACHABLE_PX;
  const minLeft = REACHABLE_PX - panelWidth;
  const maxTop = viewport.height - REACHABLE_PX;
  return {
    left: Math.round(Math.max(minLeft, Math.min(left, maxLeft))),
    top: Math.round(Math.max(0, Math.min(top, maxTop))),
  };
}

/** Everything the manager tracks about one registered popup. */
interface PopupEntry {
  overlay: HTMLElement;
  panel: HTMLElement;
  caps: Required<PopupCapabilities>;
  docked: boolean;
  /** Where the panel floated before it was docked, so undocking puts it back. */
  floatingAt: { left: string; top: string; placed: boolean } | null;
}

export class PopupManager {
  private readonly entries = new Map<string, PopupEntry>();

  /**
   * The dock column. Created on first use rather than required in the markup,
   * so a page that registers no dockable popup grows no extra element.
   */
  private dockHost: HTMLElement | null = null;

  /**
   * Called whenever docking changes the width of the workspace. The canvas
   * sizes itself to its container, so it has to be told; nothing else in here
   * knows or cares what the callback does.
   */
  constructor(private readonly onLayoutChange: () => void = () => {}) {}

  /**
   * Gives a dialog the capabilities it asks for. Safe to call for an id that
   * is not in the document - a popup behind an optional feature simply does
   * not register - and safe to call twice, which the second call ignores.
   */
  register(dialogId: string, caps: PopupCapabilities = {}): void {
    if (this.entries.has(dialogId)) return;
    const overlay = document.getElementById(dialogId);
    const panel = overlay?.querySelector<HTMLElement>('.export-dialog-inner');
    if (!overlay || !panel) return;

    const resolved = {
      moveable: caps.moveable ?? true,
      resize: caps.resize ?? true,
      dockable: caps.dockable ?? false,
    };
    const entry: PopupEntry = { overlay, panel, caps: resolved, docked: false, floatingAt: null };
    this.entries.set(dialogId, entry);

    if (resolved.moveable) {
      overlay.classList.add('dialog-floating');
      this.attachDrag(entry);
    }
    if (resolved.resize) panel.classList.add('popup-resizable');
    if (resolved.dockable) this.attachDockButton(dialogId, entry);

    // A window that shrinks must not strand a placed panel off screen.
    window.addEventListener('resize', () => {
      if (!overlay.classList.contains('is-hidden')) this.clamp(dialogId);
    });

    // Opening and closing stays where it always was - a class on the overlay -
    // so watching that class is what keeps a docked panel in step without any
    // call site having to know it might be docked.
    if (resolved.dockable) {
      new MutationObserver(() => this.syncDock()).observe(overlay, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  }

  /** True once the panel has been dragged, and is therefore placed rather than centred. */
  isPlaced(dialogId: string): boolean {
    return this.entries.get(dialogId)?.overlay.classList.contains('is-placed') === true;
  }

  /** True while the panel is sitting in the side dock. */
  isDocked(dialogId: string): boolean {
    return this.entries.get(dialogId)?.docked === true;
  }

  /**
   * Puts a panel at a point outright, which is what an opener uses to park a
   * palette clear of the work. Ignored for a docked popup, whose position is
   * the dock's business.
   */
  park(dialogId: string, left: number, top: number): void {
    const entry = this.entries.get(dialogId);
    if (!entry || entry.docked) return;
    entry.overlay.classList.add('is-placed');
    this.place(entry.panel, left, top);
  }

  /** Pulls a placed panel back on screen, after a resize or before opening. */
  clamp(dialogId: string): void {
    const entry = this.entries.get(dialogId);
    if (!entry || entry.docked) return;
    if (!entry.overlay.classList.contains('is-placed')) return;
    this.place(entry.panel, parseFloat(entry.panel.style.left) || 0, parseFloat(entry.panel.style.top) || 0);
  }

  /**
   * Drops any half-finished drag on a popup. A dialog closed mid-drag - by
   * entering a mode that dismisses it, say - would otherwise leave the grab
   * cursor stuck on whatever was being held.
   */
  releaseGrabs(dialogId: string): void {
    const entry = this.entries.get(dialogId);
    if (!entry) return;
    for (const node of entry.overlay.querySelectorAll('.is-grabbing')) {
      node.classList.remove('is-grabbing');
    }
    entry.overlay.classList.remove('is-grabbing');
    entry.panel.classList.remove('on-border');
  }

  // ---- Moving --------------------------------------------------------------

  /**
   * Wires both drag handles: the title bar, and the narrow band at the panel's
   * border.
   *
   * The border is the handle rather than the whole padded ring, because the
   * ring is wide and grabbing it by accident is worse than having to aim. The
   * cursor follows the same test the drag does, so what looks grabbable is
   * exactly what is.
   */
  private attachDrag(entry: PopupEntry): void {
    const { panel } = entry;
    const title = panel.querySelector<HTMLElement>('.export-dialog-title');
    if (title) {
      // The dock button lives in the title bar, so a press on it is a press on
      // the button and not the start of a drag.
      this.attachDragHandle(entry, title, (ev) => !this.onDockButton(ev));
    }
    this.attachDragHandle(entry, panel, (ev) => this.onBorder(panel, ev));

    panel.addEventListener('pointermove', (ev) => {
      panel.classList.toggle('on-border', !entry.docked && this.onBorder(panel, ev));
    });
    panel.addEventListener('pointerleave', () => panel.classList.remove('on-border'));
  }

  /**
   * Makes one element drag a panel. `accepts` decides whether a given press on
   * it counts, which is what keeps the panel's contents out of it while its
   * border stays grabbable.
   */
  private attachDragHandle(
    entry: PopupEntry,
    handle: HTMLElement,
    accepts: (ev: PointerEvent) => boolean,
  ): void {
    const { overlay, panel } = entry;
    let from: { x: number; y: number; left: number; top: number } | null = null;

    handle.addEventListener('pointerdown', (ev) => {
      // A docked panel is positioned by the dock, not by a drag.
      if (entry.docked || !accepts(ev)) return;
      ev.preventDefault();
      const rect = panel.getBoundingClientRect();
      // Freeze where the flex box had it before switching to a placed panel,
      // so the drag starts from exactly where the panel already looks.
      overlay.classList.add('is-placed');
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      from = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
      handle.classList.add('is-grabbing');
      handle.setPointerCapture(ev.pointerId);
    });

    handle.addEventListener('pointermove', (ev) => {
      if (!from) return;
      this.place(panel, from.left + (ev.clientX - from.x), from.top + (ev.clientY - from.y));
    });

    const end = (ev: PointerEvent): void => {
      if (!from) return;
      from = null;
      handle.classList.remove('is-grabbing');
      if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  /** Applies {@link clampToViewport} against the live window. */
  private place(panel: HTMLElement, left: number, top: number): void {
    const at = clampToViewport(left, top, panel.offsetWidth, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    panel.style.left = `${at.left}px`;
    panel.style.top = `${at.top}px`;
  }

  /**
   * True within a few pixels of the panel's edge. The band is deliberately
   * narrow: a press further in belongs to whatever the panel is holding.
   */
  private onBorder(panel: HTMLElement, ev: PointerEvent): boolean {
    if (this.inResizeCorner(panel, ev)) return false;
    const r = panel.getBoundingClientRect();
    const withinX = ev.clientX >= r.left - BORDER_BAND_PX && ev.clientX <= r.right + BORDER_BAND_PX;
    const withinY = ev.clientY >= r.top - BORDER_BAND_PX && ev.clientY <= r.bottom + BORDER_BAND_PX;
    if (!withinX || !withinY) return false;
    const nearSide =
      Math.abs(ev.clientX - r.left) <= BORDER_BAND_PX ||
      Math.abs(ev.clientX - r.right) <= BORDER_BAND_PX;
    const nearCap =
      Math.abs(ev.clientY - r.top) <= BORDER_BAND_PX ||
      Math.abs(ev.clientY - r.bottom) <= BORDER_BAND_PX;
    return nearSide || nearCap;
  }

  /**
   * True near the panel's bottom-right corner, where the browser draws its own
   * resize grip. Starting a drag there would take the corner away from the
   * resizer, and resizing is what that corner is for.
   */
  private inResizeCorner(panel: HTMLElement, ev: PointerEvent): boolean {
    const rect = panel.getBoundingClientRect();
    return ev.clientX > rect.right - RESIZE_GRIP_PX && ev.clientY > rect.bottom - RESIZE_GRIP_PX;
  }

  // ---- Docking -------------------------------------------------------------

  /** True when the press landed on a dock button rather than on the title bar itself. */
  private onDockButton(ev: PointerEvent): boolean {
    return ev.target instanceof Element && ev.target.closest('.popup-dock-btn') !== null;
  }

  /** Adds the dock toggle to a popup's title bar. */
  private attachDockButton(dialogId: string, entry: PopupEntry): void {
    const title = entry.panel.querySelector<HTMLElement>('.export-dialog-title');
    if (!title) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'popup-dock-btn';
    title.appendChild(button);
    this.labelDockButton(button, false);
    button.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.toggleDock(dialogId);
    });
  }

  private labelDockButton(button: HTMLElement, docked: boolean): void {
    button.textContent = docked ? '↗' : '↙';
    button.title = docked
      ? 'Undock - float this panel over the drawing again'
      : 'Dock - park this panel beside the drawing instead of over it';
    button.setAttribute('aria-label', docked ? 'Undock panel' : 'Dock panel');
  }

  /** Docks a floating popup, or floats a docked one back where it was. */
  toggleDock(dialogId: string): void {
    const entry = this.entries.get(dialogId);
    if (!entry || !entry.caps.dockable) return;
    if (entry.docked) this.undock(entry);
    else this.dock(entry);
    const button = entry.panel.querySelector<HTMLElement>('.popup-dock-btn');
    if (button) this.labelDockButton(button, entry.docked);
    this.syncDock();
    this.onLayoutChange();
  }

  /**
   * Moves the panel out of its overlay and into the dock column.
   *
   * Where it floated is remembered first, because undocking that does not put
   * the panel back where it was is a worse experience than not docking at all:
   * the position was chosen, and losing it on a round trip makes the button
   * something to be careful with rather than something to try.
   */
  private dock(entry: PopupEntry): void {
    entry.floatingAt = {
      left: entry.panel.style.left,
      top: entry.panel.style.top,
      placed: entry.overlay.classList.contains('is-placed'),
    };
    // The panel leaves an empty overlay behind. That overlay still carries the
    // backdrop for the popups that have one, so it is neutralised while the
    // panel is elsewhere - a dimmed screen behind a docked panel would be a
    // modal with nothing in it.
    entry.overlay.classList.add('popup-docked-away');
    entry.panel.classList.add('popup-docked');
    entry.panel.classList.remove('on-border');
    entry.panel.style.left = '';
    entry.panel.style.top = '';
    // A resize grip wrote an inline width and height that only made sense
    // while floating; the dock column sets its own.
    entry.panel.style.width = '';
    entry.panel.style.height = '';
    this.ensureDockHost().appendChild(entry.panel);
    entry.docked = true;
  }

  /** Takes the panel back out of the dock, to exactly where it floated. */
  private undock(entry: PopupEntry): void {
    entry.overlay.appendChild(entry.panel);
    entry.overlay.classList.remove('popup-docked-away');
    entry.panel.classList.remove('popup-docked');
    entry.docked = false;
    const at = entry.floatingAt;
    entry.floatingAt = null;
    if (!at || !at.placed) {
      entry.overlay.classList.remove('is-placed');
      return;
    }
    entry.overlay.classList.add('is-placed');
    entry.panel.style.left = at.left;
    entry.panel.style.top = at.top;
  }

  /**
   * The dock column, created the first time something docks.
   *
   * It goes at the end of the workspace row, beside the layers and properties
   * panels, so a docked popup reads as one more panel rather than as a thing
   * stuck to the edge. The row is a flex box of `flex: 0 0 auto` columns, so
   * arriving there is all it takes to push the stage narrower.
   */
  private ensureDockHost(): HTMLElement {
    if (this.dockHost) return this.dockHost;
    const existing = document.getElementById('popup-dock');
    if (existing) {
      this.dockHost = existing;
      return existing;
    }
    const host = document.createElement('aside');
    host.id = 'popup-dock';
    host.className = 'popup-dock';
    host.setAttribute('aria-label', 'Docked panels');
    // The workspace row is the parent the side panels share; falling back to
    // the body keeps a stray call from throwing rather than from working.
    const row = document.getElementById('properties-panel')?.parentElement ?? document.body;
    row.appendChild(host);
    this.dockHost = host;
    return host;
  }

  /**
   * Shows the dock exactly when it holds a panel belonging to an open popup.
   *
   * A docked popup that is closed leaves its panel in the dock but hides it, so
   * reopening finds it still docked - the dock is a place the panel lives, not
   * a state it is in only while visible.
   */
  private syncDock(): void {
    const host = this.dockHost;
    if (!host) return;
    let anyOpen = false;
    for (const entry of this.entries.values()) {
      if (!entry.docked) continue;
      const open = !entry.overlay.classList.contains('is-hidden');
      entry.panel.classList.toggle('is-hidden', !open);
      if (open) anyOpen = true;
    }
    host.classList.toggle('is-open', anyOpen);
  }
}
