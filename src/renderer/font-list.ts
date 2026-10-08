/**
 * The fonts on this computer, for the Type panel: their families, and each
 * family's faces. They are read with the Local Font Access API
 * (`queryLocalFonts()`, which Electron answers with no prompt) and kept for
 * the session; the panel's refresh button reads them again. Where the API is
 * missing or refused, a few fonts most systems have stand in, and no text is
 * reported as using a font that is not installed - there is no list to tell.
 *
 * Each face's file can be read too (`faceFile`): what draws text from its
 * outlines (renderer/type-faces.ts) - a text's family list read in order, a
 * CSS kind such as `sans-serif` as this system's browser sets it, and the
 * face nearest the style asked for.
 */

import { faceStyle } from '../core/type/measure.js';

/** A family and its faces' names, the regular weight first. */
export interface FontFamily {
  name: string;
  styles: string[];
}

/** What `queryLocalFonts()` gives for each face. */
interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  /** The face's font file, the whole collection for a face of one. */
  blob?: () => Promise<Blob>;
}

/** A face's font file: its bytes, and the PostScript name that picks the face out of a collection. */
export interface FaceFile {
  bytes: Uint8Array;
  postscriptName: string;
  /** The family and face it is, as the system names them. */
  family: string;
  style: string;
}

/**
 * The families a browser sets each CSS kind in, first found first: the
 * names this system may have - Windows', then the Mac's, then Linux's.
 */
const GENERIC_FACES: Readonly<Record<string, readonly string[]>> = {
  'sans-serif': ['Arial', 'Helvetica', 'Liberation Sans', 'DejaVu Sans'],
  serif: ['Times New Roman', 'Times', 'Liberation Serif', 'DejaVu Serif'],
  monospace: ['Consolas', 'Courier New', 'Menlo', 'Liberation Mono', 'DejaVu Sans Mono'],
  'system-ui': ['Segoe UI', 'SF Pro Text', 'Helvetica Neue', 'Ubuntu', 'Cantarell', 'DejaVu Sans'],
  'ui-sans-serif': ['Segoe UI', 'SF Pro Text', 'Helvetica Neue', 'DejaVu Sans'],
  'ui-serif': ['Times New Roman', 'New York', 'Times', 'DejaVu Serif'],
  'ui-monospace': ['Consolas', 'SF Mono', 'Menlo', 'DejaVu Sans Mono'],
  cursive: ['Comic Sans MS', 'Apple Chancery'],
  fantasy: ['Impact', 'Papyrus'],
};

/** The families CSS knows by kind rather than by name: always there. */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
  '-apple-system',
  'blinkmacsystemfont',
]);

