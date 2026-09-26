/**
 * A stand-in for Adobe Illustrator's scripting objects - as much of them as
 * napkin's `.jsx` calls - so a script the writer makes runs in Node and the
 * document it builds can be read back.
 *
 * It holds a script to the rules the real one would, where they change what
 * gets built: an item added goes on top of what its container holds, nothing
 * is added to a hidden or locked layer or group, a font or a file that is not
 * there throws, and placing a file Illustrator will not place - an SVG, as
 * its scripting guide says - throws. It records every document, alert and
 * line written to the console, and runs the script in a context of its own,
 * with only these objects and the language's built-ins in it. An array the
 * script hands over is copied into this realm's, so a test compares it with
 * `deepStrictEqual`.
 */

import { runInNewContext } from 'node:vm';

export type Pt = [number, number];

/** What a run shares: the files on the fake disk, and how it behaves. */
interface Env {
  /** Every file by its path, its bytes one character each. */
  files: Map<string, string>;
  /** Files Illustrator refuses to place. */
  refuse: RegExp;
  /** Told about every item added, before it is: a test throws here to break a run. */
  onAdd?: (item: Art) => void;
}

/** An array with an Illustrator collection's methods on it. */
function collection<T, M extends object>(items: T[], methods: M): T[] & M {
  return Object.assign(items, methods);
}

/** A path with forward slashes, none doubled. */
function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export class FakeFolder {
  constructor(readonly fsName: string) {}
  get parent(): FakeFolder | null {
    if (this.fsName === '/' || /^[a-z]:\/?$/i.test(this.fsName)) return null;
    const up = this.fsName.replace(/\/[^/]*$/, '');
    return new FakeFolder(up === '' ? '/' : up);
  }
}

export class FakeFile {
  encoding = 'UTF-8';
  constructor(
    private readonly env: Env,
    readonly fsName: string,
  ) {}
  get exists(): boolean {
    return this.env.files.has(this.fsName);
  }
  get parent(): FakeFolder {
    return new FakeFolder(this.fsName.replace(/\/[^/]*$/, '') || '/');
  }
  open(mode: string): boolean {
    if (mode === 'w') this.env.files.set(this.fsName, '');
    return true;
  }
  write(text: string): boolean {
    this.env.files.set(this.fsName, (this.env.files.get(this.fsName) ?? '') + text);
    return true;
  }
  close(): boolean {
    return true;
  }
  remove(): boolean {
    return this.env.files.delete(this.fsName);
  }
}

export class RGBColor {
  red = 0;
  green = 0;
  blue = 0;
}

export class GradientColor {
  gradient: FakeGradient | null = null;
  origin: Pt = [0, 0];
  angle = 0;
  length = 0;
}

/** Anything a layer or a group holds. */
export abstract class Art {
  abstract readonly typename: string;
  parent: Container | null = null;
  name = '';
  opacity = 100;
  hidden = false;
  locked = false;
  remove(): void {
    this.parent?.detach(this);
  }
}

export class PathPoint {
  anchor: Pt;
  leftDirection: Pt;
  rightDirection: Pt;
  pointType = 'CORNER';
  constructor(p: Pt) {
    this.anchor = [p[0], p[1]];
    this.leftDirection = [p[0], p[1]];
    this.rightDirection = [p[0], p[1]];
  }
}

export class PathItem extends Art {
  readonly typename = 'PathItem';
  points: PathPoint[] = [];
  closed = false;
  filled = true;
  stroked = true;
  fillColor: RGBColor | GradientColor | null = null;
  strokeColor: RGBColor | null = null;
  strokeWidth = 1;
  strokeCap = 'BUTTENDCAP';
  strokeJoin = 'MITERENDJOIN';
  private dashes: number[] = [];
  evenodd = false;
  get strokeDashes(): number[] {
    return this.dashes;
  }
  set strokeDashes(dashes: number[]) {
    this.dashes = Array.from(dashes);
  }
  /** How `rectangle` or `ellipse` made it, when one did. */
  shape: { kind: 'rectangle' | 'ellipse'; top: number; left: number; width: number; height: number } | null = null;
  get pathPoints(): PathPoint[] & { add(): PathPoint } {
    return collection([...this.points], {
      add: (): PathPoint => {
        const point = new PathPoint([0, 0]);
        this.points.push(point);
        return point;
      },
    });
  }
  setEntirePath(points: Pt[]): void {
    this.points = Array.from(points, (p) => new PathPoint(p));
  }
}

