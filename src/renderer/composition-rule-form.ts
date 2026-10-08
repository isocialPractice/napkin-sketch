/**
 * The form one rule of a Composition Style is set in, from the rule editor's
 * Styles button: every field the rule's kind may set
 * (core/composition-style.ts's `COMPOSITION_RULE_FIELDS`), in their parts,
 * each with a check saying whether the rule sets it. A field left unchecked
 * leaves what the rule styles as it was; changing a value checks it.
 *
 * Numbers, colors, choices and on-or-off are form fields; effects, a gradient
 * and a list are written as the style file writes them, in JSON. OK reads the
 * form as a style file is read, and a value that does not read keeps the form
 * open and says why. The form keeps its keys: Enter is OK, Escape Cancel, and
 * neither reaches the rule editor under it or the window.
 */

import { BLEND_MODES } from '../core/blend.js';
import {
  COMPOSITION_RULE_FIELDS,
  COMPOSITION_RULE_KEYS,
  COMPOSITION_RULE_LABELS,
  validateCompositionStyle,
  type CompositionRuleField,
  type CompositionRuleKind,
} from '../core/composition-style.js';

/** What the form offers beside its fields: the names a text box suggests. */
export interface RuleFormOffers {
  /** Text Configurations by name, for a text rule's configuration. */
  readonly configs: readonly string[];
  /** Language ids, for a text rule's accent. */
  readonly languages: readonly string[];
}

/** The form's parts, found by id, which a test holds `index.html` to. */
export const COMPOSITION_RULE_FORM_PARTS = ['composition-rule-title', 'composition-rule-fields', 'composition-rule-status', 'composition-rule-ok', 'composition-rule-cancel'] as const;

type Part = (typeof COMPOSITION_RULE_FORM_PARTS)[number];

/** One field's row: its check and the control that holds its value as text. */
interface FieldRow {
  readonly field: CompositionRuleField;
  readonly set: HTMLInputElement;
  readonly read: () => unknown;
}

/** A value as its text box shows it. */
function shownValue(field: CompositionRuleField, value: unknown): string {
  if (value === undefined) return '';
  if (field.kind === 'effects' || ((field.kind === 'gradient' || field.kind === 'list') && value !== 'none')) return JSON.stringify(value);
  return String(value);
}

