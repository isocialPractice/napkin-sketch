/**
 * The configuration popup: the one form the menu editors are drawn in.
 *
 * Edit Keyboard Shortcuts, Edit Tool Types and the session-history script ask
 * the same thing of a person: look down a list, find the rows that matter,
 * change a cell or two, then keep the changes or throw them away. So the form
 * is built once, here, and each editor describes its list in a
 * {@link ConfigDialogSpec}: the title and the line under it, the columns, the
 * rows, and what Accept does with them.
 *
 * Top to bottom: a search box that keeps the rows whose text contains what is
 * typed (`indexOf`, ignoring case); radio buttons that keep the rows of one
 * type; the table, in a bordered frame that scrolls on its own under headings
 * that stay put; a line that says what the last edit did; and Accept and
 * Cancel. A cell is words, a text box, a drop-down, a check box, or a
 * shortcut box that takes the next keypress as its chord.
 *
 * Edits are held by row, apart from the table, so a row that the search or a
 * filter hides keeps what was typed into it, and Accept hands back every row,
 * hidden or not, with its edits applied. The rows a spec passes in are never
 * changed.
 *
 * The popup is a form with an answer, so it keeps its keys: nothing typed
 * into it reaches the window's shortcuts, the menu bar's `Ctrl` chords are
 * held off while it is up, and `Tab` goes round its own controls. `Escape`
 * cancels and `Enter` in a field accepts.
 *
 * The pure parts ({@link filterRows}, {@link chordCellState},
 * {@link withEdit}, {@link applyEdits}) touch no DOM and are tested on their
 * own. {@link ConfigDialog} is the page's side of them.
 */

import { canonicalChord, chordFromEvent, displayChord, reservedReason } from '../core/menu/chords.js';
import { isNewTabKey, isReloadKey } from './keys.js';

// ---- What an editor describes ------------------------------------------------------

/** How a value stands: fine, fine but worth a second look, or not taken at all. */
export type CellLevel = 'ok' | 'warn' | 'refuse';

/** A column's word on a value put into one of its cells. */
export interface CellVerdict {
  readonly level: CellLevel;
  /** One sentence for the cell's tooltip and the line under the table. Empty when there is nothing to say. */
  readonly message: string;
}

/**
 * Judges a chord typed into a row's shortcut cell, given every row as edited
 * so far. The chord is canonical and is neither reserved nor malformed: the
 * popup refuses those before asking. Null means fine.
 */
export type KeyValidator<Row> = (row: Row, chord: string, rows: readonly Row[]) => CellVerdict | null;

interface ColumnBase<Row> {
  /** The heading over the column. */
  readonly heading: string;
  /** The row's property the cell shows and, when it can be edited, writes. */
  readonly field: keyof Row & string;
  /** The cell's tooltip. */
  readonly title?: (row: Row) => string | undefined;
  /** The column's width as CSS (`9rem`, `30%`). Columns without one share what is left. */
  readonly width?: string;
}

/**
 * Words, or a text box. Without `editable` the cell is the row's value as it
 * reads. With it, the cell is a text box, greyed for a row it returns false
 * for: a value shown as a form field that this row cannot change.
 */
export interface TextColumn<Row> extends ColumnBase<Row> {
  readonly kind: 'text';
  /**
   * What a words cell shows when it is not the field's own value, such as a
   * note that follows another cell. Read again after every edit to the row.
   */
  readonly format?: (row: Row) => string;
  readonly editable?: (row: Row) => boolean;
}

/** One choice in a drop-down. */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

/** A labelled group of choices, drawn as an `<optgroup>`. */
export interface SelectGroup {
  readonly label: string;
  readonly options: readonly SelectOption[];
}

/** A drop-down: plain choices first, then grouped ones. The field holds the chosen value. */
export interface SelectColumn<Row> extends ColumnBase<Row> {
  readonly kind: 'select';
  /** Choices ahead of the groups, belonging to none of them: a "none", say. */
  readonly options?: readonly SelectOption[];
  readonly optgroups: readonly SelectGroup[];
  readonly disabled?: (row: Row) => boolean;
  /**
   * What choosing a value would do, given every row as edited so far. The
   * verdict is coloured on the cell and said under the table as a shortcut
   * cell's is, and its message is the cell's tooltip. A refusal puts the
   * cell back as it was. Null means nothing to say.
   */
  readonly validate?: (row: Row, value: string, rows: readonly Row[]) => CellVerdict | null;
}

/**
 * A keyboard shortcut. The cell takes the next keypress as its chord. `Tab`
 * still moves on, and `Escape` puts back what the cell held when it took the
 * focus, then leaves it. The button beside the cell takes the shortcut away.
 * The field holds the canonical chord, or null for none.
 */
