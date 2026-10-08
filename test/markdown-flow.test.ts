/**
 * Markdown Flow (core/type/markdown-flow.ts): a text typed as Markdown and
 * shown as it renders. Each block the plan's table names, nested; the source
 * map both ways at block edges; the block the caret is in shown as its source
 * and the caret kept through it; a single newline a line break; raw HTML as
 * text; a long document inside a budget; the Markdown configurations made
 * once; Enter; output, which renders every block; and the script's flag.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKDOWN_CONFIG_NAMES,
  MARKDOWN_THEME,
  markdownConfigAsMade,
  markdownEnter,
  markdownShown,
  markdownToType,
  setMarkdownLexer,
  setMarkdownReveal,
  typeShown,
  withMarkdownConfigs,
  withoutMarkdownReveal,
  type MarkdownType,
} from '../src/core/type/markdown-flow.js';
import { readers } from '../src/markdown/core.js';
import { ACCENT_THEMES } from '../src/core/type/accents.js';
import { layoutForEditing, layoutType } from '../src/core/type/layout.js';
import { caretSlots } from '../src/core/type/caret.js';
import { adoptTextConfigs, followsConfig } from '../src/core/type/configs.js';
import { baseAttrs, styleSegments, type CharAttrs } from '../src/core/type/model.js';
import { createSketch, type Stroke } from '../src/core/types.js';
import { sketchToSvg } from '../src/core/sketch-svg.js';
import { evaluate, formatScript, sketchToInstructions } from '../src/core/script/index.js';

const markedLexer = readers.markedLexer;
setMarkdownLexer(markedLexer);

/** A Markdown Flow text at 10, 20, its own size 20. */
function mdText(text: string, id = 'md'): Stroke {
  return { id, tool: 'text', color: '#1f2328', width: 1, points: [{ x: 10, y: 20 }], text, fontSize: 20, typeset: { kind: 'point', flow: 'markdown' } };
}

/** The attributes the display gives its character at `i`, its configuration resolved. */
function shownAt(md: MarkdownType, i: number): Partial<CharAttrs> {
  const run = md.runs.find((each) => each.start <= i && i < each.end);
  const config = run?.attrs.config !== undefined ? md.configs.find((each) => each.id === run.attrs.config) : undefined;
  return { ...(config?.attrs ?? {}), ...(run?.attrs ?? {}) };
}

/** Where a display string starts in the display. */
function at(md: MarkdownType, part: string): number {
  const i = md.text.indexOf(part);
  assert.ok(i >= 0, `the display holds ${JSON.stringify(part)}: ${JSON.stringify(md.text)}`);
  return i;
}

test('headings take their configuration and their level\'s share of the size, with space about them', () => {
  const md = markdownToType('# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six');
  assert.equal(md.text, 'One\nTwo\nThree\nFour\nFive\nSix');
  ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].forEach((word, k) => {
    const attrs = shownAt(md, at(md, word));
    assert.equal(attrs.fontStyle, 'Bold', `${word} is bold, by its configuration`);
    assert.equal(attrs.fontSize, MARKDOWN_THEME.headingSizes[k] * 24, `${word} is ${MARKDOWN_THEME.headingSizes[k]} em`);
    assert.equal(md.configs.find((config) => config.id === md.runs.find((run) => run.start === at(md, word))?.attrs.config)?.name, `Markdown Heading ${k + 1}`);
  });
  assert.ok(md.paras[1]?.spaceAfter && md.paras[1].spaceAfter > 0, 'a heading has space after it');
});

test('strong, emphasis and strikethrough are a bold face, an italic face and a line through', () => {
  const md = markdownToType('Some **bold**, *em*, ***both*** and ~~gone~~.');
  assert.equal(md.text, 'Some bold, em, both and gone.');
  assert.equal(shownAt(md, at(md, 'bold')).fontStyle, 'Bold');
  assert.equal(shownAt(md, at(md, 'em')).fontStyle, 'Italic');
  assert.equal(shownAt(md, at(md, 'both')).fontStyle, 'Bold Italic');
  assert.equal(shownAt(md, at(md, 'gone')).strike, true);
  assert.deepEqual(shownAt(md, at(md, 'Some')), {}, 'plain text is the text\'s own');
});