export class CompoundPathItem extends Art {
  readonly typename = 'CompoundPathItem';
  /** Its paths, the last added first, as Illustrator keeps them. */
  paths: PathItem[] = [];
  get pathItems(): PathItem[] & { add(): PathItem } {
    return collection([...this.paths], {
      add: (): PathItem => {
        const path = new PathItem();
        this.paths.unshift(path);
        return path;
      },
    });
  }
}

export class TextFrame extends Art {
  readonly typename = 'TextFrame';
  contents = '';
  position: Pt | null = null;
  textPath: PathItem | null = null;
  textRange = {
    characterAttributes: { size: 12, leading: 14.4, autoLeading: true, fillColor: null as RGBColor | null, textFont: null as FakeFont | null },
    paragraphAttributes: { justification: 'LEFT' },
  };
  constructor(
    readonly kind: 'point' | 'area' | 'anchored',
    readonly anchor: Pt | null = null,
  ) {
    super();
  }
}

export class PlacedItem extends Art {
  readonly typename = 'PlacedItem';
  width = 0;
  height = 0;
  position: Pt | null = null;
  private placed: FakeFile | null = null;
  constructor(private readonly env: Env) {
    super();
  }
  get file(): FakeFile | null {
    return this.placed;
  }
  set file(file: FakeFile | null) {
    if (!file || !file.exists) throw new Error('File not found');
    if (this.env.refuse.test(file.fsName)) throw new Error("Unable to set placed item's file, is the file path provided valid?");
    this.placed = file;
    this.width = 72;
    this.height = 72;
  }
  embed(): void {
    const container = this.parent;
    if (!container || !this.placed) throw new Error('nothing to embed');
    const raster = new RasterItem(this.placed.fsName, this.env.files.get(this.placed.fsName) ?? '');
    Object.assign(raster, { width: this.width, height: this.height, position: this.position, parent: container });
    container.items[container.items.indexOf(this)] = raster;
    this.parent = null;
  }
}

export class RasterItem extends Art {
  readonly typename = 'RasterItem';
  width = 0;
  height = 0;
  position: Pt | null = null;
  constructor(
    /** The file it was embedded from. */
    readonly source: string,
    /** Its bytes, one character each, as they were when it was embedded. */
    readonly bytes: string,
  ) {
    super();
  }
}

/** A layer or a group: what holds items, the last added on top. */
export abstract class Container extends Art {
  /** Its items, top first, as Illustrator keeps them. */
  items: Art[] = [];
  constructor(protected readonly env: Env) {
    super();
  }
  abstract editable(): boolean;
  adopt<T extends Art>(item: T): T {
    if (!this.editable()) throw new Error('Target layer cannot be modified');
    this.env.onAdd?.(item);
    item.parent = this;
    this.items.unshift(item);
    return item;
  }
  detach(item: Art): void {
    this.items = this.items.filter((it) => it !== item);
    item.parent = null;
  }
  private kind<T extends Art>(typename: string): T[] {
    return this.items.filter((item) => item.typename === typename) as T[];
  }
  get pageItems(): Art[] {
    return [...this.items];
  }
  get pathItems() {
    const shaped = (kind: 'rectangle' | 'ellipse', top: number, left: number, width: number, height: number): PathItem => {
      const path = new PathItem();
      path.shape = { kind, top, left, width, height };
      path.setEntirePath([
        [left, top],
        [left + width, top],
        [left + width, top - height],
        [left, top - height],
      ]);
      path.closed = true;
      return this.adopt(path);
    };
    return collection(this.kind<PathItem>('PathItem'), {
      add: (): PathItem => this.adopt(new PathItem()),
      rectangle: (top: number, left: number, width: number, height: number): PathItem => shaped('rectangle', top, left, width, height),
      ellipse: (top: number, left: number, width: number, height: number): PathItem => shaped('ellipse', top, left, width, height),
    });
  }
  get compoundPathItems() {
    return collection(this.kind<CompoundPathItem>('CompoundPathItem'), { add: (): CompoundPathItem => this.adopt(new CompoundPathItem()) });
  }
  get groupItems() {
    return collection(this.kind<GroupItem>('GroupItem'), { add: (): GroupItem => this.adopt(new GroupItem(this.env)) });
  }
  get textFrames() {
    return collection(this.kind<TextFrame>('TextFrame'), {
      add: (): TextFrame => this.adopt(new TextFrame('point')),
      pointText: (anchor: Pt): TextFrame => this.adopt(new TextFrame('anchored', [anchor[0], anchor[1]])),
      areaText: (path: PathItem): TextFrame => {
        path.remove();
        const frame = new TextFrame('area');
        frame.textPath = path;
        return this.adopt(frame);
      },
    });
  }
  get placedItems() {
    return collection(this.kind<PlacedItem>('PlacedItem'), { add: (): PlacedItem => this.adopt(new PlacedItem(this.env)) });
  }
  get rasterItems(): RasterItem[] {
    return this.kind<RasterItem>('RasterItem');
  }
}