export interface KeyColumn<Row> extends ColumnBase<Row> {
  readonly kind: 'key';
  readonly validate?: KeyValidator<Row>;
  readonly disabled?: (row: Row) => boolean;
}

/** A check box. The field holds a boolean. */
export interface CheckColumn<Row> extends ColumnBase<Row> {
  readonly kind: 'check';
  readonly disabled?: (row: Row) => boolean;
}

export type ColumnSpec<Row> = TextColumn<Row> | SelectColumn<Row> | KeyColumn<Row> | CheckColumn<Row>;

/** A radio button over the table, keeping the rows its test passes. */
export interface RowFilter<Row> {
  readonly label: string;
  readonly test: (row: Row) => boolean;
}

/** A button beside Accept and Cancel, such as Reset to defaults. */
export interface ExtraButton {
  readonly label: string;
  readonly title?: string;
  /** May call the popup's own `cancel`, `setRows` or `say`. A throw is shown under the table. */
  readonly onClick: () => void | Promise<void>;
}

/** Everything an editor tells the popup. Rows are plain objects; an edit makes a copy with the cell's field replaced. */
export interface ConfigDialogSpec<Row> {
  /** The popup's title: `Edit Keyboard Shortcuts`. */
  readonly title: string;
  /** One line under the title. */
  readonly hint?: string;
  /** A bar across the top of the table's frame: `History Limit : 500`. */
  readonly header?: string;
  /** The search box, and the text of a row it looks in. */
  readonly search?: { readonly placeholder: string; readonly text: (row: Row) => string };
  /** The radio buttons after All, which always comes first and keeps every row. */
  readonly filters?: readonly RowFilter<Row>[];
  readonly columns: readonly ColumnSpec<Row>[];
  readonly rows: readonly Row[];
  /** Names a row in its controls' accessible names and in the line under the table. Default: its first text column. */
  readonly rowLabel?: (row: Row) => string;
  /** Said in the table when the search and the filter leave no rows. */
  readonly empty?: string;
  /**
   * `onAccept` gets every row with its edits, hidden rows too. The popup
   * closes once it returns. When it throws, the popup stays open and shows
   * the error's message under the table.
   */
  readonly accept: { readonly label?: string; readonly onAccept: (rows: Row[]) => void | Promise<void> };
  readonly cancel?: { readonly label?: string; readonly onCancel?: () => void };
  readonly extra?: readonly ExtraButton[];
}

// ---- The pure parts ---------------------------------------------------------------------

/** True when `text` contains `query`, ignoring case and the query's outer spaces. An empty query is in everything. */
export function matchesSearch(text: string, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  return wanted === '' || text.toLowerCase().indexOf(wanted) !== -1;
}

/** What decides which rows are in view. */
export interface RowView<Row> {
  /** The search box's text. */
  readonly query?: string;
  /** The text of a row the search looks in. Without it the search keeps every row. */
  readonly text?: (row: Row) => string;
  /** The ticked filter's test. Without it (All) every row passes. */
  readonly test?: (row: Row) => boolean;
}

/** The indices of the rows the search and the filter leave in view, in order. */
export function filterRows<Row>(rows: readonly Row[], view: RowView<Row>): number[] {
  const shown: number[] = [];
  rows.forEach((row, index) => {
    if (view.test && !view.test(row)) return;
    if (view.text && view.query !== undefined && !matchesSearch(view.text(row), view.query)) return;
    shown.push(index);
  });
  return shown;
}

/**
 * What a shortcut cell says about a chord for its row. No chord at all is
 * fine. Text that is no chord is refused, and so is a key the app keeps for
 * itself ({@link reservedReason}). Otherwise the column's own validator
 * decides, and its silence means fine.
 */
export function chordCellState<Row>(
  row: Row,
  chord: string | null,
  rows: readonly Row[],
  validate?: KeyValidator<Row>,
): CellVerdict {
  if (chord === null || chord.trim() === '') return { level: 'ok', message: 'No shortcut' };
  const canonical = canonicalChord(chord);
  if (canonical === null) return { level: 'refuse', message: `${chord} is not a keyboard shortcut` };
  const reserved = reservedReason(canonical);
  if (reserved !== null) return { level: 'refuse', message: `${reserved}, so it cannot be a shortcut` };
  return validate?.(row, canonical, rows) ?? { level: 'ok', message: '' };
}

/**
 * The edits once one cell changes. A value that is the row's own again is no
 * edit, so a cell changed and changed back leaves nothing behind, and a row
 * with no edits left drops out.
 */