test('code is Markdown Code with a highlight, and a fenced block is shaded monospace lines', () => {
  const md = markdownToType('Call `run()` now.\n\n```js\nconst a = 1;\nconst b = 2;\n```');
  const code = shownAt(md, at(md, 'run()'));
  assert.match(code.fontFamily ?? '', /monospace/);
  assert.ok(code.highlight, 'inline code has a highlight');
  const lines = md.text.split('\n');
  assert.deepEqual(lines.slice(1), ['const a = 1;', 'const b = 2;'], 'the fences are not shown');
  assert.match(shownAt(md, at(md, 'const a')).fontFamily ?? '', /monospace/);
  assert.equal(md.paras[1]?.shade, ACCENT_THEMES.light.shade);
  assert.equal(md.paras[2]?.shade, ACCENT_THEMES.light.shade);
  assert.deepEqual(md.configs.map((config) => config.name).sort(), ['Markdown Code', 'Markdown Code Block']);
});

test('lists are lists by level, an ordered one counting from its start, and task items show a box', () => {
  const md = markdownToType('- one\n- two\n  - deeper\n\n3. three\n4. four\n\n- [ ] open\n- [x] done');
  assert.equal(md.text, 'one\ntwo\ndeeper\nthree\nfour\nopen\ndone');
  assert.deepEqual(md.paras[0]?.list, { kind: 'bullet', level: 1 });
  assert.deepEqual(md.paras[2]?.list, { kind: 'bullet', level: 2 });
  assert.deepEqual(md.paras[3]?.list, { kind: 'number', marker: '1.', start: 3, level: 1 });
  assert.deepEqual(md.paras[4]?.list, { kind: 'number', marker: '1.', start: 4, level: 1 });
  assert.equal(md.paras[5]?.list?.marker, MARKDOWN_THEME.taskOpen);
  assert.equal(md.paras[6]?.list?.marker, MARKDOWN_THEME.taskDone);
  assert.ok(!md.paras[0]?.spaceAfter, 'a tight list has no space between its items');
  assert.ok((md.paras[2]?.spaceAfter ?? 0) > 0, 'and space after the list');
  // A paragraph inside an item does not start the count again.
  const loose = markdownToType('1. one\n   more\n2. two');
  assert.deepEqual(loose.paras.map((para) => para?.list?.start ?? null), [1, null, 2]);
  assert.ok((loose.paras[1]?.leftIndent ?? 0) > 0, 'the item\'s second line stands in with its text');
});

test('a quote stands in with a bar and the quote color, a rule runs across, and a link is underlined in its color', () => {
  const md = markdownToType('> quoted **words**\n\n---\n\n[the site](https://example.com) and ![a picture](picture.png)');
  assert.equal(md.text, 'quoted words\n\nthe site and a picture');
  assert.equal(md.paras[0]?.leftIndent, 24);
  assert.deepEqual(md.paras[0]?.bar, { color: MARKDOWN_THEME.quoteBar, at: [0] });
  assert.equal(shownAt(md, at(md, 'quoted')).color, MARKDOWN_THEME.configs.quote.color);
  assert.equal(shownAt(md, at(md, 'words')).fontStyle, 'Bold', 'bold inside a quote');
  assert.equal(md.paras[1]?.rule, MARKDOWN_THEME.rule, 'the rule is an empty paragraph with its line');
  const link = shownAt(md, at(md, 'the site'));
  assert.equal(link.underline, true);
  assert.equal(link.color, MARKDOWN_THEME.configs.link.color);
  assert.equal(shownAt(md, at(md, 'a picture')).fontStyle, 'Italic', 'an image shows its words in italics');
  assert.doesNotMatch(md.text, /example\.com|picture\.png/, 'the addresses stay in the source');
});