export class Layer extends Container {
  readonly typename = 'Layer';
  visible = true;
  editable(): boolean {
    return this.visible && !this.locked;
  }
}

export class GroupItem extends Container {
  readonly typename = 'GroupItem';
  editable(): boolean {
    return !this.hidden && !this.locked && (this.parent?.editable() ?? true);
  }
}

export class GradientStop {
  midPoint = 50;
  color: RGBColor | null = null;
  opacity = 100;
  constructor(
    private readonly owner: FakeGradient,
    public rampPoint: number,
  ) {}
  remove(): void {
    this.owner.stops = this.owner.stops.filter((stop) => stop !== this);
  }
}

export class FakeGradient {
  type = 'LINEAR';
  stops: GradientStop[] = [new GradientStop(this, 0), new GradientStop(this, 100)];
  get gradientStops(): GradientStop[] & { add(): GradientStop } {
    return collection([...this.stops], {
      add: (): GradientStop => {
        const stop = new GradientStop(this, 50);
        this.stops.push(stop);
        return stop;
      },
    });
  }
}

export class FakeDocument {
  readonly typename = 'Document';
  /** Its layers, top first, as Illustrator keeps them. */
  layerList: Layer[];
  gradientList: FakeGradient[] = [];
  artboards: Array<{ artboardRect: [number, number, number, number]; name: string }>;
  constructor(
    private readonly env: Env,
    readonly colorSpace: string,
    readonly width: number,
    readonly height: number,
    origin: Pt,
  ) {
    this.artboards = [{ artboardRect: [origin[0], origin[1], origin[0] + width, origin[1] - height], name: 'Artboard 1' }];
    const first = new Layer(env);
    first.name = 'Layer 1';
    this.layerList = [first];
  }
  get layers(): Layer[] & { add(): Layer } {
    return collection([...this.layerList], {
      add: (): Layer => {
        const layer = new Layer(this.env);
        layer.name = `Layer ${this.layerList.length + 1}`;
        this.layerList.unshift(layer);
        return layer;
      },
    });
  }
  get gradients(): FakeGradient[] & { add(): FakeGradient } {
    return collection([...this.gradientList], {
      add: (): FakeGradient => {
        const gradient = new FakeGradient();
        this.gradientList.push(gradient);
        return gradient;
      },
    });
  }
}

export interface FakeFont {
  name: string;
  family: string;
  style: string;
}

/** The fonts a run has unless a test names others: a few faces most machines carry. */
export const FAKE_FONTS: FakeFont[] = [
  { name: 'ArialMT', family: 'Arial', style: 'Regular' },
  { name: 'Arial-BoldMT', family: 'Arial', style: 'Bold' },
  { name: 'SegoeUI', family: 'Segoe UI', style: 'Regular' },
  { name: 'TimesNewRomanPSMT', family: 'Times New Roman', style: 'Regular' },
  { name: 'AcmeSans-Book', family: 'Acme Sans', style: 'Book' },
  { name: 'AcmeSans-Heavy', family: 'Acme Sans', style: 'Heavy' },
];

export interface RunOptions {
  /** Where the script is, which it finds linked files from. Default `/work/drawing.jsx`. */
  scriptPath?: string;
  /** Files on the fake disk, by path. */
  files?: Record<string, string | Uint8Array>;
  fonts?: FakeFont[];
  /** Files Illustrator will not place. Default: SVG. */
  refuse?: RegExp;
  /** Where a new document's artboard starts: its left and its top. Default `[100, 700]`. */
  origin?: Pt;
  onAdd?: (item: Art) => void;
}

