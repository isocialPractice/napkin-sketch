/**
 * The app's outline source (core/type/outline.ts): the canvas's measure, so
 * text is laid out as the canvas sets it, and this computer's fonts, each
 * face read from its file (renderer/font-list.ts) the first time a text asks
 * for it. A face asked for before it is read answers null, and is read; once
 * it is, the source takes a new id - so every drawing made without it is made
 * again - and the window is told, to paint again.
 */

import type { OutlineSource } from '../core/type/outline.js';
import type { TypeFont, TypeMeasure } from '../core/type/measure.js';
import { openSfnt, type SfntFace, type SfntProblem } from '../core/type/sfnt.js';
import type { FontList } from './font-list.js';

/** A face is the family list and the style a text asks for: every size and setting of it draws from one. */
function faceKey(font: TypeFont): string {
  return `${font.family}\u0001${font.style}`;
}

export class TypeFaces implements OutlineSource {
  private generation = 0;
  private readonly known = new Map<string, SfntFace | SfntProblem>();
  private readonly reading = new Map<string, Promise<SfntFace | SfntProblem>>();

  constructor(
    private readonly fonts: FontList,
    readonly measure: TypeMeasure,
    private readonly onRead: () => void,
  ) {}

  get id(): string {
    return `system${this.generation}:${this.measure.id}`;
  }

  face(font: TypeFont): SfntFace | SfntProblem | null {
    const known = this.known.get(faceKey(font));
    if (known) return known;
    void this.read(font);
    return null;
  }

  /** Reads every face these fonts are drawn with; resolves once each is read, or found unreadable. */
  async readAll(fonts: Iterable<TypeFont>): Promise<void> {
    const wanted = new Map<string, TypeFont>();
    for (const font of fonts) wanted.set(faceKey(font), font);
    await Promise.all([...wanted.values()].map((font) => this.read(font)));
  }

  private read(font: TypeFont): Promise<SfntFace | SfntProblem> {
    const key = faceKey(font);
    const pending = this.reading.get(key);
    if (pending) return pending;
    const job = (async (): Promise<SfntFace | SfntProblem> => {
      await this.fonts.load();
      if (!this.fonts.available) return { problem: "this computer's fonts cannot be read" };
      const file = await this.fonts.faceFile(font.family, font.style);
      if (!file) return { problem: 'it is not installed on this computer' };
      return openSfnt(file.bytes, file.postscriptName);
    })().then((face) => {
      this.known.set(key, face);
      this.generation++;
      this.onRead();
      return face;
    });
    this.reading.set(key, job);
    return job;
  }

  /** Reads every face again: after the system's fonts were read again, a font installed since may now be there. */
  forget(): void {
    this.known.clear();
    this.reading.clear();
    this.generation++;
    this.onRead();
  }
}