export function withEdit<Row, K extends keyof Row>(
  edits: ReadonlyMap<number, Partial<Row>>,
  rows: readonly Row[],
  index: number,
  field: K,
  value: Row[K],
): Map<number, Partial<Row>> {
  const next = new Map(edits);
  const edit: Partial<Row> = { ...next.get(index) };
  if (Object.is(rows[index][field], value)) delete edit[field];
  else edit[field] = value;
  if (Object.keys(edit).length === 0) next.delete(index);
  else next.set(index, edit);
  return next;
}

/** Every row with its edits applied, as new objects. A row without edits is passed through as it is. */
export function applyEdits<Row>(rows: readonly Row[], edits: ReadonlyMap<number, Partial<Row>>): Row[] {
  return rows.map((row, index) => {
    const edit = edits.get(index);
    return edit === undefined ? row : { ...row, ...edit };
  });
}

// ---- The popup ---------------------------------------------------------------------------

/** How the popup reads chords: with `Cmd` and `Option` on a Mac. */
export interface ConfigDialogOptions {
  readonly mac?: boolean;
}

type AnyRow = Record<string, unknown>;

/** One opening of the popup. */
interface Session {
  readonly spec: ConfigDialogSpec<AnyRow>;
  rows: AnyRow[];
  edits: Map<number, Partial<AnyRow>>;
  /** Each row's table row, by index. */
  lines: HTMLTableRowElement[];
  /** The ticked filter, as an index into the spec's filters; -1 for All. */
  filter: number;
  /** True while Accept is at work, when nothing else may start. */
  busy: boolean;
  /** What a shortcut cell held when it took the focus, for `Escape` to put back. */
  keyAtFocus: { index: number; column: number; value: unknown } | null;
  /** What had the focus before the popup opened, given it back on close. */
  readonly returnFocus: Element | null;
}

/**
 * The `Ctrl` chords a text box keeps for its own editing: select, copy, cut,
 * paste, and moving or deleting a word at a time. Every other `Ctrl` or `Alt`
 * chord is held off the menu bar while the popup is up, so Undo, Open or New
 * cannot act on the drawing behind a form that is still asking a question.
 */
const EDITING_KEYS = new Set([
  'a',
  'c',
  'v',
  'x',
  'arrowleft',
  'arrowright',
  'arrowup',
  'arrowdown',
  'home',
  'end',
  'backspace',
  'delete',
]);

/**
 * The classes the popup finds the parts of its skeleton in `index.html` by.
 * A missing one would stop the page from starting, so a test holds the
 * skeleton to this list.
 */
export const CONFIG_DIALOG_PARTS = [
  'export-dialog-inner',
  'config-title',
  'config-hint',
  'config-find',
  'config-search',
  'config-filters',
  'config-grid',
  'config-header',
  'config-table',
  'config-empty',
  'config-status',
  'config-extra',
  'config-accept',
  'config-cancel',
] as const;

type ConfigDialogPart = (typeof CONFIG_DIALOG_PARTS)[number];

/** The tooltip of a shortcut cell with nothing to report. */
const KEY_CELL_TIP = 'Click here, then press the keys for the shortcut';

const CLEAR_MARK = String.fromCharCode(0xd7);

/** A text box a person types into, as opposed to the shortcut boxes, which are read-only. */
function isTypingField(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'search') && !target.readOnly;
}