test('a table is a line a row, its header strong, each column starting where the widest cell before it ends', () => {
  const md = markdownToType('| Name | Qty |\n|---|---|\n| Widget | 2 |\n| A | 10 |');
  assert.deepEqual(md.text.split('\n').map((line) => line.replace(/ +/g, ' ')), ['Name Qty', 'Widget 2', 'A 10']);
  assert.equal(shownAt(md, at(md, 'Name')).fontStyle, 'Bold');
  assert.equal(shownAt(md, at(md, 'Widget')).fontStyle, undefined);
  // Each second column starts at one place: its row's first cell and the kerned space after it are as wide in every row.
  const stroke = mdText('| Name | Qty |\n|---|---|\n| Widget | 2 |\n| A | 10 |');
  const layout = layoutType(stroke);
  const starts = ['Qty', '2', '10'].map((cell) => {
    const line = layout.lines.findIndex((each, n) => layout.glyphs.some((g) => g.line === n && g.ch === cell[0]) && n === ['Qty', '2', '10'].indexOf(cell));
    return layout.glyphs.find((g) => g.line === line && g.ch === cell[0])!.x;
  });
  assert.ok(Math.abs(starts[0] - starts[1]) < 0.5 && Math.abs(starts[1] - starts[2]) < 0.5, `the column lines up: ${starts.join(', ')}`);
});

test('raw HTML stays text, written as it is', () => {
  const md = markdownToType('<div>\nblock html\n</div>\n\nsome <b>inline</b> &amp; &copy; \\*not em\\*');
  assert.equal(md.text, '<div>\nblock html\n</div>\nsome <b>inline</b> & © *not em*');
  assert.deepEqual(shownAt(md, at(md, '<b>')), {});
});

test('a single newline is a line break, and a blank line a new paragraph', () => {
  const md = markdownToType('line one\nline two\n\nnext');
  assert.equal(md.text, 'line one\nline two\nnext');
  assert.ok(!md.paras[0]?.spaceAfter, 'a line break leaves no space');
  assert.ok((md.paras[1]?.spaceAfter ?? 0) > 0, 'a paragraph does');
});

test('blocks nest: a list in a quote, a quote in a quote, code in a list item', () => {
  const md = markdownToType('> - in a quote\n>\n> > deeper\n\n- item\n\n  ```\n  code\n  ```');
  assert.equal(md.text, 'in a quote\ndeeper\nitem\ncode');
  assert.deepEqual(md.paras[0]?.list, { kind: 'bullet', level: 1 });
  assert.deepEqual(md.paras[0]?.bar?.at, [0]);
  assert.deepEqual(md.paras[1]?.bar?.at, [0, 24], 'a quote in a quote has a bar for each');
  assert.equal(md.paras[1]?.leftIndent, 48);
  assert.equal(md.paras[3]?.shade, ACCENT_THEMES.light.shade);
  assert.equal(md.paras[3]?.leftIndent, 36, 'code in an item stands in with its text');
});

test('the source map takes each shown character to where it was typed, never going back, and finds every block both ways', () => {
  const source = '# Title\n\nSome **bold** and `code`\n\n- one\n- [x] two\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\nend';
  const md = markdownToType(source);
  assert.equal(md.map.length, md.text.length + 1);
  for (let i = 0; i < md.text.length; i++) {
    if (i > 0) assert.ok(md.map[i] >= md.map[i - 1], `the map goes on at ${i}`);
    if (md.text[i] !== '\n' && md.text[i] !== ' ') assert.equal(source[md.map[i]], md.text[i], `display ${i} is source ${md.map[i]}`);
  }
  for (const block of md.blocks) {
    // Display to source: the block's first character shown is in it; source to display: that place is found again.
    const first = md.map.findIndex((place) => place >= block.start);
    assert.ok(md.map[first] >= block.start && md.map[first] <= block.end, `${source.slice(block.start, block.end)} starts where it is`);
    assert.equal(md.map.indexOf(md.map[first]), first);
  }
  assert.deepEqual(
    md.blocks.map((block) => source.slice(block.start, block.end)),
    ['# Title', 'Some **bold** and `code`', '- one', '- [x] two', '> quote', '| a | b |\n|---|---|\n| 1 | 2 |', '---', 'end'],
  );
});

