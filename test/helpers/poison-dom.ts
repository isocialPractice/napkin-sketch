/**
 * A DOM that exists and refuses every use.
 *
 * Node has no `document`, so headless code that reaches for one already fails
 * with a ReferenceError - until a test environment supplies a DOM, or a
 * `typeof document` guard quietly takes another branch. Globals that are
 * defined but throw on first touch close both gaps: a guarded branch is taken
 * and throws, and the message names what was touched.
 *
 * Import it for its side effect, before anything under test, so the poison is
 * already in place while those modules evaluate.
 */

/** The browser globals a headless path must never touch. */
export const POISONED_GLOBALS = [
  'document',
  'window',
  'DOMParser',
  'XMLSerializer',
  'Image',
  'HTMLCanvasElement',
  'OffscreenCanvas',
  'getComputedStyle',
  'requestAnimationFrame',
] as const;

function refuse(what: string): never {
  throw new Error(`a headless path touched the DOM: ${what}`);
}

function poisoned(name: string): unknown {
  // A function target, so a call and a `new` are trapped as well as a read.
  const target = function poison(): void {};
  return new Proxy(target, {
    get: (_t, prop) => refuse(`${name}.${String(prop)}`),
    set: (_t, prop) => refuse(`${name}.${String(prop)} =`),
    has: (_t, prop) => refuse(`${String(prop)} in ${name}`),
    apply: () => refuse(`${name}()`),
    construct: () => refuse(`new ${name}()`),
    ownKeys: () => refuse(`the keys of ${name}`),
    getOwnPropertyDescriptor: (_t, prop) => refuse(`${name}.${String(prop)}`),
    defineProperty: (_t, prop) => refuse(`${name}.${String(prop)} =`),
    deleteProperty: (_t, prop) => refuse(`delete ${name}.${String(prop)}`),
    getPrototypeOf: () => refuse(`the prototype of ${name}`),
    setPrototypeOf: () => refuse(`the prototype of ${name}`),
  });
}

for (const name of POISONED_GLOBALS) {
  Object.defineProperty(globalThis, name, {
    value: poisoned(name),
    configurable: true,
    enumerable: false,
    writable: false,
  });
}
