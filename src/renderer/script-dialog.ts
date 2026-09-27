/**
 * The Generated script dialog: where Automate > Generate Script shows what it
 * wrote, before anything uses it.
 *
 * A generated script is never run unseen. The dialog shows it whole - the
 * text in a box that scrolls and can be selected, a line of how big it is,
 * and the writer's notes on anything it could not draw as the source is -
 * and offers four answers: Copy, Save As (a `.napkin` file), Open as New Page
 * (the script run into a page of its own, the honest way to see what it
 * draws) and Cancel.
 *
 * A source with a choice to make shows it above the text, and the script is
 * written again when the choice changes: a picture can be linked or carried
 * in the script (Embed the image data), and the selected layers can keep the
 * page's size or fit the page to their ink.
 *
 * Long image data is shortened in the view, since a picture's megabytes would
 * bury the script; Copy, Save As and Open always take the whole text.
 */

import { displayScript, statsLine, type GeneratedScript } from '../core/script/generate.js';

/** What the dialog is opened with. */
export interface ScriptDialogSpec {
  /** The Generate Script row it came from, for the title: `From Media File`, `Selected Layers`. */
  readonly kind: string;
  readonly script: GeneratedScript;
  /** Offers Embed the image data; the script is written again when the box changes. */
  readonly embed?: (on: boolean) => GeneratedScript;
  /** Offers Page: keep size or fit to the selection; the script is written again when the choice changes. */
  readonly fit?: (on: boolean) => GeneratedScript;
}

/** What the renderer does with the dialog's answers. Each says for itself how it went. */
export interface ScriptDialogActions {
  copy(text: string): Promise<void>;
  save(text: string, name: string): Promise<void>;
  /** Runs the script into new pages; true when it did, which closes the dialog. */
  open(script: GeneratedScript): Promise<boolean> | boolean;
}

/** The dialog's parts, found by id, which a test holds `index.html` to. */
export const SCRIPT_DIALOG_PARTS = [
  'script-title',
  'script-stats',
  'script-embed-row',
  'script-embed',
  'script-fit-row',
  'script-notes',
  'script-shortened',
  'script-text',
  'script-copy',
  'script-save',
  'script-open',
  'script-cancel',
] as const;

type Part = (typeof SCRIPT_DIALOG_PARTS)[number];

export class ScriptDialog {
  private spec: ScriptDialogSpec | null = null;
  private current: GeneratedScript | null = null;
  private busy = false;
  private returnFocus: Element | null = null;
  private readonly root: HTMLElement;
  private readonly actions: ScriptDialogActions;
  private readonly parts: Record<Part, HTMLElement>;

  constructor(root: HTMLElement, actions: ScriptDialogActions) {
    this.root = root;
    this.actions = actions;
    const found = {} as Record<Part, HTMLElement>;
    for (const id of SCRIPT_DIALOG_PARTS) {
      const node = root.querySelector<HTMLElement>(`#${id}`);
      if (!node) throw new Error(`The Generated script dialog has no #${id}.`);
      found[id] = node;
    }
    this.parts = found;
    this.bind();
  }

  /** True while the dialog is up. */
  get isOpen(): boolean {
    return this.spec !== null;
  }

  /** The script the dialog shows now, whole. */
  get script(): GeneratedScript | null {
    return this.current;
  }

  /** Shows a generated script. Replaces one already up: it had nothing to lose, being unsaved text. */
  open(spec: ScriptDialogSpec): void {
    if (!this.spec) this.returnFocus = document.activeElement;
    this.spec = spec;
    (this.parts['script-embed'] as HTMLInputElement).checked = false;
    for (const radio of this.radios()) radio.checked = radio.value === 'keep';
    this.parts['script-embed-row'].classList.toggle('is-hidden', !spec.embed);
    this.parts['script-fit-row'].classList.toggle('is-hidden', !spec.fit);
    this.setBusy(false);
    this.show(spec.script);
    this.root.classList.remove('is-hidden');
    this.parts['script-text'].scrollTop = 0;
    this.parts['script-text'].focus();
  }

