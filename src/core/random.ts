/**
 * Seeded randomness: the same numbers from the same seed, everywhere a
 * drawing has to come out the same every time it is drawn - a Pencil mark's
 * grain, a Splatter's hatch.
 */

/** A small, fast, seeded generator (mulberry32): numbers from 0 up to 1, the same from the same seed everywhere. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