test('the block the caret is in shows its source, the Markdown muted, and every other block renders', () => {
  const source = '# Title\n\nSome **bold** text';
  const inPara = markdownToType(source, MARKDOWN_THEME, { reveal: { start: 14, end: 14 } });
  assert.equal(inPara.text, 'Title\nSome **bold** text');
  assert.equal(shownAt(inPara, at(inPara, '**')).color, MARKDOWN_THEME.muted, 'the stars are muted');
  assert.equal(shownAt(inPara, at(inPara, 'bold')).fontStyle, 'Bold', 'what they mark still looks as it renders');
  const inHeading = markdownToType(source, MARKDOWN_THEME, { reveal: { start: 3, end: 3 } });
  assert.equal(inHeading.text, '# Title\nSome bold text');
  assert.equal(shownAt(inHeading, 0).color, MARKDOWN_THEME.muted);
  assert.equal(shownAt(inHeading, 0).fontSize, 48, 'the # is muted in the heading\'s size');
  // On the blank line between them, the blank lines show.
  const between = markdownToType(source, MARKDOWN_THEME, { reveal: { start: 8, end: 8 } });
  assert.equal(between.text, 'Title\n\nSome bold text');
  assert.deepEqual(between.blocks.map((block) => block.source), [false, false]);
  // A selection across both shows both, and the blank line between.
  assert.equal(markdownToType(source, MARKDOWN_THEME, { reveal: { start: 2, end: 12 } }).text, source);
});

test('the caret keeps its place through reveal and render: every place in its block has a slot', () => {
  const stroke = mdText('# Title\n\nSome **bold** text\n\n- one\n- two');
  for (const caret of [3, 9, 14, 20, 27, 29, 34]) {
    setMarkdownReveal(stroke.id, caret, caret);
    const layout = layoutForEditing(stroke);
    const slots = caretSlots(layout, stroke.text!);
    assert.ok(slots.some((slot) => slot.index === caret), `the caret at ${caret} has a slot`);
    // Its block is all there, every place of it a slot.
    const md = markdownToType(stroke.text!, MARKDOWN_THEME, { reveal: { start: caret, end: caret } });
    const block = md.blocks.find((each) => each.source)!;
    for (let i = block.start; i <= block.end; i++) assert.ok(slots.some((slot) => slot.index === i), `${caret}: ${i} has a slot`);
  }
  setMarkdownReveal(null);
  // Rendered, the glyphs' places are still the source's: the heading's T is source 2.
  const rendered = layoutForEditing(stroke);
  assert.equal(rendered.glyphs[0].ch, 'T');
  assert.equal(rendered.glyphs[0].index, 2);
  assert.equal(layoutType(stroke).glyphs[0].index, 0, 'the layout itself is of the display');
});

test('a caret move inside a block keeps the display; one into another block makes it again', () => {
  const stroke = mdText('First paragraph here\n\nSecond one');
  setMarkdownReveal(stroke.id, 3, 3);
  const a = markdownShown(stroke);
  setMarkdownReveal(stroke.id, 9, 9);
  assert.equal(markdownShown(stroke), a, 'the same block: the same display');
  setMarkdownReveal(stroke.id, 25, 25);
  assert.notEqual(markdownShown(stroke), a);
  setMarkdownReveal(null);
});

