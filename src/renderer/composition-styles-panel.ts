/**
 * The Composition Styles panel (View > Toggle Composition Styles Panel,
 * `Shift+F5`): the user's library of composition styles, each with a
 * thumbnail of the page in view as the style would make it. A click applies
 * a style - the page restyled by its layers' names, one undo step - and the
 * foot holds New (this page's named layers recorded as a style), Duplicate,
 * Delete, Import, Export and Edit, which act on the style chosen.
 *
 * Arrow keys choose a style without applying it; Enter applies the one
 * chosen, F2 or a double-click edits it, and Delete deletes it. The style last
 * applied to the page is marked Applied, in words as well as its border.
 *
 * The panel owns no page state and no files. The renderer gives it a view and
 * does what it asks.
 */

/** A style as the list shows it. */
export interface CompositionStyleItem {
  /** What the renderer knows the style by: its library file. */
  readonly id: string;
  readonly name: string;
  /** How many rules of each kind: `2 layer, 1 text rules`. */
  readonly summary: string;
  /** The page in view as the style would make it, as an image URL; null while it is drawn. */
  readonly thumbnail: string | null;
}

/** What the panel shows. */
export interface CompositionStylesView {
  readonly items: readonly CompositionStyleItem[];
  /** The style last applied to the page in view, when it is one of these. */
  readonly applied: string | null;
}

/** A button of the panel's foot. */
export type CompositionStylesCommand = 'new' | 'duplicate' | 'delete' | 'import' | 'export' | 'edit';

/** What the panel asks of the renderer. */
export interface CompositionStylesActions {
  /** A style clicked, or Enter on the one chosen: restyle the page in view with it. */
  apply(id: string): void;
  /** A button of the foot, a double-click or a key, on the style chosen when there is one. */
  command(command: CompositionStylesCommand, id: string | null): void;
}

/** The panel's parts, found by id, which a test holds `index.html` to. */
export const COMPOSITION_STYLES_PANEL_PARTS = [
  'composition-styles-list',
  'composition-styles-empty',
  'composition-styles-new',
  'composition-styles-duplicate',
  'composition-styles-delete',
  'composition-styles-import',
  'composition-styles-export',
  'composition-styles-edit',
] as const;

type Part = (typeof COMPOSITION_STYLES_PANEL_PARTS)[number];

/** The foot's buttons, by the command each runs, and whether it needs a style chosen. */
const FOOT: ReadonlyArray<{ part: Part; command: CompositionStylesCommand; needsChoice: boolean }> = [
  { part: 'composition-styles-new', command: 'new', needsChoice: false },
  { part: 'composition-styles-duplicate', command: 'duplicate', needsChoice: true },
  { part: 'composition-styles-delete', command: 'delete', needsChoice: true },
  { part: 'composition-styles-import', command: 'import', needsChoice: false },
  { part: 'composition-styles-export', command: 'export', needsChoice: true },
  { part: 'composition-styles-edit', command: 'edit', needsChoice: true },
];

export class CompositionStylesPanel {
  private view: CompositionStylesView = { items: [], applied: null };
  private chosen: string | null = null;
  /** The list as last drawn, less its thumbnails, as text: drawn again only when it changes, so the focus stays. */
  private drawn = '';
  private readonly parts: Record<Part, HTMLElement>;

  constructor(
    root: HTMLElement,
    private readonly actions: CompositionStylesActions,
  ) {
    const found = {} as Record<Part, HTMLElement>;
    for (const id of COMPOSITION_STYLES_PANEL_PARTS) {
      const node = root.querySelector<HTMLElement>(`#${id}`);
      if (!node) throw new Error(`The Composition Styles panel has no #${id}.`);
      found[id] = node;
    }
    this.parts = found;
    this.bind();
  }

  /** The style chosen, if any. */
  get choice(): string | null {
    return this.chosen;
  }

  /** Chooses a style, as a click or an arrow key does, without applying it; null chooses none. */
  choose(id: string | null): void {
    this.chosen = id !== null && this.view.items.some((item) => item.id === id) ? id : null;
    this.paintChoice();
  }

  /** Shows a view: the list drawn again when its styles changed, the thumbnails put in place either way. */
  render(view: CompositionStylesView): void {
    this.view = view;
    if (this.chosen !== null && !view.items.some((item) => item.id === this.chosen)) this.chosen = null;
    const key = JSON.stringify(view.items.map((item) => [item.id, item.name, item.summary]));
    if (key !== this.drawn) {
      this.drawn = key;
      this.draw();
    }
    this.paintThumbnails();
    this.paintChoice();
  }

  // ---- Drawing ---------------------------------------------------------------------------