  close(): void {
    if (!this.spec) return;
    this.spec = null;
    this.current = null;
    this.root.classList.add('is-hidden');
    const back = this.returnFocus;
    if (back instanceof HTMLElement && back.isConnected && back !== document.body && !this.root.contains(back)) back.focus();
    else if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
  }

  /** A key that reached the window while the dialog is up: it runs nothing behind the dialog, and Escape closes it. */
  strayKey(e: KeyboardEvent): void {
    if (!this.spec) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'F5') e.preventDefault();
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  // ---- Showing ---------------------------------------------------------------------

  private show(script: GeneratedScript): void {
    const spec = this.spec;
    this.current = script;
    this.parts['script-title'].textContent = `Generated script: ${spec?.kind ?? 'Generate Script'} - ${script.source}`;
    this.parts['script-stats'].textContent = statsLine(script.stats);
    const notes = this.parts['script-notes'];
    notes.replaceChildren(
      ...script.notes.map((note) => {
        const item = document.createElement('li');
        item.textContent = note;
        return item;
      }),
    );
    notes.classList.toggle('is-hidden', script.notes.length === 0);
    const shown = displayScript(script.text);
    this.parts['script-text'].textContent = shown;
    this.parts['script-shortened'].classList.toggle('is-hidden', shown === script.text);
  }

  private radios(): HTMLInputElement[] {
    return Array.from(this.parts['script-fit-row'].querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    for (const id of ['script-copy', 'script-save', 'script-open', 'script-cancel'] as const) {
      (this.parts[id] as HTMLButtonElement).disabled = on;
    }
  }

  /** Runs one of the answers with the buttons held while it works. */
  private async run(answer: (script: GeneratedScript) => Promise<unknown>): Promise<unknown> {
    const script = this.current;
    if (!script || this.busy) return undefined;
    this.setBusy(true);
    try {
      return await answer(script);
    } finally {
      if (this.spec) this.setBusy(false);
    }
  }

  // ---- Answers and keys -----------------------------------------------------------------

  private bind(): void {
    this.parts['script-embed'].addEventListener('change', () => {
      const spec = this.spec;
      if (spec?.embed) this.show(spec.embed((this.parts['script-embed'] as HTMLInputElement).checked));
    });
    this.parts['script-fit-row'].addEventListener('change', () => {
      const spec = this.spec;
      const fit = this.radios().find((radio) => radio.checked)?.value === 'fit';
      if (spec?.fit) this.show(spec.fit(fit));
    });
    this.parts['script-copy'].addEventListener('click', () => void this.run((script) => this.actions.copy(script.text)));
    this.parts['script-save'].addEventListener('click', () => void this.run((script) => this.actions.save(script.text, script.name)));
    this.parts['script-open'].addEventListener('click', () => {
      void this.run(async (script) => {
        if (await this.actions.open(script)) this.close();
      });
    });
    this.parts['script-cancel'].addEventListener('click', () => this.close());
    this.root.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  /**
   * Every key pressed in the dialog ends here: none reaches the window's
   * shortcuts, and no Ctrl or Alt chord but Copy reaches the menu bar, so
   * nothing acts on the drawing behind the dialog. Ctrl+A in the script
   * selects the script alone, Escape closes, and Tab stays in the dialog.
   */
  private onKeyDown(e: KeyboardEvent): void {
    if (!this.spec) return;
    e.stopPropagation();
    const text = this.parts['script-text'];
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && !e.altKey && key === 'a' && e.target === text) {
      e.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    if ((mod || e.altKey) && !(mod && !e.altKey && key === 'c')) e.preventDefault();
    if (e.key === 'F5') e.preventDefault();
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === 'Tab' && !mod && !e.altKey) this.keepFocusIn(e);
  }

  private keepFocusIn(e: KeyboardEvent): void {
    const stops = Array.from(this.root.querySelectorAll<HTMLElement>('input, button, [tabindex="0"]')).filter(
      (node) => !(node as HTMLButtonElement).disabled && node.offsetParent !== null && !(node instanceof HTMLInputElement && node.type === 'radio' && !node.checked),
    );
    if (stops.length === 0) return;
    const at = document.activeElement;
    const inside = at instanceof HTMLElement && stops.includes(at);
    const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
    if (!inside || at === edge) {
      e.preventDefault();
      (e.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
    }
  }
}