test('a 10,000-character document is shown and laid out inside a budget', () => {
  const block = '# Heading\n\nA paragraph with **bold**, *em* and `code`, long enough to wrap a few times in a frame.\n\n- one\n- two\n  - three\n\n> a quote\n\n```\ncode line\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n';
  let source = '';
  while (source.length < 10000) source += block;
  const stroke: Stroke = { ...mdText(source), typeset: { kind: 'area', flow: 'markdown', frame: { anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 400, y: 0 } }, { p: { x: 400, y: 100 } }, { p: { x: 0, y: 100 } }], autoHeight: true } } };
  const started = performance.now();
  const layout = layoutType(stroke);
  const took = performance.now() - started;
  assert.ok(layout.glyphs.length > 5000, `${layout.glyphs.length} glyphs, the Markdown's own not drawn`);
  assert.ok(took < 2000, `laid out in ${Math.round(took)} ms`);
  // A caret moved within a block costs nothing: the display is kept.
  setMarkdownReveal(stroke.id, 20, 20);
  layoutForEditing(stroke);
  const again = performance.now();
  setMarkdownReveal(stroke.id, 25, 25);
  layoutForEditing(stroke);
  assert.ok(performance.now() - again < 50, 'a move inside the block is kept');
  setMarkdownReveal(null);
});

test('the Markdown configurations are made once: a text carries them, a book keeps them, and restyling one restyles the Markdown', () => {
  const stroke = withMarkdownConfigs(mdText('# Title\n\n`code`'));
  assert.deepEqual(stroke.typeset!.configs!.map((config) => config.name), Object.values(MARKDOWN_CONFIG_NAMES));
  assert.equal(withMarkdownConfigs(stroke), stroke, 'carried, nothing more is made');
  const first = adoptTextConfigs([], [stroke], () => 'tc_x');
  assert.equal(first.list.length, 10);
  const second = adoptTextConfigs(first.list, [withMarkdownConfigs(mdText('## Two', 'md2'), first.list)], () => 'tc_y');
  assert.equal(second.list.length, 10, 'a second text brings no second set');
  assert.ok(followsConfig(stroke, 'tc_markdown_heading_1'), 'a Markdown text follows the configurations it is shown in');
  // The book's Markdown Heading 1 made red: the text's heading is red.
  const red = first.list.map((config) => (config.name === 'Markdown Heading 1' ? { ...config, attrs: { ...config.attrs, color: '#c0392b' } } : config));
  const restyled = withMarkdownConfigs({ ...stroke, typeset: { ...stroke.typeset!, configs: undefined } }, red);
  const shown = markdownShown(restyled)!;
  assert.equal(styleSegments(shown.stroke)[0].attrs.color, '#c0392b');
  assert.equal(markdownConfigAsMade(red[0])?.attrs.color, undefined, 'as first made, it is not red');
});

test('Enter carries a list or a quote on, ends an empty one, and is a newline alone in a fence', () => {
  assert.deepEqual(markdownEnter('- one', 5), { from: 5, to: 5, insert: '\n- ' });
  assert.deepEqual(markdownEnter('3. three', 8), { from: 8, to: 8, insert: '\n4. ' });
  assert.deepEqual(markdownEnter('- [x] done', 10), { from: 10, to: 10, insert: '\n- [ ] ' });
  assert.deepEqual(markdownEnter('  * nested', 10), { from: 10, to: 10, insert: '\n  * ' });
  assert.deepEqual(markdownEnter('> quoted', 8), { from: 8, to: 8, insert: '\n> ' });
  assert.deepEqual(markdownEnter('> - in a quote', 14), { from: 14, to: 14, insert: '\n> - ' });
  assert.deepEqual(markdownEnter('- one\n- ', 8), { from: 6, to: 8, insert: '' }, 'an empty item ends the list');
  assert.deepEqual(markdownEnter('```\n- not a list', 16), { from: 16, to: 16, insert: '\n' }, 'in a fence, a newline');
  assert.deepEqual(markdownEnter('plain', 5), { from: 5, to: 5, insert: '\n' });
});

test('a text shown as it renders is a plain text: its display, its runs, the configurations they follow', () => {
  const stroke = withMarkdownConfigs(mdText('# Title\n\nSome **bold**'));
  const plain = withoutMarkdownReveal(() => markdownShown(stroke))!.stroke;
  assert.equal(plain.text, 'Title\nSome bold');
  assert.equal(plain.typeset?.flow, undefined);
  assert.equal(plain.id, stroke.id);
  assert.equal(baseAttrs(plain).fontSize, 40, 'its base is its first character: the heading');
  assert.deepEqual(plain.typeset?.configs?.map((config) => config.name), ['Markdown Heading 1'], 'it keeps the configuration its heading follows');
  assert.equal(typeShown(mdText('plain')).text, 'plain');
});

