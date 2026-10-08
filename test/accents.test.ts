/**
 * Clean Language Accents (core/type/accents.ts): highlight.js's HTML read
 * into colored runs and never rendered; the two themes' contrast, every
 * scope's color on its own shade; Python and TypeScript read into their
 * keywords; detection off until asked for; the catalog of 193 as highlight.js
 * has it; a paragraph's accent live through an edit; Markdown's fenced code,
 * a language installed and taken away; the theme a page's paper picks; and
 * the script's `accent`, drawn and written back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { readers } from '../src/markdown/core.js';
import {
  ACCENT_LANGUAGES,
  ACCENT_SCOPES,
  ACCENT_THEMES,
  COMMON_ACCENT_LANGUAGES,
  accentLanguage,
  accentOptions,
  accentRuns,
  accentShown,
  accentThemeFor,
  applyAccent,
  contrastRatio,
  currentAccentTheme,
  hasAccent,
  hljsHtmlToRuns,
  paragraphSpan,
  setAccentOptions,
  withAccentPage,
  type AccentRole,
} from '../src/core/type/accents.js';
import { markdownMissing, markdownToType } from '../src/core/type/markdown-flow.js';
import { layoutType } from '../src/core/type/layout.js';
import { spliceText, styleSegments } from '../src/core/type/model.js';
import { defaultSettings, normalizeSettings } from '../src/core/settings.js';
import { createSketch, type Stroke } from '../src/core/types.js';
import { sketchToSvg } from '../src/core/sketch-svg.js';
import { evaluate, formatScript, sketchToInstructions } from '../src/core/script/index.js';
import { repoRoot } from './helpers/repo-root.js';

/** A text at 10, 20 in 16 px, its paragraphs accented as `accent`. */
function accented(text: string, accent: string, id = 'code'): Stroke {
  const paras = text.split('\n').map(() => ({ accent }));
  return { id, tool: 'text', color: '#1f2328', width: 1, points: [{ x: 10, y: 20 }], text, fontSize: 16, typeset: { kind: 'point', paras } };
}

/** The color each character is drawn in. */
function colorsOf(stroke: Stroke): string[] {
  const text = stroke.text ?? '';
  const out = new Array<string>(text.length);
  for (const segment of styleSegments(accentShown(stroke) ?? stroke)) out.fill(segment.attrs.color, segment.start, segment.end);
  return out;
}

const light = ACCENT_THEMES.light.colors;

test('highlight.js HTML reads into the text it highlighted and its colored runs, nested spans and entities, and nothing else is HTML', () => {
  const html = '<span class="hljs-keyword">if</span> (a &lt; b &amp;&amp; c &gt; &quot;d&quot; &#x27;e&#x27;) <span class="hljs-string">`x<span class="hljs-subst">${n}</span>`</span>';
  const read = hljsHtmlToRuns(html, ACCENT_THEMES.light);
  assert.equal(read.text, 'if (a < b && c > "d" \'e\') `x${n}`');
  assert.deepEqual(
    read.runs.map((run) => [read.text.slice(run.start, run.end), run.scope, run.color]),
    [
      ['if', 'keyword', light.keyword],
      ['`x', 'string', light.string],
      ['`', 'string', light.string],
    ],
    'a substitution inside a string is plain again',
  );
  const nested = hljsHtmlToRuns('<span class="hljs-title class_ inherited__">Base</span> <span class="hljs-title function_">go</span>', ACCENT_THEMES.light);
  assert.deepEqual(nested.runs.map((run) => run.scope), ['title.class.inherited', 'title.function']);
  assert.deepEqual(nested.runs.map((run) => run.color), [light.type, light.title]);
  const hostile = hljsHtmlToRuns('<script>alert(1)</script><img src=x onerror=y> &copy; <span class="hljs-number">1</span>', ACCENT_THEMES.light);
  assert.equal(hostile.text, '<script>alert(1)</script><img src=x onerror=y> &copy; 1', 'every other tag and entity is text');
  assert.deepEqual(hostile.runs, [{ start: hostile.text.length - 1, end: hostile.text.length, scope: 'number', color: light.number }]);
});