  private draw(): void {
    const list = this.parts['composition-styles-list'];
    const rows = this.view.items.map((item) => {
      const row = document.createElement('div');
      row.className = 'composition-style-row';
      row.id = `composition-style-${cssId(item.id)}`;
      row.dataset.id = item.id;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.title = `Apply ${item.name}: restyle this page by its layers' names`;
      const picture = document.createElement('div');
      picture.className = 'composition-style-thumb';
      const image = document.createElement('img');
      image.alt = '';
      image.draggable = false;
      picture.append(image);
      const words = document.createElement('div');
      words.className = 'composition-style-words';
      const title = document.createElement('div');
      title.className = 'composition-style-title';
      const name = document.createElement('span');
      name.className = 'composition-style-name';
      name.textContent = item.name;
      const applied = document.createElement('span');
      applied.className = 'composition-style-applied';
      applied.textContent = 'Applied';
      title.append(name, applied);
      const summary = document.createElement('span');
      summary.className = 'composition-style-summary';
      summary.textContent = item.summary;
      words.append(title, summary);
      row.append(picture, words);
      return row;
    });
    list.replaceChildren(...rows);
    this.parts['composition-styles-empty'].classList.toggle('is-hidden', rows.length > 0);
    list.classList.toggle('is-hidden', rows.length === 0);
  }

  private paintThumbnails(): void {
    for (const item of this.view.items) {
      const row = this.rowOf(item.id);
      const image = row?.querySelector('img');
      if (!row || !image) continue;
      if (item.thumbnail) {
        if (image.getAttribute('src') !== item.thumbnail) image.src = item.thumbnail;
        row.classList.remove('is-drawing');
      } else {
        image.removeAttribute('src');
        row.classList.add('is-drawing');
      }
    }
  }

  private paintChoice(): void {
    const list = this.parts['composition-styles-list'];
    for (const row of list.querySelectorAll<HTMLElement>('.composition-style-row')) {
      const id = row.dataset.id ?? '';
      const chosen = id === this.chosen;
      const applied = id === this.view.applied;
      row.classList.toggle('is-chosen', chosen);
      row.classList.toggle('is-applied', applied);
      row.setAttribute('aria-selected', String(chosen));
    }
    const row = this.chosen !== null ? this.rowOf(this.chosen) : null;
    if (row) list.setAttribute('aria-activedescendant', row.id);
    else list.removeAttribute('aria-activedescendant');
    for (const { part, needsChoice } of FOOT) {
      (this.parts[part] as HTMLButtonElement).disabled = needsChoice && this.chosen === null;
    }
  }

  private rowOf(id: string): HTMLElement | null {
    return this.parts['composition-styles-list'].querySelector<HTMLElement>(`.composition-style-row[data-id="${CSS.escape(id)}"]`);
  }

  // ---- Input -----------------------------------------------------------------------------

  private bind(): void {
    const list = this.parts['composition-styles-list'];
    const rowAt = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>('.composition-style-row') : null);
    list.addEventListener('click', (e) => {
      const row = rowAt(e.target);
      const id = row?.dataset.id;
      if (!id) return;
      this.choose(id);
      list.focus();
      this.actions.apply(id);
    });
    list.addEventListener('dblclick', (e) => {
      const id = rowAt(e.target)?.dataset.id;
      if (id) this.actions.command('edit', id);
    });
    list.addEventListener('keydown', (e) => this.onKey(e));
    for (const { part, command } of FOOT) {
      this.parts[part].addEventListener('click', () => this.actions.command(command, this.chosen));
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const ids = this.view.items.map((item) => item.id);
    if (ids.length === 0) return;
    const at = this.chosen === null ? -1 : ids.indexOf(this.chosen);
    const move = (to: number): void => {
      const id = ids[Math.max(0, Math.min(ids.length - 1, to))];
      this.choose(id);
      this.rowOf(id)?.scrollIntoView({ block: 'nearest' });
    };
    switch (e.key) {
      case 'ArrowDown':
        move(at + 1);
        break;
      case 'ArrowUp':
        move(at < 0 ? ids.length - 1 : at - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(ids.length - 1);
        break;
      case 'Enter':
      case ' ':
        if (this.chosen === null) return;
        this.actions.apply(this.chosen);
        break;
      case 'F2':
        if (this.chosen === null) return;
        this.actions.command('edit', this.chosen);
        break;
      case 'Delete':
        if (this.chosen === null) return;
        this.actions.command('delete', this.chosen);
        break;
      default:
        return;
    }
    // The panel's own keys, not the window's shortcuts.
    e.preventDefault();
    e.stopPropagation();
  }
}

/** A library file name as an element id can hold it. */
function cssId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_');
}
