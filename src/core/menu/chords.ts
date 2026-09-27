/**
 * Keyboard chords: the one spelling the shortcut files, the menus, the key
 * handler, the editors and the documentation share.
 *
 * A chord is written `[Ctrl+][Alt+][Shift+]Key`, modifiers in that order. The
 * key is an upper-case letter, a digit, a punctuation mark, `Plus` for the `+`
 * key, `F1` to `F24`, or one of the named keys below (`Enter`, `Delete`,
 * `Space`...). That canonical string is what `shortcuts.json` stores and what
 * two chords are compared by; {@link parseChord} reads the looser spellings a
 * person types (`ctrl+shift+z`, `Cmd+O`, `Ctrl++`) and {@link canonicalChord}
 * turns them into it.
 *
 * `Ctrl` means the platform's command key: `CmdOrCtrl` in an Electron
 * accelerator, `Cmd` in a macOS label, and either key in a keyboard event -
 * the key handler has always read `e.ctrlKey || e.metaKey`.
 *
 * Nothing here touches the DOM. An event is read through {@link KeyEventLike},
 * which a `KeyboardEvent` satisfies and a test can build by hand.
 */

/** A chord taken apart. */
export interface ParsedChord {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  /** The key's canonical name: `A`, `7`, `]`, `Plus`, `Enter`, `F2`. */
  readonly key: string;
}

/** The parts of a keyboard event a chord is read from. A `KeyboardEvent` has them all. */
export interface KeyEventLike {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey?: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const BACKSLASH = String.fromCharCode(92);

/** Punctuation a key can produce. `+` is left out: it is the separator, and the key is `Plus`. */
const PUNCTUATION = new Set<string>([...'`~!@#$%^&*()-_=[]{}|;:,.<>/?', "'", '"', BACKSLASH]);

/** The named keys, by every spelling a person or an Electron accelerator uses for them. */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  enter: 'Enter',
  return: 'Enter',
  delete: 'Delete',
  del: 'Delete',
  backspace: 'Backspace',
  escape: 'Escape',
  esc: 'Escape',
  space: 'Space',
  tab: 'Tab',
  plus: 'Plus',
  insert: 'Insert',
  ins: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pgup: 'PageUp',
  pagedown: 'PageDown',
  pgdn: 'PageDown',
  up: 'Up',
  arrowup: 'Up',
  down: 'Down',
  arrowdown: 'Down',
  left: 'Left',
  arrowleft: 'Left',
  right: 'Right',
  arrowright: 'Right',
};

/** The modifiers, by every spelling. `Meta` and `Super` are not offered: nothing on Windows reaches the page with them. */
const MODIFIERS: Readonly<Record<string, 'ctrl' | 'alt' | 'shift'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  cmd: 'ctrl',
  command: 'ctrl',
  cmdorctrl: 'ctrl',
  commandorcontrol: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
};

const F_KEY = /^f([1-9]|1[0-9]|2[0-4])$/i;

/** A key's canonical name from one written part of a chord, or null when it names no key. */
function keyName(part: string): string | null {
  if (part.length === 1) {
    if (/[a-z]/i.test(part)) return part.toUpperCase();
    if (/[0-9]/.test(part)) return part;
    if (part === '+') return 'Plus';
    return PUNCTUATION.has(part) ? part : null;
  }
  const named = NAMED_KEYS[part.toLowerCase()];
  if (named) return named;
  const f = F_KEY.exec(part);
  return f ? `F${f[1]}` : null;
}

/**
 * Reads a chord as a person or a file writes it, or gives null when it is not
 * one: no key, two keys, a key before a modifier, a modifier named twice.
 * Spacing, case and the order of the modifiers do not matter, and `Ctrl++`
 * is `Ctrl` with the plus key.
 */
export function parseChord(text: string): ParsedChord | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;
  let parts: string[];
  if (trimmed === '+') parts = ['+'];
  else if (trimmed.endsWith('++')) parts = [...trimmed.slice(0, -2).split('+'), '+'];
  else parts = trimmed.split('+');
  parts = parts.map((part) => part.trim());
  if (parts.some((part) => part === '')) return null;

  const mods = { ctrl: false, alt: false, shift: false };
  for (let i = 0; i < parts.length - 1; i++) {
    const mod = MODIFIERS[parts[i].toLowerCase()];
    if (!mod || mods[mod]) return null;
    mods[mod] = true;
  }
  const key = keyName(parts[parts.length - 1]);
  return key ? { ...mods, key } : null;
}

