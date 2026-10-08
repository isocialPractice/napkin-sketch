/**
 * Hyphenation (src/core/type/hyphenate.ts): Liang's algorithm over the en-US
 * patterns, held to documented TeX output, and to Illustrator's limits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HYPHENATION_NOTICE, hyphenate, hyphenationPoints, ILLUSTRATOR_LIMITS, TEX_LIMITS } from '../src/core/type/hyphenate.js';

test("ten words break where TeX's patterns and exceptions say, with TeX's limits", () => {
  const cases: Array<[string, string]> = [
    // The pattern file's own known_bugs entry, which only these exact patterns, read faithfully, give.
    ['democrat', 'de-mo-c-rat'],
    // plain.tex's exceptions.
    ['associate', 'as-so-ciate'],
    ['table', 'ta-ble'],
    ['recognizance', 're-cog-ni-zance'],
    ['presents', 'presents'],
    // The TeXbook, appendix H.
    ['hyphenation', 'hy-phen-ation'],
    ['supercalifragilisticexpialidocious', 'su-per-cal-ifrag-ilis-tic-ex-pi-ali-do-cious'],
    ['university', 'uni-ver-sity'],
    ['typography', 'ty-pog-ra-phy'],
    ['mathematics', 'math-e-mat-ics'],
  ];
  for (const [word, broken] of cases) assert.equal(hyphenate(word, TEX_LIMITS).join('-'), broken, word);
});

test("Illustrator's limits: words of 6 letters or more, 2 before a hyphen and 2 after", () => {
  assert.deepEqual(ILLUSTRATOR_LIMITS, { minWord: 6, before: 2, after: 2 });
  assert.equal(hyphenate('university').join('-'), 'uni-ver-si-ty', 'two after, where TeX keeps three');
  assert.equal(hyphenate('table').join('-'), 'table', 'five letters is too short');
  assert.equal(hyphenate('napkin').join('-'), 'nap-kin', 'six is enough');
  // The points are indices into the word, a hyphen going before the letter at each.
  assert.deepEqual(hyphenationPoints('university'), [3, 6, 8]);
  // Case is kept; anything but a to z is left whole.
  assert.equal(hyphenate('Typesetting').join('-'), 'Type-set-ting');
  assert.deepEqual(hyphenationPoints("don't-stop"), []);
  assert.deepEqual(hyphenationPoints('caféterias'), []);
  assert.match(HYPHENATION_NOTICE.license, /provided the copyright notice and this notice are preserved/);
});