test('each theme gives every scope a color that stands 4.5:1 from its own shade, as its plain text does', () => {
  const roles = new Set(Object.values(ACCENT_SCOPES).filter((role): role is AccentRole => role !== 'base' && role !== 'inherit'));
  for (const theme of Object.values(ACCENT_THEMES)) {
    assert.ok(contrastRatio(theme.base, theme.shade) >= 4.5, `${theme.name}'s plain text`);
    for (const role of roles) {
      const ratio = contrastRatio(theme.colors[role], theme.shade);
      assert.ok(ratio >= 4.5, `${theme.name} ${role} ${theme.colors[role]} on ${theme.shade} is ${ratio.toFixed(2)}:1`);
    }
  }
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff') * 10) / 10, 21);
});

test('Python and TypeScript read into their keywords, strings, numbers, comments, names and types', () => {
  const py = 'def greet(name):\n    return "Hi " + name  # say it\n';
  const pyRuns = accentRuns(py, 'python', ACCENT_THEMES.light);
  assert.equal(pyRuns.language, 'python');
  const words = (code: string, runs: typeof pyRuns.runs, color: string): string[] => runs.filter((run) => run.color === color).map((run) => code.slice(run.start, run.end));
  assert.deepEqual(words(py, pyRuns.runs, light.keyword), ['def', 'return']);
  assert.deepEqual(words(py, pyRuns.runs, light.string), ['"Hi "']);
  assert.deepEqual(words(py, pyRuns.runs, light.comment), ['# say it']);
  assert.deepEqual(words(py, pyRuns.runs, light.title), ['greet']);
  const ts = 'class Box extends Base {\n  size: number = 2;\n}\n';
  const tsRuns = accentRuns(ts, 'ts', ACCENT_THEMES.light);
  assert.equal(tsRuns.language, 'typescript', 'a fence name resolves to its language');
  assert.deepEqual(words(ts, tsRuns.runs, light.keyword), ['class', 'extends']);
  assert.deepEqual(words(ts, tsRuns.runs, light.type), ['Box', 'Base', 'number']);
  assert.deepEqual(words(ts, tsRuns.runs, light.number), ['size', '2'], 'a property is blue, as a number is');
  // A function's header is wrapped whole: only the names in it are colored, as GitHub's theme has it.
  const arrow = 'orders.reduce((n, o) => n + o.total, 0);\n';
  assert.deepEqual(words(arrow, accentRuns(arrow, 'ts', ACCENT_THEMES.light).runs, light.title), ['reduce'], 'an arrow function\'s parentheses and arrow stay plain');
  const method = 'public Order Find(int id) { return null; }\n';
  assert.deepEqual(words(method, accentRuns(method, 'csharp', ACCENT_THEMES.light).runs, light.title), ['Find'], 'and a method\'s return type is no title');
  assert.deepEqual(accentRuns('x = 1', 'none').runs, []);
  assert.equal(accentRuns('x = 1', 'fortran').missing, 'fortran', 'a language not installed is named');
});

test('detecting unlabelled code is off until asked for; asked, an unlabelled Markdown block is read for its language', () => {
  assert.equal(accentOptions().detect, false);
  assert.equal(defaultSettings().accentDetect, false);
  const source = '```\nconst total = items.reduce((sum, item) => sum + item.price, 0);\nconsole.log(`Total: ${total}`);\n```';
  const colored = (md: ReturnType<typeof markdownToType>): boolean => md.runs.some((run) => run.attrs.color === light.keyword);
  assert.equal(colored(markdownToType(source)), false, 'unlabelled, it stays plain');
  setAccentOptions({ detect: true });
  try {
    assert.equal(colored(markdownToType(source)), true, 'detected, its keywords are colored');
  } finally {
    setAccentOptions({ detect: false });
  }
});