test('the layout draws a quote\'s bars, a rule and a code block\'s one shade', () => {
  const layout = layoutType(mdText('> one\n>\n> two\n\n---\n\n```\na\nb\n```'));
  const shades = layout.highlights.filter((h) => h.kind === 'shade');
  const color = (c: string) => shades.filter((h) => h.color === c);
  assert.equal(color(ACCENT_THEMES.light.shade).length, 1, 'the code block\'s lines share one shade');
  const two = layoutType(mdText('```\na\n```\n\n```\nb\n```')).highlights.filter((h) => h.kind === 'shade' && h.color === ACCENT_THEMES.light.shade);
  assert.equal(two.length, 2, 'two blocks one after another keep a shade each: the space between them parts them');
  const bars = color(MARKDOWN_THEME.quoteBar);
  assert.equal(bars.length, 2, 'one bar down the quote, one rule');
  const [bar, rule] = bars.sort((p, q) => q.corners[2].y - q.corners[0].y - (p.corners[2].y - p.corners[0].y));
  assert.ok(bar.corners[2].y - bar.corners[0].y > 40, 'the bar runs down both paragraphs');
  assert.ok(rule.corners[1].x - rule.corners[0].x >= 200, 'the rule runs ten ems at least');
  assert.ok(layout.bounds.minX <= 10 && layout.bounds.maxX >= rule.corners[1].x);
});

test('output renders every block, whatever the caret, and keeps the Markdown to read back', () => {
  const sketch = createSketch('md');
  sketch.strokes.push({ ...mdText('Some **bold** text'), layer: sketch.layers[0].id });
  setMarkdownReveal('md', 7, 7);
  const svg = sketchToSvg(sketch);
  setMarkdownReveal(null);
  assert.doesNotMatch(svg, />[^<]*\*\*[^<]*</, 'no stars are drawn');
  assert.match(svg, /data-text="Some \*\*bold\*\* text"/, 'the source is kept');
  assert.match(svg, /&quot;flow&quot;:&quot;markdown&quot;/);
  assert.match(svg, /font-weight="700"[^>]*>bold</);
});

test('with no lexer, the source is shown as it is', () => {
  setMarkdownLexer(null);
  try {
    const stroke = mdText('# Title');
    assert.equal(markdownShown(stroke), null);
    assert.equal(layoutType(stroke).glyphs[0].ch, '#');
    assert.equal(markdownToType('**x**').text, '**x**');
  } finally {
    setMarkdownLexer(markedLexer);
  }
});

test('a script\'s `markdown` flag makes Markdown Flow text, and the writer writes it back with a restyled configuration', () => {
  const run = evaluate('napkin 1\ntextconfig "Markdown Heading 1" color #c0392b\ntext "# Title\\n\\n- one" at 20 40 markdown\n');
  assert.equal(run.ok, true, JSON.stringify(run.diagnostics));
  const page = run.book.sketches[0];
  const text = page.strokes.find((stroke) => stroke.tool === 'text')!;
  assert.equal(text.typeset?.flow, 'markdown');
  assert.equal(text.text, '# Title\n\n- one');
  assert.equal(run.book.textConfigs?.find((config) => config.name === 'Markdown Heading 1')?.attrs.color, '#c0392b');
  assert.equal(run.book.textConfigs?.filter((config) => config.name.startsWith('Markdown')).length, 10);
  const written = formatScript(sketchToInstructions(page, { decimals: null }).script);
  assert.match(written, /^text "# Title\\n\\n- one" at 20 40 markdown$/m);
  assert.match(written, /^textconfig "Markdown Heading 1" .*color #c0392b/m, 'the restyled configuration is written, the others are not');
  assert.doesNotMatch(written, /textconfig "Markdown Code"/);
  assert.equal(evaluate('napkin 1\ntext "x" at 0 0 markdown as marks\n').ok, false, '`as marks` takes no `markdown`');
});
