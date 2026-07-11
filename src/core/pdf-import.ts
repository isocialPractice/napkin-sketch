/**
 * Best-effort PDF vector import (Node-only; uses `node:zlib` for
 * FlateDecode). Runs in the Electron main process and the CLI, never in the
 * renderer.
 *
 * Rather than trusting cross-reference tables, the file is scanned leniently
 * for `N 0 obj ... endobj` bodies, page objects are located by `/Type /Page`,
 * and their content streams are inflated and interpreted:
 * - Path construction (`m l c v y re h`) with `cm` transforms and `q`/`Q`
 *   state nesting; beziers are flattened into polylines.
 * - Stroked paths (`S`/`s`) become pen strokes; filled paths become thin
 *   outlines. Colors from `RG rg G g K k` (and simple `scn`/`sc`) are honored.
 * - Text blocks (`BT..ET`, `Td TD Tm T* Tj ' " TJ`) become text items using
 *   the standard-font size; exact glyph metrics are not reproduced.
 *
 * napkin-sketch's own exports are uncompressed and use exactly this operator
 * subset, so they round-trip. Scanned/raster or exotic PDFs (xref-stream
 * only bodies with object streams, non-Flate filters) yield partial or empty
 * results; callers should surface that as "nothing importable".
 */

import { inflateSync } from 'node:zlib';
import { createId, type Point, type Stroke } from './types.js';

/** One page recovered from a PDF document. */
export interface ImportedPdfPage {
  width: number;
  height: number;
  /** Detected full-page background fill, when present. */
  background?: string;
  strokes: Stroke[];
}