/** Writes a chord in its canonical form. */
export function formatChord(chord: ParsedChord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  parts.push(chord.key);
  return parts.join('+');
}

/** A chord's canonical form, or null when the text is not a chord. */
export function canonicalChord(text: string): string | null {
  const parsed = parseChord(text);
  return parsed ? formatChord(parsed) : null;
}

/** How a chord reads in a menu, a tooltip or the documentation. */
export interface ChordDisplayOptions {
  /** Name the modifiers the way a Mac does: `Cmd`, `Option`. */
  mac?: boolean;
}

/**
 * A chord as a person reads it: the canonical form, with the plus key shown as
 * `+` (`Ctrl++`), and on a Mac `Cmd` and `Option` for `Ctrl` and `Alt`. Text
 * that is not a chord comes back unchanged.
 */
export function displayChord(chord: string, options: ChordDisplayOptions = {}): string {
  const parsed = parseChord(chord);
  if (!parsed) return chord;
  const parts: string[] = [];
  if (parsed.ctrl) parts.push(options.mac ? 'Cmd' : 'Ctrl');
  if (parsed.alt) parts.push(options.mac ? 'Option' : 'Alt');
  if (parsed.shift) parts.push('Shift');
  parts.push(parsed.key === 'Plus' ? '+' : parsed.key);
  return parts.join('+');
}

/** A chord as an Electron accelerator: `Ctrl` becomes `CmdOrCtrl`. Null when the text is not a chord. */
export function toAccelerator(chord: string): string | null {
  const parsed = parseChord(chord);
  if (!parsed) return null;
  const parts: string[] = [];
  if (parsed.ctrl) parts.push('CmdOrCtrl');
  if (parsed.alt) parts.push('Alt');
  if (parsed.shift) parts.push('Shift');
  parts.push(parsed.key);
  return parts.join('+');
}

/**
 * True for a chord with neither `Ctrl` nor `Alt`: a letter, a named key, or
 * either with `Shift`. The native menu never claims one, because it would
 * then take that key from every text field in the window.
 */
export function isBareChord(chord: string): boolean {
  const parsed = parseChord(chord);
  return parsed !== null && !parsed.ctrl && !parsed.alt;
}

/**
 * Why a chord cannot be a shortcut, or null when it can. These keys already
 * mean something to the app or to the window whatever is bound: Space pans
 * and draws straight lines while held, with `Ctrl` and `Alt` too (the quick
 * curves); Escape backs out of whatever is open; Tab moves the focus; and
 * `Alt+F4` closes the window.
 */
export function reservedReason(chord: string): string | null {
  const parsed = parseChord(chord);
  if (!parsed) return null;
  if (parsed.key === 'Space') return 'Space is held to pan and to draw straight lines and quick curves';
  if (parsed.key === 'Escape') return 'Escape backs out of whatever mode or palette is open';
  if (parsed.key === 'Tab') return 'Tab moves the focus from control to control';
  if (parsed.alt && !parsed.ctrl && !parsed.shift && parsed.key === 'F4') return 'Alt+F4 closes the window';
  return null;
}

// ---- Keyboard events ---------------------------------------------------------

/** Keys that are only ever modifiers or locks, never a chord's key. */
const MODIFIER_KEYS = new Set([
  'Control',
  'Shift',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'Super',
  'Hyper',
  'Fn',
  'FnLock',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Symbol',
  'SymbolLock',
]);

/** `KeyboardEvent.key` values that are named keys, mapped to their chord names. */
const EVENT_KEY_NAMES: Readonly<Record<string, string>> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Enter: 'Enter',
  Delete: 'Delete',
  Del: 'Delete',
  Backspace: 'Backspace',
  Escape: 'Escape',
  Esc: 'Escape',
  Tab: 'Tab',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Up: 'Up',
  Down: 'Down',
  Left: 'Left',
  Right: 'Right',
};