/** A six-digit hex color for a color well, from a color written any way; black when it is not one. */
function wellColor(text: string): string {
  const t = text.trim();
  if (/^#[0-9a-f]{6}$/i.test(t)) return t.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(t)) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`.toLowerCase();
  return '#000000';
}

export class CompositionRuleForm {
  private readonly parts: Record<Part, HTMLElement>;
  private rows: FieldRow[] = [];
  private session: { kind: CompositionRuleKind; name: string; resolve: (rule: Record<string, unknown> | null) => void; returnFocus: Element | null } | null = null;

  constructor(private readonly root: HTMLElement) {
    const found = {} as Record<Part, HTMLElement>;
    for (const id of COMPOSITION_RULE_FORM_PARTS) {
      const node = root.querySelector<HTMLElement>(`#${id}`);
      if (!node) throw new Error(`The rule form has no #${id}.`);
      found[id] = node;
    }
    this.parts = found;
    this.parts['composition-rule-ok'].addEventListener('click', () => this.ok());
    this.parts['composition-rule-cancel'].addEventListener('click', () => this.finish(null));
    root.addEventListener('keydown', (e) => {
      // The form's keys: none reach the rule editor under it or the window's shortcuts.
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.finish(null);
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        this.ok();
      }
    });
  }

  /** True while the form is up. */
  get isOpen(): boolean {
    return this.session !== null;
  }

  /**
   * Opens the form on a rule of `kind` named `name`, filled from `rule`, and
   * resolves with the rule as set - its values read as a style file's are -
   * or null for Cancel. A second opening while one is up gives null.
   */
  open(kind: CompositionRuleKind, name: string, rule: Readonly<Record<string, unknown>>, offers: RuleFormOffers): Promise<Record<string, unknown> | null> {
    if (this.session) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.session = { kind, name, resolve, returnFocus: document.activeElement };
      this.parts['composition-rule-title'].textContent = `${COMPOSITION_RULE_LABELS[kind]} Rule: ${name.trim() || 'no layer named yet'}`;
      this.build(kind, rule, offers);
      this.say('');
      this.root.classList.remove('is-hidden');
      this.rows[0]?.set.focus();
    });
  }

  /** Sets a field as typing into it would, and checks it: for the GUI checks. */
  setField(key: string, value: string): boolean {
    const row = this.rows.find((each) => each.field.key === key);
    const control = row ? this.parts['composition-rule-fields'].querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-field="${key}"]`) : null;
    if (!row || !control) return false;
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /** Presses OK, as the button does: for the GUI checks. */
  accept(): void {
    this.ok();
  }

  // ---- Building --------------------------------------------------------------------------

  private build(kind: CompositionRuleKind, rule: Readonly<Record<string, unknown>>, offers: RuleFormOffers): void {
    const box = this.parts['composition-rule-fields'];
    const nodes: HTMLElement[] = [];
    this.rows = [];
    let group = '';
    for (const field of COMPOSITION_RULE_FIELDS[kind]) {
      if (field.group !== group) {
        group = field.group;
        const heading = document.createElement('p');
        heading.className = 'composition-rule-group';
        heading.textContent = group;
        nodes.push(heading);
      }
      const line = document.createElement('div');
      line.className = 'composition-rule-row';
      line.title = field.summary;
      const set = document.createElement('input');
      set.type = 'checkbox';
      set.className = 'composition-rule-set';
      set.id = `composition-rule-set-${field.key}`;
      set.checked = rule[field.key] !== undefined;
      set.setAttribute('aria-label', `Set ${field.label}`);
      // The name is the check's label, so a click on it sets the field or not.
      const label = document.createElement('label');
      label.className = 'composition-rule-label';
      label.htmlFor = set.id;
      label.textContent = field.unit && field.unit !== 'deg' ? `${field.label} (${field.unit})` : field.label;
      const { control, read } = this.control(field, rule[field.key], offers);
      // A field the rule does not set is dimmed, so a choice shown in it does not read as one the rule makes.
      const shade = (): void => {
        line.classList.toggle('is-set', set.checked);
      };
      set.addEventListener('change', shade);
      const mark = (): void => {
        set.checked = true;
        shade();
      };
      control.addEventListener('input', mark);
      control.addEventListener('change', mark);
      shade();
      line.append(set, label, control);
      nodes.push(line);
      this.rows.push({ field, set, read });
    }
    box.replaceChildren(...nodes);
    box.scrollTop = 0;
  }

  /** A field's control, and how to read what it holds. */
  private control(field: CompositionRuleField, value: unknown, offers: RuleFormOffers): { control: HTMLElement; read: () => unknown } {
    const named = (node: HTMLElement): HTMLElement => {
      node.dataset.field = field.key;
      node.setAttribute('aria-label', field.label);
      return node;
    };
    const select = (choices: ReadonlyArray<{ value: string; label: string }>): HTMLSelectElement => {
      const node = document.createElement('select');
      node.className = 'settings-text composition-rule-input';
      for (const choice of choices) {
        const option = document.createElement('option');
        option.value = choice.value;
        option.textContent = choice.label;
        node.append(option);
      }
      return node;
    };
    const text = (list?: readonly string[]): HTMLInputElement => {
      const node = document.createElement('input');
      node.type = 'text';
      node.className = 'settings-text composition-rule-input';
      node.spellcheck = false;
      node.autocomplete = 'off';
      if (list && list.length > 0) {
        const id = `composition-rule-list-${field.key}`;
        const options = document.createElement('datalist');
        options.id = id;
        for (const word of list) {
          const option = document.createElement('option');
          option.value = word;
          options.append(option);
        }
        this.parts['composition-rule-fields'].append(options);
        node.setAttribute('list', id);
      }
      return node;
    };
    switch (field.kind) {
      case 'number': {
        const node = document.createElement('input');
        node.type = 'number';
        node.step = 'any';
        node.className = 'settings-text composition-rule-input';
        if (field.range) {
          node.min = String(field.range.min);
          node.max = String(field.range.max);
        }
        node.value = shownValue(field, value);
        named(node);
        return { control: node, read: () => (node.value.trim() === '' ? NaN : Number(node.value)) };
      }
      case 'leading': {
        const node = text(['auto']);
        node.placeholder = 'auto, or a number';
        node.value = shownValue(field, value);
        named(node);
        return { control: node, read: () => (node.value.trim().toLowerCase() === 'auto' ? 'auto' : node.value.trim() === '' ? NaN : Number(node.value)) };
      }
      case 'color': {
        const holder = document.createElement('span');
        holder.className = 'composition-rule-color';
        const well = document.createElement('input');
        well.type = 'color';
        well.className = 'composition-rule-well';
        well.tabIndex = -1;
        well.setAttribute('aria-hidden', 'true');
        const node = text(field.none ? ['none'] : undefined);
        node.placeholder = field.none ? '#rrggbb or none' : '#rrggbb';
        node.value = shownValue(field, value);
        well.value = wellColor(node.value);
        named(node);
        well.addEventListener('input', () => {
          node.value = well.value;
          node.dispatchEvent(new Event('input', { bubbles: true }));
        });
        node.addEventListener('input', () => (well.value = wellColor(node.value)));
        holder.append(well, node);
        return { control: holder, read: () => node.value.trim() };
      }
      case 'choice': {
        const node = select((field.choices ?? []).map((choice) => ({ value: choice, label: choice })));
        node.value = typeof value === 'string' ? value : (field.choices?.[0] ?? '');
        named(node);
        return { control: node, read: () => node.value };
      }
      case 'boolean': {
        const node = select([
          { value: 'true', label: 'On' },
          { value: 'false', label: 'Off' },
        ]);
        node.value = value === false ? 'false' : 'true';
        named(node);
        return { control: node, read: () => node.value === 'true' };
      }
      case 'blend': {
        const node = select(BLEND_MODES.map((mode) => ({ value: mode.id, label: mode.id === 'normal' ? mode.label : `${mode.label} (${mode.illustrator})` })));
        node.value = typeof value === 'string' ? value : 'normal';
        named(node);
        return { control: node, read: () => node.value };
      }
      case 'effects':
      case 'gradient':
      case 'list': {
        const node = document.createElement('textarea');
        node.className = 'settings-text composition-rule-input composition-rule-json';
        node.rows = 2;
        node.spellcheck = false;
        node.placeholder = field.kind === 'effects' ? '[] for none' : 'none, or JSON';
        node.value = shownValue(field, value);
        named(node);
        return {
          control: node,
          read: () => {
            const t = node.value.trim();
            if (t === 'none' && field.kind !== 'effects') return 'none';
            try {
              return JSON.parse(t) as unknown;
            } catch {
              return { notJson: t };
            }
          },
        };
      }
      case 'language':
      case 'config':
      case 'text': {
        const node = text(field.kind === 'language' ? ['auto', 'none', ...offers.languages] : field.kind === 'config' ? offers.configs : undefined);
        node.value = shownValue(field, value);
        named(node);
        return { control: node, read: () => node.value.trim() };
      }
    }
  }

  // ---- Answering -------------------------------------------------------------------------

  private say(message: string): void {
    const status = this.parts['composition-rule-status'];
    status.textContent = message;
    status.classList.toggle('is-refuse', message !== '');
  }

  /** OK: the checked fields read as a style file's are; the first that does not read is said, and the form stays. */
  private ok(): void {
    const s = this.session;
    if (!s) return;
    const rule: Record<string, unknown> = {};
    for (const row of this.rows) {
      if (!row.set.checked) continue;
      const value = row.read();
      if (value && typeof value === 'object' && 'notJson' in value) {
        this.say(`${row.field.label} is not JSON.`);
        return;
      }
      rule[row.field.key] = value;
    }
    const name = s.name.trim() || 'rule';
    const key = COMPOSITION_RULE_KEYS[s.kind];
    const read = validateCompositionStyle({ napkinCompositionStyle: 1, name: 'rule', [key]: { [name]: rule } });
    if (!read.ok || !read.style) {
      this.say(read.errors[0] ?? 'The rule does not read.');
      return;
    }
    const rules = read.style[key] as Record<string, Record<string, unknown>> | undefined;
    this.finish(rules?.[name] ?? {});
  }

  private finish(rule: Record<string, unknown> | null): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    this.root.classList.add('is-hidden');
    this.parts['composition-rule-fields'].replaceChildren();
    this.rows = [];
    const back = s.returnFocus;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
    s.resolve(rule);
  }
}