/** 2D affine matrix [a b c d e f], matching the PDF `cm` operand order. */
type Mat = [number, number, number, number, number, number];

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function apply(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function matScale(m: Mat): number {
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  return Number.isFinite(s) && s > 0 ? s : 1;
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** A leniently-scanned indirect object. */
interface PdfObject {
  dict: string;
  stream: Buffer | null;
}

/** Scans every `N 0 obj ... endobj` body in the file. */
function scanObjects(data: Buffer): Map<number, PdfObject> {
  const text = data.toString('latin1');
  const objects = new Map<number, PdfObject>();
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const num = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    let end = text.indexOf('endobj', bodyStart);

    // Binary stream data can contain the bytes "endobj"; bound the stream by
    // its declared /Length (or the next `endstream`) before trusting it.
    const streamKw = text.indexOf('stream', bodyStart);
    let dict: string;
    let stream: Buffer | null = null;
    if (streamKw !== -1 && (end === -1 || streamKw < end)) {
      dict = text.slice(bodyStart, streamKw);
      let dataStart = streamKw + 'stream'.length;
      if (text[dataStart] === '\r') dataStart += 1;
      if (text[dataStart] === '\n') dataStart += 1;
      const direct = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      let dataEnd = direct ? dataStart + Number(direct[1]) : text.indexOf('endstream', dataStart);
      if (dataEnd === -1 || dataEnd > text.length) dataEnd = text.length;
      stream = Buffer.from(text.slice(dataStart, dataEnd).replace(/\r?\n$/, ''), 'latin1');
      const endstream = text.indexOf('endstream', dataEnd);
      end = text.indexOf('endobj', endstream === -1 ? dataEnd : endstream);
    } else {
      if (end === -1) continue;
      dict = text.slice(bodyStart, end);
    }
    if (end === -1) end = text.length;

    objects.set(num, { dict, stream });
    re.lastIndex = end;
  }
  return objects;
}

/** Returns decoded stream bytes, or null when the filter is unsupported. */
function decodeStream(obj: PdfObject): Buffer | null {
  if (!obj.stream) return null;
  const filter = /\/Filter\s*(?:\[\s*)?\/(\w+)/.exec(obj.dict)?.[1];
  if (!filter) return obj.stream;
  if (filter === 'FlateDecode') {
    try {
      return inflateSync(obj.stream);
    } catch {
      return null;
    }
  }
  return null;
}

/** Resolves `/Key N 0 R` or `/Key [N 0 R ...]` reference lists in a dict. */
function refList(dict: string, key: string): number[] {
  const single = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict);
  const array = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(dict);
  if (array) {
    return [...array[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
  }
  return single ? [Number(single[1])] : [];
}

/** Reads a page's MediaBox, walking up `/Parent` when inherited. */
function mediaBox(
  dict: string,
  objects: Map<number, PdfObject>,
  depth = 0,
): [number, number, number, number] {
  const box = /\/MediaBox\s*\[\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s*\]/.exec(dict);
  if (box) return [Number(box[1]), Number(box[2]), Number(box[3]), Number(box[4])];
  const parent = refList(dict, 'Parent')[0];
  if (parent !== undefined && depth < 4) {
    const parentObj = objects.get(parent);
    if (parentObj) return mediaBox(parentObj.dict, objects, depth + 1);
  }
  return [0, 0, 612, 792];
}

type Token = number | string | { name: string } | { str: string } | Token[];

/** Tokenizes a PDF content stream (numbers, names, strings, arrays, operators). */
function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  const stack: Token[][] = [tokens];
  let i = 0;
  const n = content.length;
  while (i < n) {
    const ch = content[i];
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '%') {
      while (i < n && content[i] !== '\n') i += 1;
    } else if (ch === '(') {
      let depth = 1;
      let out = '';
      i += 1;
      while (i < n && depth > 0) {
        const c = content[i];
        if (c === '\\') {
          const next = content[i + 1];
          if (next === 'n') out += '\n';
          else if (next === 'r') out += '\r';
          else if (next === 't') out += '\t';
          else if (/[0-7]/.test(next)) {
            const oct = /^[0-7]{1,3}/.exec(content.slice(i + 1))![0];
            out += String.fromCharCode(parseInt(oct, 8));
            i += oct.length - 1;
          } else out += next;
          i += 2;
        } else if (c === '(') {
          depth += 1;
          out += c;
          i += 1;
        } else if (c === ')') {
          depth -= 1;
          if (depth > 0) out += c;
          i += 1;
        } else {
          out += c;
          i += 1;
        }
      }
      stack[stack.length - 1].push({ str: out });
    } else if (ch === '[') {
      const arr: Token[] = [];
      stack[stack.length - 1].push(arr);
      stack.push(arr);
      i += 1;
    } else if (ch === ']') {
      if (stack.length > 1) stack.pop();
      i += 1;
    } else if (ch === '<' && content[i + 1] === '<') {
      // Skip dictionaries (used by BDC/DP and inline-image prologs).
      let depth = 2;
      i += 2;
      while (i < n && depth > 0) {
        if (content[i] === '<') depth += 1;
        else if (content[i] === '>') depth -= 1;
        i += 1;
      }
    } else if (ch === '<') {
      const end = content.indexOf('>', i);
      const hex = content.slice(i + 1, end === -1 ? n : end).replace(/\s/g, '');
      let out = '';
      for (let h = 0; h + 1 < hex.length; h += 2) {
        out += String.fromCharCode(parseInt(hex.slice(h, h + 2), 16));
      }
      stack[stack.length - 1].push({ str: out });
      i = end === -1 ? n : end + 1;
    } else if (ch === '/') {
      const m = /^\/([^\s()<>[\]{}/%]*)/.exec(content.slice(i))!;
      stack[stack.length - 1].push({ name: m[1] });
      i += m[0].length;
    } else if (/[\d.+-]/.test(ch)) {
      const m = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(content.slice(i));
      if (m) {
        stack[stack.length - 1].push(Number(m[0]));
        i += m[0].length;
      } else {
        i += 1;
      }
    } else {
      const m = /^[A-Za-z'"*]+[0-1]?/.exec(content.slice(i));
      if (m) {
        stack[stack.length - 1].push(m[0]);
        i += m[0].length;
        // Inline images carry binary data; skip to the EI terminator.
        if (m[0] === 'BI') {
          const end = content.indexOf('EI', i);
          i = end === -1 ? n : end + 2;
        }
      } else {
        i += 1;
      }
    }
  }
  return tokens;
}

interface GState {
  ctm: Mat;
  stroke: string;
  fill: string;
  width: number;
}

/** Interprets one page's content stream into sketch strokes. */
function interpret(
  content: string,
  pageWidth: number,
  pageHeight: number,
  x0: number,
  y0: number,
): { strokes: Stroke[]; background?: string } {
  const strokes: Stroke[] = [];
  let background: string | undefined;

  let gs: GState = { ctm: IDENTITY, stroke: '#000000', fill: '#000000', width: 1 };
  const gsStack: GState[] = [];

  // Current path as subpaths of user-space points.
  let subpaths: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];

  // Text state.
  let inText = false;
  let fontSize = 12;
  let leading = 0;
  let tm: Mat = IDENTITY;
  let tlm: Mat = IDENTITY;
  let lastText: Stroke | null = null;
  let lastTextY = 0;

  const operands: Token[] = [];
  const numArg = (offset: number): number => {
    const v = operands[operands.length - 1 - offset];
    return typeof v === 'number' ? v : 0;
  };

  const toSketch = (p: { x: number; y: number }): Point => {
    const t = apply(gs.ctm, p.x, p.y);
    return { x: t.x - x0, y: pageHeight - (t.y - y0), pressure: 0.5 };
  };

  const flushPath = (mode: 'stroke' | 'fill'): void => {
    if (current.length > 0) subpaths.push(current);
    for (const sub of subpaths) {
      if (sub.length === 0) continue;
      const points = sub.map(toSketch);
      // A full-page filled rectangle is the exported paper background.
      if (mode === 'fill' && subpaths.length === 1 && isFullPageRect(points, pageWidth, pageHeight)) {
        background = gs.fill;
        continue;
      }
      strokes.push({
        id: createId('st'),
        tool: 'pen',
        color: mode === 'stroke' ? gs.stroke : gs.fill,
        width: mode === 'stroke' ? Math.max(0.5, gs.width * matScale(gs.ctm)) : 1,
        points,
        sharpened: true,
      });
    }
    subpaths = [];
    current = [];
  };

  const clearPath = (): void => {
    subpaths = [];
    current = [];
  };

  const closeSubpath = (): void => {
    if (current.length > 1) current.push({ ...current[0] });
  };

  const emitText = (raw: string): void => {
    const text = raw.replace(/\r/g, '');
    if (!text.trim()) return;
    const full = mul(tm, gs.ctm);
    const size = fontSize * matScale(full);
    const pos = apply(full, 0, 0);
    const x = pos.x - x0;
    const yTop = pageHeight - (pos.y - y0) - size * 0.8;

    // Merge consecutive lines of one text block into a multi-line item.
    if (
      lastText &&
      Math.abs(lastText.points[0].x - x) < 0.5 &&
      yTop > lastTextY &&
      yTop - lastTextY < size * 2.5
    ) {
      lastText.text += `\n${text}`;
      lastTextY = yTop;
      return;
    }

    const item: Stroke = {
      id: createId('tx'),
      tool: 'text',
      color: gs.fill,
      width: 1,
      points: [{ x, y: yTop, pressure: 0.5 }],
      text,
      fontSize: size,
      sharpened: true,
    };
    strokes.push(item);
    lastText = item;
    lastTextY = yTop;
  };

  for (const token of tokenize(content)) {
    if (typeof token !== 'string') {
      operands.push(token);
      continue;
    }
    switch (token) {
      case 'q':
        gsStack.push({ ...gs });
        break;
      case 'Q':
        gs = gsStack.pop() ?? gs;
        break;
      case 'cm':
        gs.ctm = mul([numArg(5), numArg(4), numArg(3), numArg(2), numArg(1), numArg(0)], gs.ctm);
        break;
      case 'w':
        gs.width = numArg(0);
        break;
      case 'RG':
        gs.stroke = toHex(numArg(2), numArg(1), numArg(0));
        break;
      case 'rg':
        gs.fill = toHex(numArg(2), numArg(1), numArg(0));
        break;
      case 'G':
        gs.stroke = toHex(numArg(0), numArg(0), numArg(0));
        break;
      case 'g':
        gs.fill = toHex(numArg(0), numArg(0), numArg(0));
        break;
      case 'K':
      case 'k': {
        const [c, m, y, kk] = [numArg(3), numArg(2), numArg(1), numArg(0)];
        const hex = toHex((1 - c) * (1 - kk), (1 - m) * (1 - kk), (1 - y) * (1 - kk));
        if (token === 'K') gs.stroke = hex;
        else gs.fill = hex;
        break;
      }
      case 'SC':
      case 'SCN':
      case 'sc':
      case 'scn': {
        const nums = operands.filter((o): o is number => typeof o === 'number');
        if (nums.length >= 3) {
          const hex = toHex(nums[nums.length - 3], nums[nums.length - 2], nums[nums.length - 1]);
          if (token === 'SC' || token === 'SCN') gs.stroke = hex;
          else gs.fill = hex;
        } else if (nums.length === 1) {
          const hex = toHex(nums[0], nums[0], nums[0]);
          if (token === 'SC' || token === 'SCN') gs.stroke = hex;
          else gs.fill = hex;
        }
        break;
      }
      case 'm':
        if (current.length > 0) subpaths.push(current);
        current = [{ x: numArg(1), y: numArg(0) }];
        break;
      case 'l':
        current.push({ x: numArg(1), y: numArg(0) });
        break;
      case 'c':
      case 'v':
      case 'y': {
        const start = current[current.length - 1] ?? { x: 0, y: 0 };
        const end = { x: numArg(1), y: numArg(0) };
        let c1: { x: number; y: number };
        let c2: { x: number; y: number };
        if (token === 'c') {
          c1 = { x: numArg(5), y: numArg(4) };
          c2 = { x: numArg(3), y: numArg(2) };
        } else if (token === 'v') {
          c1 = start;
          c2 = { x: numArg(3), y: numArg(2) };
        } else {
          c1 = { x: numArg(3), y: numArg(2) };
          c2 = end;
        }
        for (let s = 1; s <= 8; s++) {
          const t = s / 8;
          const u = 1 - t;
          current.push({
            x: u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
            y: u * u * u * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
          });
        }
        break;
      }
      case 're': {
        if (current.length > 0) subpaths.push(current);
        const [x, y, w, h] = [numArg(3), numArg(2), numArg(1), numArg(0)];
        subpaths.push([
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
          { x, y },
        ]);
        current = [];
        break;
      }
      case 'h':
        closeSubpath();
        break;
      case 'S':
        flushPath('stroke');
        break;
      case 's':
        closeSubpath();
        flushPath('stroke');
        break;
      case 'f':
      case 'F':
      case 'f*':
        flushPath('fill');
        break;
      case 'B':
      case 'B*':
        flushPath('stroke');
        break;
      case 'b':
      case 'b*':
        closeSubpath();
        flushPath('stroke');
        break;
      case 'n':
        clearPath();
        break;
      case 'BT':
        inText = true;
        tm = IDENTITY;
        tlm = IDENTITY;
        lastText = null;
        break;
      case 'ET':
        inText = false;
        lastText = null;
        break;
      case 'Tf':
        fontSize = numArg(0);
        break;
      case 'TL':
        leading = numArg(0);
        break;
      case 'Tm':
        tm = [numArg(5), numArg(4), numArg(3), numArg(2), numArg(1), numArg(0)];
        tlm = tm;
        break;
      case 'Td':
        tlm = mul([1, 0, 0, 1, numArg(1), numArg(0)], tlm);
        tm = tlm;
        break;
      case 'TD':
        leading = -numArg(0);
        tlm = mul([1, 0, 0, 1, numArg(1), numArg(0)], tlm);
        tm = tlm;
        break;
      case 'T*':
        tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        break;
      case 'Tj': {
        const arg = operands[operands.length - 1];
        if (inText && arg && typeof arg === 'object' && 'str' in arg) emitText(arg.str);
        break;
      }
      case "'":
      case '"': {
        tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        const arg = operands[operands.length - 1];
        if (inText && arg && typeof arg === 'object' && 'str' in arg) emitText(arg.str);
        break;
      }
      case 'TJ': {
        const arg = operands[operands.length - 1];
        if (inText && Array.isArray(arg)) {
          const text = arg
            .map((t) => (t && typeof t === 'object' && 'str' in t ? t.str : ''))
            .join('');
          emitText(text);
        }
        break;
      }
      default:
        break;
    }
    operands.length = 0;
  }

  return { strokes, background };
}

function isFullPageRect(points: Point[], width: number, height: number): boolean {
  if (points.length < 4 || points.length > 5) return false;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return (
    Math.min(...xs) <= 1 &&
    Math.min(...ys) <= 1 &&
    Math.max(...xs) >= width - 1 &&
    Math.max(...ys) >= height - 1
  );
}

/**
 * Parses a PDF file into pages of sketch strokes.
 *
 * @throws Error when the data is not a PDF or holds no readable pages.
 */
export function importPdf(data: Buffer | Uint8Array): ImportedPdfPage[] {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!buffer.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
    throw new Error('Not a PDF document.');
  }

  const objects = scanObjects(buffer);
  const pages: ImportedPdfPage[] = [];

  // Preserve document page order via the pages tree when possible.
  const isPage = (obj: PdfObject): boolean =>
    /\/Type\s*\/Page\b/.test(obj.dict) && !/\/Type\s*\/Pages\b/.test(obj.dict);
  const seen = new Set<number>();
  const pageNums: number[] = [];
  for (const obj of objects.values()) {
    if (!/\/Type\s*\/Pages\b/.test(obj.dict)) continue;
    for (const kid of refList(obj.dict, 'Kids')) {
      const kidObj = objects.get(kid);
      if (kidObj && isPage(kidObj) && !seen.has(kid)) {
        seen.add(kid);
        pageNums.push(kid);
      }
    }
  }
  if (pageNums.length === 0) {
    for (const [num, obj] of objects) {
      if (isPage(obj)) pageNums.push(num);
    }
  }

  for (const pageNum of pageNums) {
    const page = objects.get(pageNum);
    if (!page) continue;
    const [bx0, by0, bx1, by1] = mediaBox(page.dict, objects);
    const width = Math.abs(bx1 - bx0);
    const height = Math.abs(by1 - by0);

    let content = '';
    for (const ref of refList(page.dict, 'Contents')) {
      const stream = objects.get(ref);
      if (!stream) continue;
      const bytes = decodeStream(stream);
      if (bytes) content += `${bytes.toString('latin1')}\n`;
    }
    if (!content) continue;

    const { strokes, background } = interpret(content, width, height, bx0, by0);
    pages.push({ width, height, background, strokes });
  }

  if (pages.length === 0) {
    throw new Error('No importable vector content found in the PDF.');
  }
  return pages;
}
