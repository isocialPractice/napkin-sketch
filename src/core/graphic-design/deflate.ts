/**
 * A small, dependency-free DEFLATE codec (RFC 1951) and its zlib wrapper
 * (RFC 1950).
 *
 * PNG needs both directions - compress to write a file, decompress to place
 * one - and the repository has no runtime dependencies and would like to keep
 * it that way. Node's `zlib` would do the job, but only in Node, and the rest
 * of the graphic-design API is browser-safe; a hundred and fifty lines of
 * Huffman coding buys the whole subsystem one story instead of two.
 *
 * The compressor emits fixed-Huffman blocks with greedy LZ77 matching. That is
 * a few percent larger than a dynamic-Huffman encoder on text and within a
 * whisker of it on the flat colour a vector composition rasterizes to, which
 * is the case that matters here.
 */

/** Bit-level writer, least-significant bit first, as DEFLATE packs. */
class BitWriter {
  private bytes: number[] = [];
  private bitBuffer = 0;
  private bitCount = 0;

  /** Writes `count` bits of `value`, least significant bit first. */
  write(value: number, count: number): void {
    this.bitBuffer |= (value & ((1 << count) - 1)) << this.bitCount;
    this.bitCount += count;
    while (this.bitCount >= 8) {
      this.bytes.push(this.bitBuffer & 0xff);
      this.bitBuffer >>>= 8;
      this.bitCount -= 8;
    }
  }

  /** Writes a Huffman code, whose bits travel most significant first. */
  writeCode(code: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.write((code >>> i) & 1, 1);
  }

  /** Pads the final partial byte with zeros and returns the bytes. */
  finish(): Uint8Array {
    if (this.bitCount > 0) this.bytes.push(this.bitBuffer & 0xff);
    return Uint8Array.from(this.bytes);
  }
}

/** Length codes 257-285: the base length each one stands for. */
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
/** Extra bits carried after each length code. */
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
/** Distance codes 0-29: the base distance each one stands for. */
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
/** Extra bits carried after each distance code. */
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];

/** Emits a literal byte under the fixed literal/length code. */
function writeLiteral(out: BitWriter, byte: number): void {
  if (byte < 144) out.writeCode(0x30 + byte, 8);
  else out.writeCode(0x190 + byte - 144, 9);
}

/** Emits a length/distance pair under the fixed codes. */
function writeMatch(out: BitWriter, length: number, distance: number): void {
  let lc = LENGTH_BASE.length - 1;
  while (lc > 0 && LENGTH_BASE[lc] > length) lc--;
  const symbol = 257 + lc;
  if (symbol < 280) out.writeCode(symbol - 256, 7);
  else out.writeCode(0xc0 + symbol - 280, 8);
  if (LENGTH_EXTRA[lc] > 0) out.write(length - LENGTH_BASE[lc], LENGTH_EXTRA[lc]);

  let dc = DIST_BASE.length - 1;
  while (dc > 0 && DIST_BASE[dc] > distance) dc--;
  out.writeCode(dc, 5);
  if (DIST_EXTRA[dc] > 0) out.write(distance - DIST_BASE[dc], DIST_EXTRA[dc]);
}

const WINDOW = 32768;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;
const MAX_CHAIN = 64;

/** Compresses bytes into a raw DEFLATE stream. */
export function deflateRaw(input: Uint8Array): Uint8Array {
  const out = new BitWriter();
  // One fixed-Huffman block for the whole input: final = 1, type = 01.
  out.write(1, 1);
  out.write(1, 2);

  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(input.length).fill(-1);
  const hashAt = (i: number): number =>
    ((input[i] << 10) ^ (input[i + 1] << 5) ^ input[i + 2]) & (HASH_SIZE - 1);

  let i = 0;
  while (i < input.length) {
    let bestLength = 0;
    let bestDistance = 0;
    if (i + MIN_MATCH <= input.length) {
      const h = hashAt(i);
      let candidate = head[h];
      let chain = 0;
      while (candidate >= 0 && i - candidate <= WINDOW && chain++ < MAX_CHAIN) {
        let length = 0;
        const limit = Math.min(MAX_MATCH, input.length - i);
        while (length < limit && input[candidate + length] === input[i + length]) length++;
        if (length > bestLength) {
          bestLength = length;
          bestDistance = i - candidate;
          if (length >= limit) break;
        }
        candidate = prev[candidate];
      }
      prev[i] = head[h];
      head[h] = i;
    }

    if (bestLength >= MIN_MATCH) {
      writeMatch(out, bestLength, bestDistance);
      // Register the positions the match covered so later matches can find them.
      for (let k = 1; k < bestLength; k++) {
        const j = i + k;
        if (j + MIN_MATCH <= input.length) {
          const h = hashAt(j);
          prev[j] = head[h];
          head[h] = j;
        }
      }
      i += bestLength;
    } else {
      writeLiteral(out, input[i]);
      i++;
    }
  }

  out.writeCode(0, 7); // end of block
  return out.finish();
}