test('the catalog lists the 193 languages highlight.js has, 36 of them common, with their names and aliases', () => {
  assert.equal(ACCENT_LANGUAGES.length, 193);
  assert.equal(COMMON_ACCENT_LANGUAGES.length, 36);
  const require = createRequire(__filename);
  const dir = join(repoRoot(), 'node_modules', 'highlight.js', 'lib', 'languages');
  const ids = readdirSync(dir)
    .filter((file) => file.endsWith('.js') && !file.endsWith('.js.js'))
    .map((file) => file.replace(/\.js$/, ''))
    .sort();
  assert.deepEqual(ACCENT_LANGUAGES.map((language) => language.id), ids, 'run `npm run accent-languages` after upgrading highlight.js');
  const common = require(join(repoRoot(), 'node_modules', 'highlight.js', 'lib', 'common.js')) as { listLanguages(): string[] };
  assert.deepEqual([...COMMON_ACCENT_LANGUAGES].sort(), common.listLanguages().sort());
  assert.equal(accentLanguage('C++')?.id, 'cpp');
  assert.equal(accentLanguage('py')?.name, 'Python');
  assert.equal(accentLanguage('python3'), null);
  assert.deepEqual(normalizeSettings({ accentLanguages: ['python', 'nope', 'python', 'fortran'] }).accentLanguages, ['python', 'fortran']);
  assert.deepEqual(defaultSettings().accentLanguages, [...COMMON_ACCENT_LANGUAGES]);
});

test('an accent is live: the colors are worked out as the text is laid out, so an edit re-colors it', () => {
  const stroke = accented('x = 1\ny = "s"', 'python');
  const before = colorsOf(stroke);
  assert.equal(before[4], light.number, 'the 1 is a number');
  assert.equal(before[10], light.string, 'the string');
  assert.equal(before[0], '#1f2328', 'a plain name keeps its own color');
  // Typed into: `x = 1` becomes `if x = 1`, and the `if` is a keyword at once.
  const edited = spliceText(stroke, 0, 0, 'if ');
  const after = colorsOf(edited);
  assert.equal(after[0], light.keyword);
  assert.equal(after[7], light.number, 'the number moved with its text');
  assert.equal(edited.typeset?.paras?.[0]?.accent, 'python', 'the accent stays on the paragraph, not in the runs');
  assert.equal(edited.typeset?.runs, undefined, 'and no color is stored');
  const layout = layoutType(stroke);
  assert.equal(layout.glyphs.find((glyph) => glyph.ch === '1')?.color, light.number, 'the layout draws the colors');
  // A comment that runs across two accented lines is read as one piece of code.
  const block = colorsOf(accented('/* one\ntwo */ int x;', 'c'));
  assert.equal(block[8], light.comment, 'the comment reaches the second line');
});

test('an accent goes on the paragraphs a stretch touches, Markdown Code with them, and comes off', () => {
  const plain: Stroke = { id: 'p', tool: 'text', color: '#1f2328', width: 1, points: [{ x: 0, y: 0 }], text: 'intro\nx = 1\ny = 2\noutro', fontSize: 16 };
  assert.deepEqual(paragraphSpan(plain.text!, 7, 13), { start: 6, end: 17 });
  const code = { id: 'tc_markdown_code', name: 'Markdown Code', attrs: { fontFamily: 'Consolas, "Courier New", monospace' } };
  const on = applyAccent(plain, { start: 7, end: 13 }, 'python', code);
  assert.deepEqual(on.typeset?.paras?.map((para) => para?.accent ?? null), [null, 'python', 'python']);
  assert.ok(hasAccent(on, 8, 8) && !hasAccent(on, 0, 2), 'the accented paragraphs, and not the first');
  assert.equal(styleSegments(on).find((segment) => segment.start <= 6 && segment.end > 6)?.attrs.config, 'tc_markdown_code', 'the code follows Markdown Code');
  const off = applyAccent(on, { start: 0, end: on.text!.length }, null);
  assert.equal(hasAccent(off, 0, off.text!.length), false);
});