/** `KeyboardEvent.code` values of the punctuation keys, mapped to the mark each makes unshifted on a US layout. */
const CODE_CHARACTERS: Readonly<Record<string, string>> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: BACKSLASH,
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

/** True for a key that is a character the keyboard made: a digit, a mark, or the plus key. */
function isCharacterKey(key: string): boolean {
  return key === 'Plus' || /^[0-9]$/.test(key) || PUNCTUATION.has(key);
}

function isLetter(key: string): boolean {
  return /^[A-Z]$/.test(key);
}

/** The chord key an event's `key` names, or null for a key no chord can use (dead keys, IME, letters outside A to Z). */
function eventKey(key: string): string | null {
  if (key.length === 1) {
    if (key === ' ') return 'Space';
    if (/[a-z]/i.test(key)) return key.toUpperCase();
    if (/[0-9]/.test(key)) return key;
    if (key === '+') return 'Plus';
    return PUNCTUATION.has(key) ? key : null;
  }
  const named = EVENT_KEY_NAMES[key];
  if (named) return named;
  const f = /^F([1-9]|1[0-9]|2[0-4])$/.exec(key);
  return f ? key : null;
}

/** The chord key the physical key `code` names: its letter, its digit, or its unshifted mark. */
function codeKey(code: string | undefined): string | null {
  if (!code) return null;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  return CODE_CHARACTERS[code] ?? null;
}

/**
 * Every chord a keypress can be matched against, most specific first.
 *
 * A letter or a named key carries `Shift` as the event says - `Shift+C` for
 * `C` with Shift held, whatever Caps Lock did to the letter's case. A digit or
 * a mark already has Shift inside it (`Shift` and `=` make `+`), so the
 * character is offered without it, which is what `Ctrl+Plus` or `Ctrl+}`
 * mean. The physical key is offered too, with Shift as held, so
 * `Ctrl+Shift+]` still matches on a layout where that key makes something
 * else; a letter is only read from the physical key when the event's own
 * character is not a letter (a Mac's Option turns `A` into `å`).
 */
export function eventChords(event: KeyEventLike): string[] {
  if (MODIFIER_KEYS.has(event.key)) return [];
  const ctrl = event.ctrlKey || event.metaKey === true;
  const alt = event.altKey;
  const shift = event.shiftKey;
  const out: string[] = [];
  const add = (key: string, withShift: boolean): void => {
    const chord = formatChord({ ctrl, alt, shift: withShift, key });
    if (!out.includes(chord)) out.push(chord);
  };
  const fromKey = eventKey(event.key);
  if (fromKey) {
    if (isCharacterKey(fromKey)) {
      add(fromKey, false);
      if (shift) add(fromKey, true);
    } else {
      add(fromKey, shift);
    }
  }
  const fromCode = codeKey(event.code);
  if (fromCode && (isCharacterKey(fromCode) || !fromKey || !isLetter(fromKey))) add(fromCode, shift);
  return out;
}

/**
 * The one chord a keypress is written down as, for a shortcut being typed into
 * an editor: a letter or a named key with Shift as held; a digit or a mark by
 * its physical key with Shift as held (`Ctrl+Shift+]`, not `Ctrl+}`), so the
 * chord reads the same on any layout; and a character with no physical key to
 * name by itself. Null for a lone modifier or a key no chord can use.
 */
export function chordFromEvent(event: KeyEventLike): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const ctrl = event.ctrlKey || event.metaKey === true;
  const alt = event.altKey;
  const shift = event.shiftKey;
  const fromKey = eventKey(event.key);
  const fromCode = codeKey(event.code);
  if (fromKey && !isCharacterKey(fromKey)) return formatChord({ ctrl, alt, shift, key: fromKey });
  if (fromCode) return formatChord({ ctrl, alt, shift, key: fromCode });
  if (fromKey) return formatChord({ ctrl, alt, shift: false, key: fromKey });
  return null;
}

/** True when a keypress is the chord. */
export function matchesEvent(chord: string, event: KeyEventLike): boolean {
  const canonical = canonicalChord(chord);
  return canonical !== null && eventChords(event).includes(canonical);
}