/** A form field Enter accepts from: any input but a button, or a drop-down. Buttons answer Enter themselves. */
function acceptsOnEnter(target: EventTarget | null): boolean {
  if (target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && target.type !== 'button' && target.type !== 'submit';
}

function keptForEditing(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && EDITING_KEYS.has(e.key.toLowerCase()) && isTypingField(e.target);
}

function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function chordOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The page's side of the popup, over the `#config-dialog` skeleton in
 * `index.html`. Built once; each {@link open} fills it from a spec.
 */
export class ConfigDialog {
  private session: Session | null = null;
  private readonly root: HTMLElement;
  private readonly options: ConfigDialogOptions;
  private readonly panel: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly find: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly filters: HTMLElement;
  private readonly header: HTMLElement;
  private readonly tableBox: HTMLElement;
  private readonly headRow: HTMLTableRowElement;
  private readonly body: HTMLTableSectionElement;
  private readonly empty: HTMLElement;
  private readonly status: HTMLElement;
  private readonly extra: HTMLElement;
  private readonly acceptButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;

  constructor(root: HTMLElement, options: ConfigDialogOptions = {}) {
    this.root = root;
    this.options = options;
    const part = <T extends HTMLElement>(name: ConfigDialogPart): T => {
      const found = root.querySelector<T>(`.${name}`);
      if (!found) throw new Error(`The configuration popup has no .${name}.`);
      return found;
    };
    this.panel = part('export-dialog-inner');
    this.heading = part('config-title');
    this.hint = part('config-hint');
    this.find = part('config-find');
    this.search = part<HTMLInputElement>('config-search');
    this.filters = part('config-filters');
    this.header = part('config-header');
    this.tableBox = part('config-table');
    const grid = part<HTMLTableElement>('config-grid');
    const headRow = grid.tHead?.rows[0];
    const body = grid.tBodies[0];
    if (!headRow || !body) throw new Error('The configuration popup table needs a heading row and a body.');
    this.headRow = headRow;
    this.body = body;
    this.empty = part('config-empty');
    this.status = part('config-status');
    this.extra = part('config-extra');
    this.acceptButton = part<HTMLButtonElement>('config-accept');
    this.cancelButton = part<HTMLButtonElement>('config-cancel');
    this.bind();
  }

  /** True while the popup is up. */
  get isOpen(): boolean {
    return this.session !== null;
  }

  /**
   * Fills the popup from `spec` and shows it, with the focus in the search
   * box. False, and nothing changes, when it is already up for another list:
   * the edits there are not thrown away for a second opening.
   */
  open<Row extends object>(spec: ConfigDialogSpec<Row>): boolean {
    if (this.session !== null) return false;
    const erased = spec as unknown as ConfigDialogSpec<AnyRow>;
    this.session = {
      spec: erased,
      rows: [...erased.rows],
      edits: new Map(),
      lines: [],
      filter: -1,
      busy: false,
      keyAtFocus: null,
      returnFocus: document.activeElement,
    };
    this.heading.textContent = spec.title;
    this.fill(this.hint, spec.hint);
    this.fill(this.header, spec.header);
    this.search.value = '';
    this.search.placeholder = spec.search?.placeholder ?? '';
    this.search.setAttribute('aria-label', spec.search?.placeholder ?? 'Search');
    this.search.classList.toggle('is-hidden', !spec.search);
    this.buildFilters();
    this.find.classList.toggle('is-hidden', !spec.search && (spec.filters?.length ?? 0) === 0);
    this.headRow.replaceChildren(...erased.columns.map((column) => this.headingCell(column)));
    this.buildLines();
    this.applyView();
    this.acceptButton.textContent = spec.accept.label ?? 'Accept';
    this.cancelButton.textContent = spec.cancel?.label ?? 'Cancel';
    this.extra.replaceChildren(...(spec.extra ?? []).map((button) => this.extraButton(button)));
    this.say('');
    this.setBusy(false);
    this.root.classList.remove('is-hidden');
    this.tableBox.scrollTop = 0;
    this.firstStop()?.focus();
    return true;
  }

  /**
   * Hands every row, with its edits, to the spec's Accept, then closes. A
   * throw keeps the popup open with the message under the table.
   */
  async accept(): Promise<void> {
    const s = this.session;
    if (!s || s.busy) return;
    this.setBusy(true);
    try {
      await s.spec.accept.onAccept(applyEdits(s.rows, s.edits));
    } catch (err) {
      if (this.session === s) {
        this.setBusy(false);
        this.say(messageOf(err), 'refuse');
        this.acceptButton.focus();
      }
      return;
    }
    if (this.session === s) this.close();
  }

  /** Closes without keeping an edit, and tells the spec. */
  cancel(): void {
    const s = this.session;
    if (!s || s.busy) return;
    this.close();
    s.spec.cancel?.onCancel?.();
  }

  /**
   * Puts new rows in the table. By default they replace the rows the popup
   * opened with, and every edit goes. With `asEdits`, the rows the popup
   * opened with stay what the table is compared with, and each value in
   * `rows` that differs from them becomes an edit, coloured as one and
   * handed to Accept like one: how Reset to defaults shows what it would
   * change before anything is kept. `rows` must then be the same rows, in
   * the same order.
   */
  setRows<Row extends object>(rows: readonly Row[], options: { readonly asEdits?: boolean } = {}): void {
    const s = this.session;
    if (!s) return;
    const next = rows as unknown as readonly AnyRow[];
    s.keyAtFocus = null;
    if (options.asEdits) {
      if (next.length !== s.rows.length) throw new Error('setRows: asEdits needs the same rows the popup opened with.');
      let edits = new Map<number, Partial<AnyRow>>();
      next.forEach((row, index) => {
        for (const field of Object.keys(row)) edits = withEdit(edits, s.rows, index, field, row[field]);
      });
      s.edits = edits;
      s.lines.forEach((_, index) => this.renderLine(index));
      this.renderStates();
    } else {
      s.rows = [...next];
      s.edits = new Map();
      this.buildLines();
    }
    this.applyView();
  }

  /** Says one sentence on the line under the table, coloured by `level`; an empty one clears it. */
  say(message: string, level: CellLevel | null = null): void {
    this.status.textContent = message;
    for (const each of ['ok', 'warn', 'refuse'] as const) this.status.classList.toggle(`is-${each}`, level === each);
  }

  /**
   * A key that reached the window while the popup is up, the focus having
   * gone somewhere outside it. It runs nothing behind the popup; Escape still
   * cancels.
   */
  strayKey(e: KeyboardEvent): void {
    if (!this.session) return;
    if (e.ctrlKey || e.metaKey || e.altKey || isReloadKey(e) || isNewTabKey(e)) e.preventDefault();
    if (e.key === 'Escape') {
      e.preventDefault();
      this.cancel();
    }
  }

  // ---- Building ------------------------------------------------------------------------

  private bind(): void {
    this.root.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.search.addEventListener('input', () => this.applyView());
    this.filters.addEventListener('change', (e) => {
      const s = this.session;
      if (!s || !(e.target instanceof HTMLInputElement)) return;
      s.filter = Number(e.target.value);
      this.applyView();
    });
    this.body.addEventListener('input', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.classList.contains('config-input')) {
        this.editFrom(e.target, e.target.value);
      }
    });
    this.body.addEventListener('change', (e) => {
      if (e.target instanceof HTMLSelectElement) this.choose(e.target);
      else if (e.target instanceof HTMLInputElement && e.target.type === 'checkbox') this.editFrom(e.target, e.target.checked);
    });
    this.body.addEventListener('click', (e) => {
      const button = e.target instanceof Element ? e.target.closest('.config-key-clear') : null;
      if (button instanceof HTMLButtonElement) this.clearKey(button);
    });
    this.body.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.classList.contains('config-key-input')) {
        this.onKeyCell(e, e.target);
      }
    });
    this.body.addEventListener('focusin', (e) => {
      const s = this.session;
      if (!s || !(e.target instanceof HTMLInputElement) || !e.target.classList.contains('config-key-input')) return;
      const at = this.cellOf(e.target);
      if (at) s.keyAtFocus = { ...at, value: this.rowAt(at.index)[s.spec.columns[at.column].field] };
    });
    // A refused chord is shown only while its cell has the focus.
    this.body.addEventListener('focusout', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.classList.contains('config-key-input')) this.renderStates();
    });
    this.acceptButton.addEventListener('click', () => void this.accept());
    this.cancelButton.addEventListener('click', () => this.cancel());
  }

  private fill(node: HTMLElement, text: string | undefined): void {
    node.textContent = text ?? '';
    node.classList.toggle('is-hidden', !text);
  }

  private buildFilters(): void {
    const s = this.session;
    if (!s) return;
    const filters = s.spec.filters ?? [];
    const choices = [{ label: 'All', value: -1 }, ...filters.map((filter, index) => ({ label: filter.label, value: index }))];
    this.filters.replaceChildren(
      ...choices.map(({ label, value }) => {
        const holder = document.createElement('label');
        holder.className = 'config-filter';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'config-filter';
        radio.value = String(value);
        radio.checked = value === -1;
        holder.append(radio, document.createTextNode(label));
        return holder;
      }),
    );
    this.filters.classList.toggle('is-hidden', filters.length === 0);
  }

  private headingCell(column: ColumnSpec<AnyRow>): HTMLTableCellElement {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.className = `config-col-${column.kind}`;
    cell.textContent = column.heading;
    if (column.width) cell.style.width = column.width;
    return cell;
  }

  private buildLines(): void {
    const s = this.session;
    if (!s) return;
    const lines = document.createDocumentFragment();
    s.lines = s.rows.map((row, index) => {
      const line = document.createElement('tr');
      line.dataset.row = String(index);
      const name = this.rowName(row, index);
      s.spec.columns.forEach((column, c) => line.append(this.buildCell(column, c, name)));
      lines.append(line);
      return line;
    });
    this.body.replaceChildren(lines);
    s.lines.forEach((_, index) => this.renderLine(index));
    this.renderStates();
  }

  private buildCell(column: ColumnSpec<AnyRow>, c: number, name: string): HTMLTableCellElement {
    const cell = document.createElement('td');
    cell.className = `config-cell config-cell-${column.kind}`;
    // A column with no heading (the history's check boxes) names its controls by the row alone.
    const label = column.heading ? `${column.heading}: ${name}` : name;
    const control = <K extends 'input' | 'select' | 'button'>(tag: K, className: string): HTMLElementTagNameMap[K] => {
      const node = document.createElement(tag);
      node.className = className;
      node.dataset.col = String(c);
      node.setAttribute('aria-label', label);
      return node;
    };
    switch (column.kind) {
      case 'text': {
        if (column.editable) {
          const input = control('input', 'config-input');
          input.type = 'text';
          input.spellcheck = false;
          input.autocomplete = 'off';
          cell.append(input);
        } else {
          const words = document.createElement('span');
          words.className = 'config-text';
          cell.append(words);
        }
        break;
      }
      case 'select': {
        const select = control('select', 'config-select');
        for (const option of column.options ?? []) {
          const choice = document.createElement('option');
          choice.value = option.value;
          choice.textContent = option.label;
          select.append(choice);
        }
        for (const group of column.optgroups) {
          const holder = document.createElement('optgroup');
          holder.label = group.label;
          for (const option of group.options) {
            const choice = document.createElement('option');
            choice.value = option.value;
            choice.textContent = option.label;
            holder.append(choice);
          }
          select.append(holder);
        }
        cell.append(select);
        break;
      }
      case 'key': {
        const box = document.createElement('span');
        box.className = 'config-key';
        const input = control('input', 'config-key-input');
        input.type = 'text';
        input.readOnly = true;
        input.spellcheck = false;
        input.autocomplete = 'off';
        const clear = control('button', 'config-key-clear');
        clear.type = 'button';
        clear.textContent = CLEAR_MARK;
        clear.title = 'Remove the shortcut';
        clear.setAttribute('aria-label', `Remove the shortcut: ${name}`);
        box.append(input, clear);
        cell.append(box);
        break;
      }
      case 'check': {
        const check = control('input', 'config-check');
        check.type = 'checkbox';
        cell.append(check);
        break;
      }
    }
    return cell;
  }

  private extraButton(spec: ExtraButton): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-ghost config-extra-button';
    button.textContent = spec.label;
    if (spec.title) button.title = spec.title;
    button.addEventListener('click', () => void this.runExtra(spec));
    return button;
  }

  private async runExtra(spec: ExtraButton): Promise<void> {
    const s = this.session;
    if (!s || s.busy) return;
    try {
      await spec.onClick();
    } catch (err) {
      if (this.session === s) this.say(messageOf(err), 'refuse');
    }
  }

  // ---- Showing ---------------------------------------------------------------------------

  /** A row as edited so far. */
  private rowAt(index: number): AnyRow {
    const s = this.session;
    if (!s) return {};
    const edit = s.edits.get(index);
    return edit === undefined ? s.rows[index] : { ...s.rows[index], ...edit };
  }

  /** What a row is called: the spec's `rowLabel`, else its first text column. */
  private rowName(row: AnyRow, index: number): string {
    const s = this.session;
    const named = s?.spec.rowLabel?.(row);
    if (named) return named;
    const first = s?.spec.columns.find((column): column is TextColumn<AnyRow> => column.kind === 'text');
    const text = first ? (first.format ? first.format(row) : textOf(row[first.field])) : '';
    return text || `Row ${index + 1}`;
  }

  /** Brings every cell of a row up to date, leaving alone a text box being typed in. */
  private renderLine(index: number): void {
    const s = this.session;
    const line = s?.lines[index];
    if (!s || !line) return;
    const row = this.rowAt(index);
    s.spec.columns.forEach((column, c) => {
      const cell = line.cells[c];
      if (cell) this.renderCell(cell, row, column);
    });
  }

  private renderCell(cell: HTMLTableCellElement, row: AnyRow, column: ColumnSpec<AnyRow>): void {
    const tip = column.title?.(row);
    switch (column.kind) {
      case 'text': {
        const text = column.format ? column.format(row) : textOf(row[column.field]);
        const input = cell.querySelector<HTMLInputElement>('.config-input');
        if (input) {
          if (document.activeElement !== input) input.value = text;
          input.disabled = column.editable?.(row) === false;
          input.title = tip ?? '';
        } else {
          const words = cell.querySelector('.config-text');
          if (words) words.textContent = text;
          cell.title = tip ?? '';
        }
        break;
      }
      case 'select': {
        const select = cell.querySelector('select');
        if (!select) break;
        const value = textOf(row[column.field]);
        // A value none of the groups offers (a hand-edited file, say) is still
        // shown as it is, rather than as a blank the next Accept would lose.
        const offered = Array.from(select.options).some((option) => option.value === value);
        if (!offered && value !== '') {
          const stray = document.createElement('option');
          stray.value = value;
          stray.textContent = value;
          select.append(stray);
        }
        select.value = value;
        select.disabled = column.disabled?.(row) === true;
        // A judged drop-down's tooltip is its verdict, written with its colour.
        if (!column.validate) select.title = tip ?? '';
        break;
      }
      case 'key': {
        const input = cell.querySelector<HTMLInputElement>('.config-key-input');
        const clear = cell.querySelector<HTMLButtonElement>('.config-key-clear');
        if (!input || !clear) break;
        const chord = chordOf(row[column.field]);
        input.value = chord === null ? '' : displayChord(chord, { mac: this.options.mac });
        input.disabled = column.disabled?.(row) === true;
        clear.disabled = input.disabled || chord === null;
        break;
      }
      case 'check': {
        const check = cell.querySelector<HTMLInputElement>('.config-check');
        if (!check) break;
        check.checked = row[column.field] === true;
        check.disabled = column.disabled?.(row) === true;
        check.title = tip ?? '';
        break;
      }
    }
  }

  /**
   * Colours every shortcut cell, and every drop-down that judges its choice,
   * by its verdict against the rows as edited so far, since one edit can free
   * a chord another row was warned about. A warning or a refusal shows on any
   * row; fine shows only on a cell that was changed, so a list nobody has
   * touched is not a wall of green. A drop-down's verdict is its tooltip
   * either way: where a choice puts a row is worth reading before changing it.
   */
  private renderStates(): void {
    const s = this.session;
    if (!s) return;
    const current = applyEdits(s.rows, s.edits);
    s.spec.columns.forEach((column, c) => {
      if (column.kind !== 'key' && !(column.kind === 'select' && column.validate)) return;
      const selector = column.kind === 'key' ? '.config-key-input' : '.config-select';
      current.forEach((row, index) => {
        const control = s.lines[index]?.cells[c]?.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
        if (!control) return;
        const tip = column.title?.(row);
        if (control.disabled) {
          this.mark(control, null, tip ?? '');
          return;
        }
        const edit = s.edits.get(index);
        const edited = edit !== undefined && column.field in edit;
        const verdict = this.verdictOf(column, row, current);
        const level = verdict.level === 'ok' && !edited ? null : verdict.level;
        if (column.kind === 'key') {
          this.mark(control, level, level !== null && verdict.message ? verdict.message : tip ?? KEY_CELL_TIP);
        } else {
          this.mark(control, level, verdict.message || tip || '');
        }
      });
    });
  }

  /** A cell's verdict on the value it holds, from its column's own judge. */
  private verdictOf(column: ColumnSpec<AnyRow>, row: AnyRow, rows: readonly AnyRow[]): CellVerdict {
    if (column.kind === 'key') return chordCellState(row, chordOf(row[column.field]), rows, column.validate);
    if (column.kind === 'select') return column.validate?.(row, textOf(row[column.field]), rows) ?? { level: 'ok', message: '' };
    return { level: 'ok', message: '' };
  }

  private mark(control: HTMLElement, level: CellLevel | null, title: string): void {
    for (const each of ['ok', 'warn', 'refuse'] as const) control.classList.toggle(`is-${each}`, level === each);
    control.title = title;
  }

  /** Shows the rows the search and the ticked filter keep; the rest are hidden with their edits intact. */
  private applyView(): void {
    const s = this.session;
    if (!s) return;
    const filter = s.filter >= 0 ? s.spec.filters?.[s.filter] : undefined;
    const shown = new Set(
      filterRows(applyEdits(s.rows, s.edits), {
        query: this.search.value,
        text: s.spec.search?.text,
        test: filter?.test,
      }),
    );
    s.lines.forEach((line, index) => {
      line.hidden = !shown.has(index);
    });
    this.empty.textContent = s.spec.empty ?? 'No rows match.';
    this.empty.classList.toggle('is-hidden', shown.size > 0);
  }

  private setBusy(on: boolean): void {
    if (this.session) this.session.busy = on;
    this.root.setAttribute('aria-busy', String(on));
    this.acceptButton.disabled = on;
    this.cancelButton.disabled = on;
    this.find.inert = on;
    this.tableBox.inert = on;
  }

  private close(): void {
    const s = this.session;
    if (!s) return;
    this.setBusy(false);
    this.session = null;
    this.root.classList.add('is-hidden');
    const back = s.returnFocus;
    if (back instanceof HTMLElement && back.isConnected && back !== document.body && !this.root.contains(back)) {
      back.focus();
    } else if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  // ---- Editing ---------------------------------------------------------------------------

  private cellOf(control: HTMLElement): { index: number; column: number } | null {
    const line = control.closest('tr');
    const index = Number(line?.dataset.row);
    const column = Number(control.dataset.col);
    if (!line || !Number.isInteger(index) || !Number.isInteger(column)) return null;
    return { index, column };
  }

  /**
   * A choice in a drop-down. With a judge, the choice is judged first: a
   * refusal puts the drop-down back and says why, and anything else is kept
   * and said under the table.
   */
  private choose(select: HTMLSelectElement): void {
    const s = this.session;
    const at = this.cellOf(select);
    if (!s || !at) return;
    const column = s.spec.columns[at.column];
    if (column.kind !== 'select' || !column.validate) {
      this.edit(at.index, at.column, select.value);
      return;
    }
    const before = this.rowAt(at.index);
    const verdict = column.validate(before, select.value, applyEdits(s.rows, s.edits)) ?? { level: 'ok', message: '' };
    if (verdict.level === 'refuse') {
      select.value = textOf(before[column.field]);
      this.say(verdict.message, 'refuse');
      return;
    }
    this.edit(at.index, at.column, select.value);
    const label = select.selectedOptions[0]?.textContent ?? select.value;
    this.say(verdict.message || `${this.rowName(this.rowAt(at.index), at.index)}: ${label}`, verdict.level);
  }

  private editFrom(control: HTMLElement, value: unknown): void {
    const at = this.cellOf(control);
    if (at) this.edit(at.index, at.column, value);
  }

  private edit(index: number, column: number, value: unknown): void {
    const s = this.session;
    if (!s || s.busy) return;
    s.edits = withEdit(s.edits, s.rows, index, s.spec.columns[column].field, value);
    this.renderLine(index);
    this.renderStates();
  }

  private clearKey(button: HTMLButtonElement): void {
    const s = this.session;
    const at = this.cellOf(button);
    if (!s || !at) return;
    this.edit(at.index, at.column, null);
    this.say(`${this.rowName(this.rowAt(at.index), at.index)}: no shortcut`, 'ok');
    // The button greys once there is nothing to clear, and a disabled button
    // drops the focus to the page; the cell beside it takes it instead.
    button.parentElement?.querySelector<HTMLInputElement>('.config-key-input')?.focus();
  }

  /**
   * A keypress in a shortcut cell: the chord it makes becomes the cell's
   * value, unless it is refused, when the cell says why and keeps what it had.
   * A lone modifier waits for its key.
   */
  private onKeyCell(e: KeyboardEvent, input: HTMLInputElement): void {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const s = this.session;
    const at = this.cellOf(input);
    if (!s || s.busy || !at || e.repeat || e.isComposing) return;
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      const before = s.keyAtFocus;
      if (before && before.index === at.index && before.column === at.column) this.edit(at.index, at.column, before.value);
      this.say('');
      this.panel.focus();
      return;
    }
    const chord = chordFromEvent(e);
    if (chord === null) return;
    const column = s.spec.columns[at.column];
    if (column.kind !== 'key') return;
    const verdict = chordCellState(this.rowAt(at.index), chord, applyEdits(s.rows, s.edits), column.validate);
    if (verdict.level === 'refuse') {
      this.mark(input, 'refuse', verdict.message);
      this.say(verdict.message, 'refuse');
      return;
    }
    this.edit(at.index, at.column, chord);
    const name = this.rowName(this.rowAt(at.index), at.index);
    this.say(verdict.message || `${name}: ${displayChord(chord, { mac: this.options.mac })}`, verdict.level);
  }

  // ---- Keys and focus --------------------------------------------------------------------

  /**
   * Every key pressed inside the popup ends here, except the ones a shortcut
   * cell takes: none of them reach the window's shortcuts, and `Ctrl` and
   * `Alt` chords do not reach the menu bar either.
   */
  private onKeyDown(e: KeyboardEvent): void {
    const s = this.session;
    if (!s) return;
    e.stopPropagation();
    if (isReloadKey(e) || isNewTabKey(e) || ((e.ctrlKey || e.metaKey || e.altKey) && !keptForEditing(e))) {
      e.preventDefault();
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      this.keepFocusIn(e);
      return;
    }
    if (s.busy) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.cancel();
      return;
    }
    if (e.key === 'Enter' && !e.altKey && acceptsOnEnter(e.target)) {
      e.preventDefault();
      void this.accept();
    }
  }

  /** `Tab` goes round the popup's own controls rather than out to the page behind it. */
  private keepFocusIn(e: KeyboardEvent): void {
    const stops = this.tabStops();
    if (stops.length === 0) return;
    const at = document.activeElement;
    const inside = at instanceof HTMLElement && at !== this.panel && this.panel.contains(at);
    const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
    if (!inside || at === edge) {
      e.preventDefault();
      (e.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
    }
  }

  /** The controls `Tab` stops at, in order: enabled, in view, and only the ticked radio of the filters. */
  private tabStops(): HTMLElement[] {
    return Array.from(this.panel.querySelectorAll<HTMLElement>('input, select, button, textarea')).filter((node) => {
      if ((node as HTMLInputElement).disabled || node.offsetParent === null) return false;
      return !(node instanceof HTMLInputElement && node.type === 'radio' && !node.checked);
    });
  }

  /** Where the focus starts: the search box, else the first control in the table, else Accept. */
  private firstStop(): HTMLElement | null {
    if (!this.search.classList.contains('is-hidden')) return this.search;
    const inTable = this.tabStops().find((node) => this.tableBox.contains(node));
    return inTable ?? this.acceptButton;
  }
}