/** Adler-32, the checksum a zlib stream ends with. */
export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Wraps a DEFLATE stream in the zlib header and checksum PNG expects. */
export function zlibDeflate(input: Uint8Array): Uint8Array {
  const body = deflateRaw(input);
  const out = new Uint8Array(body.length + 6);
  out[0] = 0x78; // deflate, 32K window
  out[1] = 0x01; // no dictionary, fastest-compression level bits, valid check
  out.set(body, 2);
  const sum = adler32(input);
  out[out.length - 4] = (sum >>> 24) & 0xff;
  out[out.length - 3] = (sum >>> 16) & 0xff;
  out[out.length - 2] = (sum >>> 8) & 0xff;
  out[out.length - 1] = sum & 0xff;
  return out;
}

/** A canonical Huffman decoding table built from a list of code lengths. */
interface HuffmanTable {
  counts: Int32Array;
  symbols: Int32Array;
}

function buildHuffman(lengths: Uint8Array): HuffmanTable {
  const counts = new Int32Array(16);
  for (const len of lengths) counts[len]++;
  counts[0] = 0;
  const offsets = new Int32Array(16);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + counts[i - 1];
  const symbols = new Int32Array(lengths.length);
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    if (lengths[symbol]) symbols[offsets[lengths[symbol]]++] = symbol;
  }
  return { counts, symbols };
}

/** Bit-level reader, least-significant bit first. */
class BitReader {
  offset = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(private readonly data: Uint8Array) {}

  bits(count: number): number {
    while (this.bitCount < count) {
      if (this.offset >= this.data.length) throw new Error('graphic-design: truncated deflate stream');
      this.bitBuffer |= this.data[this.offset++] << this.bitCount;
      this.bitCount += 8;
    }
    const value = this.bitBuffer & ((1 << count) - 1);
    this.bitBuffer >>>= count;
    this.bitCount -= count;
    return value;
  }

  align(): void {
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  /** Decodes one symbol, walking the canonical code one bit at a time. */
  symbol(table: HuffmanTable): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let length = 1; length < 16; length++) {
      code |= this.bits(1);
      const count = table.counts[length];
      if (code - first < count) return table.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('graphic-design: invalid Huffman code');
  }

  /** Reads whole bytes, after `align`, for a stored block. */
  bytes(count: number): Uint8Array {
    const slice = this.data.subarray(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }
}

const FIXED_LITERALS = (() => {
  const lengths = new Uint8Array(288);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);
  return buildHuffman(lengths);
})();

const FIXED_DISTANCES = buildHuffman(new Uint8Array(30).fill(5));

const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Decompresses a raw DEFLATE stream. */
export function inflateRaw(input: Uint8Array): Uint8Array {
  const reader = new BitReader(input);
  const out: number[] = [];
  let final = 0;

  do {
    final = reader.bits(1);
    const type = reader.bits(2);
    if (type === 0) {
      reader.align();
      const length = input[reader.offset] | (input[reader.offset + 1] << 8);
      reader.offset += 4; // length, then its one's complement
      const stored = reader.bytes(length);
      for (let i = 0; i < stored.length; i++) out.push(stored[i]);
      continue;
    }

    let literals = FIXED_LITERALS;
    let distances = FIXED_DISTANCES;
    if (type === 2) {
      const hlit = reader.bits(5) + 257;
      const hdist = reader.bits(5) + 1;
      const hclen = reader.bits(4) + 4;
      const codeLengths = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) codeLengths[CODE_LENGTH_ORDER[i]] = reader.bits(3);
      const codeTable = buildHuffman(codeLengths);

      const lengths = new Uint8Array(hlit + hdist);
      let i = 0;
      while (i < lengths.length) {
        const symbol = reader.symbol(codeTable);
        if (symbol < 16) {
          lengths[i++] = symbol;
        } else if (symbol === 16) {
          const repeat = 3 + reader.bits(2);
          const previous = lengths[i - 1];
          for (let k = 0; k < repeat; k++) lengths[i++] = previous;
        } else if (symbol === 17) {
          i += 3 + reader.bits(3);
        } else {
          i += 11 + reader.bits(7);
        }
      }
      literals = buildHuffman(lengths.subarray(0, hlit));
      distances = buildHuffman(lengths.subarray(hlit));
    } else if (type === 3) {
      throw new Error('graphic-design: reserved deflate block type');
    }

    for (;;) {
      const symbol = reader.symbol(literals);
      if (symbol === 256) break;
      if (symbol < 256) {
        out.push(symbol);
        continue;
      }
      const lc = symbol - 257;
      const length = LENGTH_BASE[lc] + reader.bits(LENGTH_EXTRA[lc]);
      const dc = reader.symbol(distances);
      const distance = DIST_BASE[dc] + reader.bits(DIST_EXTRA[dc]);
      const start = out.length - distance;
      for (let k = 0; k < length; k++) out.push(out[start + k]);
    }
  } while (!final);

  return Uint8Array.from(out);
}

/** Unwraps a zlib stream and decompresses it. */
export function zlibInflate(input: Uint8Array): Uint8Array {
  if (input.length < 6) throw new Error('graphic-design: zlib stream too short');
  const method = input[0] & 0x0f;
  if (method !== 8) throw new Error(`graphic-design: unsupported zlib method ${method}`);
  if ((input[1] & 0x20) !== 0) throw new Error('graphic-design: zlib preset dictionaries are not supported');
  return inflateRaw(input.subarray(2, input.length - 4));
}