/** The list that stands in when the system's cannot be read. */
const STAND_INS = ['Arial', 'Courier New', 'Georgia', 'Segoe UI', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const STAND_IN_STYLES = ['Regular', 'Italic', 'Bold', 'Bold Italic'];

/** How many fonts chosen lately are kept, to show first. */
export const RECENT_FONTS = 6;

/** The names in a family as CSS writes it - one name, or a list - unquoted. */
export function familyNames(family: string): string[] {
  return family
    .split(',')
    .map((name) => name.trim().replace(/^["']|["']$/g, '').trim())
    .filter((name) => name !== '');
}

/** Faces in the order a style list reads: lightest first, each upright before its italic, Regular first among its weight's names. */
function byWeight(a: string, b: string): number {
  const fa = faceStyle(a);
  const fb = faceStyle(b);
  if (fa.weight !== fb.weight) return fa.weight - fb.weight;
  if (fa.italic !== fb.italic) return fa.italic ? 1 : -1;
  if (/^regular$/i.test(a)) return -1;
  if (/^regular$/i.test(b)) return 1;
  return a.localeCompare(b);
}

/** Families from the faces `queryLocalFonts()` gave: each name once, A to Z, its faces in weight order. */
export function familiesOf(faces: readonly Pick<LocalFontData, 'family' | 'style'>[]): FontFamily[] {
  const byName = new Map<string, { name: string; styles: Set<string> }>();
  for (const face of faces) {
    const name = face.family.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const entry = byName.get(key) ?? { name, styles: new Set<string>() };
    entry.styles.add(face.style.trim() || 'Regular');
    byName.set(key, entry);
  }
  return [...byName.values()]
    .map((entry) => ({ name: entry.name, styles: [...entry.styles].sort(byWeight) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export class FontList {
  private list: FontFamily[] = STAND_INS.map((name) => ({ name, styles: [...STAND_IN_STYLES] }));
  private byName = new Map<string, FontFamily>();
  /** Each family's faces as the system gave them, by the family's name in lower case. */
  private faces = new Map<string, LocalFontData[]>();
  /** The files read, by PostScript name: one read a face, however many texts ask. */
  private readonly files = new Map<string, Promise<FaceFile | null>>();
  private read = false;
  private loading: Promise<void> | null = null;
  private recents: string[] = [];
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.index();
  }

  /** Reads the system's fonts, the first time only; the same promise after. */
  load(): Promise<void> {
    if (!this.loading) this.loading = this.query();
    return this.loading;
  }

  /** Reads the system's fonts again: a font installed while the app was open shows up. */
  refresh(): Promise<void> {
    this.loading = this.query();
    return this.loading;
  }

  private async query(): Promise<void> {
    const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
    if (typeof query !== 'function') return;
    try {
      const faces = await query.call(window);
      const families = familiesOf(faces);
      if (families.length === 0) return;
      this.list = families;
      this.read = true;
      this.index();
      this.faces = new Map();
      for (const face of faces) {
        const key = face.family.trim().toLowerCase();
        const list = this.faces.get(key);
        if (list) list.push(face);
        else this.faces.set(key, [face]);
      }
      for (const listener of this.listeners) listener();
    } catch {
      // Refused or unavailable: the stand-ins stay, and nothing is reported missing.
    }
  }

  private index(): void {
    this.byName = new Map(this.list.map((family) => [family.name.toLowerCase(), family]));
  }

  /** Hears the list change, after a read; returns the function that stops listening. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** True when the list is the system's, not the stand-ins. */
  get available(): boolean {
    return this.read;
  }

  get families(): readonly FontFamily[] {
    return this.list;
  }

  /** A family by its name, any case; for a CSS list, its first name's. */
  family(name: string): FontFamily | undefined {
    const first = familyNames(name)[0];
    return first ? this.byName.get(first.toLowerCase()) : undefined;
  }

  /** A family's faces, the regular weight first; none when it is not installed. */
  styles(name: string): string[] {
    return this.family(name)?.styles ?? [];
  }

  /**
   * Whether text set in `family` shows it: a family this computer has, or a
   * kind CSS always has - in a CSS list, any of its names. True when the
   * system's list could not be read.
   */
  has(family: string): boolean {
    if (!this.read) return true;
    return familyNames(family).some((name) => GENERIC_FAMILIES.has(name.toLowerCase()) || this.byName.has(name.toLowerCase()));
  }

  /**
   * The installed family a text in `family` is set in: the first of its list
   * this system has, a CSS kind as its browser sets it. Null when none is.
   */
  installedFamily(family: string): string | null {
    for (const name of familyNames(family)) {
      const key = name.toLowerCase();
      if (this.faces.has(key)) return this.faces.get(key)![0].family;
      for (const candidate of GENERIC_FACES[key] ?? []) {
        if (this.faces.has(candidate.toLowerCase())) return this.faces.get(candidate.toLowerCase())![0].family;
      }
    }
    return null;
  }

  /**
   * The file of the face a text in `family` and `style` is drawn with: the
   * face of that name, else the nearest by weight, then slant. Null when the
   * system's fonts cannot be read, the family is not installed, or its file
   * cannot be had.
   */
  faceFile(family: string, style: string): Promise<FaceFile | null> {
    const installed = this.installedFamily(family);
    const faces = installed ? (this.faces.get(installed.toLowerCase()) ?? []) : [];
    if (faces.length === 0) return Promise.resolve(null);
    const wanted = faceStyle(style);
    const distance = (face: LocalFontData): number => {
      if (face.style.trim().toLowerCase() === style.trim().toLowerCase()) return -1;
      const has = faceStyle(face.style);
      return Math.abs(has.weight - wanted.weight) + (has.italic === wanted.italic ? 0 : 1000);
    };
    const face = faces.reduce((best, each) => (distance(each) < distance(best) ? each : best));
    let file = this.files.get(face.postscriptName);
    if (!file) {
      file = (async (): Promise<FaceFile | null> => {
        try {
          if (typeof face.blob !== 'function') return null;
          const bytes = new Uint8Array(await (await face.blob()).arrayBuffer());
          return { bytes, postscriptName: face.postscriptName, family: face.family, style: face.style };
        } catch {
          return null;
        }
      })();
      this.files.set(face.postscriptName, file);
    }
    return file;
  }

  /** The fonts chosen lately, the last first. */
  get recent(): readonly string[] {
    return this.recents;
  }

  /** Puts a family first among the recent ones. */
  touch(family: string): void {
    const name = familyNames(family)[0];
    if (!name) return;
    this.recents = [name, ...this.recents.filter((f) => f.toLowerCase() !== name.toLowerCase())].slice(0, RECENT_FONTS);
  }

  /** What a check reads: whether the list is the system's, and the families' names. */
  snapshot(): { available: boolean; families: string[]; recent: string[] } {
    return { available: this.read, families: this.list.map((f) => f.name), recent: [...this.recents] };
  }
}