export interface JsxRun {
  /** What the script's last expression gave: the message it ends with. */
  result: unknown;
  alerts: string[];
  /** What it wrote with `$.writeln`. */
  log: string[];
  documents: FakeDocument[];
  /** The fake disk after the run. */
  files: Map<string, string>;
  app: { coordinateSystem: string; userInteractionLevel: string };
}

/** Runs a script against a fresh fake Illustrator and gives back what it built. */
export function runJsx(script: string, options: RunOptions = {}): JsxRun {
  const env: Env = { files: new Map(), refuse: options.refuse ?? /\.svg$/i, onAdd: options.onAdd };
  for (const [path, data] of Object.entries(options.files ?? {})) {
    env.files.set(normalize(path), typeof data === 'string' ? data : Buffer.from(data).toString('latin1'));
  }
  const run: JsxRun = {
    result: undefined,
    alerts: [],
    log: [],
    documents: [],
    files: env.files,
    app: { coordinateSystem: 'ARTBOARDCOORDINATESYSTEM', userInteractionLevel: 'DISPLAYALERTS' },
  };
  const fonts = (options.fonts ?? FAKE_FONTS).map((font) => ({ ...font }));
  const app = Object.assign({ ...run.app }, {
    documents: collection([] as FakeDocument[], {
      add: (colorSpace: string, width: number, height: number): FakeDocument => {
        const doc = new FakeDocument(env, colorSpace, width, height, options.origin ?? [100, 700]);
        run.documents.push(doc);
        return doc;
      },
    }),
    textFonts: collection(fonts, {
      getByName: (name: string): FakeFont => {
        const font = fonts.find((f) => f.name === name);
        if (!font) throw new Error('No such element');
        return font;
      },
    }),
  });
  const File = function (path: string): FakeFile {
    return new FakeFile(env, normalize(path));
  };
  const scriptPath = normalize(options.scriptPath ?? '/work/drawing.jsx');
  const sandbox = {
    app,
    $: { fileName: scriptPath, writeln: (text: string): void => void run.log.push(text) },
    File,
    Folder: { temp: new FakeFolder('/tmp') },
    alert: (text: string): void => void run.alerts.push(text),
    RGBColor,
    GradientColor,
    DocumentColorSpace: { RGB: 'RGB', CMYK: 'CMYK' },
    PointType: { SMOOTH: 'SMOOTH', CORNER: 'CORNER' },
    StrokeCap: { ROUNDENDCAP: 'ROUNDENDCAP', BUTTENDCAP: 'BUTTENDCAP', PROJECTINGENDCAP: 'PROJECTINGENDCAP' },
    StrokeJoin: { ROUNDENDJOIN: 'ROUNDENDJOIN', MITERENDJOIN: 'MITERENDJOIN', BEVELENDJOIN: 'BEVELENDJOIN' },
    GradientType: { LINEAR: 'LINEAR', RADIAL: 'RADIAL' },
    Justification: { LEFT: 'LEFT', CENTER: 'CENTER', RIGHT: 'RIGHT' },
    CoordinateSystem: { DOCUMENTCOORDINATESYSTEM: 'DOCUMENTCOORDINATESYSTEM', ARTBOARDCOORDINATESYSTEM: 'ARTBOARDCOORDINATESYSTEM' },
    UserInteractionLevel: { DISPLAYALERTS: 'DISPLAYALERTS', DONTDISPLAYALERTS: 'DONTDISPLAYALERTS' },
  };
  run.result = runInNewContext(script, sandbox, { filename: scriptPath });
  run.app = { coordinateSystem: app.coordinateSystem, userInteractionLevel: app.userInteractionLevel };
  return run;
}

/** A document's layers bottom first, the order napkin paints them in. */
export function layersOf(doc: FakeDocument): Layer[] {
  return [...doc.layerList].reverse();
}

/** A container's items bottom first. */
export function itemsOf(container: Container): Art[] {
  return [...container.items].reverse();
}

/** A document's tree, bottom first: a container as `{ Layer: name, items }`, anything else as its typename. */
export function treeOf(doc: FakeDocument): unknown[] {
  const node = (item: Art): unknown =>
    item instanceof Container ? { [item.typename]: item.name, items: itemsOf(item).map(node) } : item.typename;
  return layersOf(doc).map(node);
}

/** A color as `[r, g, b]`. */
export function rgbOf(color: unknown): number[] | null {
  return color instanceof RGBColor ? [color.red, color.green, color.blue] : null;
}