test('Markdown\'s fenced code is colored when its language is installed, named when it is not, and colored once it is', () => {
  const source = '```ts\nconst a = 1;\n```\n\n```fortran\nx = 1\n```';
  const md = markdownToType(source);
  const first = md.runs.find((run) => run.start === 0);
  assert.equal(first?.attrs.color, light.keyword, 'TypeScript: const is a keyword');
  assert.equal(md.paras[0]?.shade, ACCENT_THEMES.light.shade);
  const stroke: Stroke = { id: 'md', tool: 'text', color: '#1f2328', width: 1, points: [{ x: 0, y: 0 }], text: source, fontSize: 16, typeset: { kind: 'point', flow: 'markdown' } };
  assert.deepEqual(markdownMissing(stroke).map((missing) => missing.language), ['fortran']);
  const require = createRequire(__filename);
  const fortran = require(join(repoRoot(), 'node_modules', 'highlight.js', 'lib', 'languages', 'fortran.js'));
  assert.equal(readers.registerAccentLanguage('fortran', fortran), true);
  try {
    assert.deepEqual(markdownMissing(stroke), [], 'installed, nothing is missing');
    const colored = markdownToType(source);
    assert.ok(colored.runs.some((run) => run.start >= colored.text.indexOf('x = 1') && run.attrs.color === light.number), 'fortran is colored');
  } finally {
    readers.unregisterAccentLanguage('fortran');
  }
  assert.deepEqual(markdownMissing(stroke).map((missing) => missing.language), ['fortran'], 'taken away, it is plain again');
  assert.equal(readers.registerAccentLanguage('fortran'), false, 'a language beyond the common set needs its definition');
  readers.unregisterAccentLanguage('python');
  try {
    assert.equal(accentRuns('x = 1', 'python').missing, 'python');
  } finally {
    assert.equal(readers.registerAccentLanguage('python'), true, 'a common language comes back from the app\'s own');
  }
  assert.equal(accentRuns('x = 1', 'python').language, 'python');
});

test('the theme follows the page\'s paper unless one is asked for, and output colors each page for its own', () => {
  assert.equal(accentThemeFor('#ffffff').id, 'light');
  assert.equal(accentThemeFor('#d9c49a').id, 'light', 'kraft paper reads dark ink');
  assert.equal(accentThemeFor('#1f2328').id, 'dark');
  assert.equal(accentThemeFor(undefined).id, 'light');
  assert.equal(accentThemeFor('#ffffff', 'dark').id, 'dark');
  assert.equal(withAccentPage('#101010', () => currentAccentTheme().id), 'dark');
  const page = (background: string): string => {
    const sketch = createSketch('code');
    sketch.background = background;
    sketch.strokes.push({ ...accented('x = 1', 'python'), layer: sketch.layers[0].id });
    return sketchToSvg(sketch);
  };
  assert.match(page('#ffffff'), new RegExp(`fill="${light.number}"`));
  assert.match(page('#151515'), new RegExp(`fill="${ACCENT_THEMES.dark.colors.number}"`));
  setAccentOptions({ theme: 'dark' });
  try {
    assert.match(page('#ffffff'), new RegExp(`fill="${ACCENT_THEMES.dark.colors.number}"`), 'Napkin Dark asked for');
  } finally {
    setAccentOptions({ theme: 'auto' });
  }
});

test('a script\'s `accent` colors the next text, says when nothing takes it, and is written back', () => {
  const run = evaluate('napkin 1\naccent "c++"\ntext "int x = 1;" at 20 40\naccent python\n');
  assert.equal(run.ok, true);
  const text = run.book.sketches[0].strokes.find((stroke) => stroke.tool === 'text')!;
  assert.deepEqual(text.typeset?.paras, [{ accent: 'cpp' }], 'a name no word spells, in quotes, kept as the language\'s id');
  assert.deepEqual(run.diagnostics.map((d) => d.code), ['unused-accent']);
  const written = formatScript(sketchToInstructions(run.book.sketches[0], { decimals: null }).script);
  assert.match(written, /^accent cpp\ntext "int x = 1;" at 20 40$/m);
  assert.deepEqual(evaluate(written).book.sketches[0].strokes.find((stroke) => stroke.tool === 'text')?.typeset?.paras, [{ accent: 'cpp' }], 'and drawn again the same');
  const bad = evaluate('napkin 1\naccent pyton\ntext "x" at 0 0\n');
  assert.equal(bad.ok, false);
  assert.match(bad.diagnostics[0].message, /Did you mean `python`\?/);
  assert.deepEqual(evaluate('napkin 1\naccent none\ntext "x" at 0 0\n').book.sketches[0].strokes[0].typeset?.paras, undefined, '`none` accents nothing');
  assert.deepEqual(evaluate('napkin 1\naccent auto\ntext "x" at 0 0 as marks\n').diagnostics.map((d) => d.code), ['unused-accent'], 'marks take no accent');
});
