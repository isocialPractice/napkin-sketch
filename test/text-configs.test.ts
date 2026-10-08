/**
 * Text Configurations (src/core/type/configs.ts), a vector editor's
 * Character Styles: a run's attributes are the base, then its
 * configuration's, then its own overrides; a plain apply keeps the
 * overrides, and the panel shows a `+` for them, while Alt clears them;
 * redefining a configuration restyles every run that follows it; deleting
 * one breaks the link or reverts the runs; another book's merge in by name,
 * a clashing one renamed; text from elsewhere is brought in by name; and a
 * book is read in step with its list, keeping the configurations nothing
 * follows unless asked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  adoptTextConfigs,
  applyTextConfig,
  breakTextConfigLink,
  captureConfigAttrs,
  clearTextOverrides,
  detachTextConfig,
  dropUnusedTextConfigs,
  duplicateTextConfig,
  mergeTextConfigs,
  newTextConfig,
  nextConfigName,
  readConfigTargets,
  replaceTextConfig,
  resolveRunAttrs,
  revertTextConfig,
  uniqueConfigName,
  unusedTextConfigs,
  withConfigDefinitions,
  type TextConfig,
} from '../src/core/type/configs.js';
import { applyChar, baseAttrs, charAttrsAt, clipOf, scaleTypeset, spliceClip, spliceText, styleSegments, textColorPatch, withTypeset } from '../src/core/type/model.js';
import { normalizeSketchBook, serializeSketchBook } from '../src/core/serialize.js';
import { createSketch, type SketchBook, type Stroke } from '../src/core/types.js';

const mark = (text: string, extra: Partial<Stroke> = {}): Stroke => ({
  id: 'tx',
  tool: 'text',
  color: '#1f2328',
  width: 1,
  points: [{ x: 10, y: 20, pressure: 0.5 }],
  text,
  fontSize: 24,
  fontFamily: 'Georgia',
  ...extra,
});

const CALLOUT: TextConfig = { id: 'tc_callout', name: 'Callout', attrs: { fontStyle: 'Bold', color: '#cc0000' } };
const BIG: TextConfig = { id: 'tc_big', name: 'Big', attrs: { fontSize: 48 } };

const all = (stroke: Stroke): { start: number; end: number } => ({ start: 0, end: (stroke.text ?? '').length });

test('a run that follows a configuration has the base, then the configuration, then its own attributes', () => {
  const base = baseAttrs(mark('x'));
  const resolved = resolveRunAttrs(base, CALLOUT, { color: '#0000ff', config: 'ignored' });
  assert.equal(resolved.fontStyle, 'Bold', 'the configuration over the base');
  assert.equal(resolved.color, '#0000ff', 'the override over the configuration');
  assert.equal(resolved.fontFamily, 'Georgia', 'the base under both');
  assert.equal(resolved.config, 'tc_callout');
  assert.equal(resolveRunAttrs(base, null, {}).config, undefined, 'no configuration, no link');

  // On a text: "world" follows Callout, and the run holds only the link; the copy carries the definition.
  const linked = applyTextConfig(mark('Hello world'), { start: 6, end: 11 }, CALLOUT);
  assert.deepEqual(linked.typeset?.runs, [{ start: 6, end: 11, attrs: { config: 'tc_callout' } }]);
  assert.deepEqual(linked.typeset?.configs, [{ id: 'tc_callout', name: 'Callout', attrs: { fontStyle: 'Bold', color: '#cc0000' } }]);
  assert.equal(charAttrsAt(linked, 8).fontStyle, 'Bold');
  assert.equal(charAttrsAt(linked, 8).color, '#cc0000');
  assert.equal(charAttrsAt(linked, 2).fontStyle, 'Regular', 'the rest as it was');
  // Read back from a file, it is the same text.
  assert.deepEqual(withTypeset(mark('Hello world'), JSON.parse(JSON.stringify(linked.typeset))).typeset, linked.typeset);
});

test('a plain apply keeps the overrides, and the panel shows a plus for them; Alt clears them, kerning by hand kept', () => {
  // "world" is blue and kerned by hand before it follows Callout.
  let text = applyChar(mark('Hello world'), { start: 6, end: 11 }, { color: '#0000ff', underline: true });
  text = applyChar(text, { start: 6, end: 7 }, { kern: 40 });
  const kept = applyTextConfig(text, { start: 6, end: 11 }, CALLOUT);
  assert.equal(charAttrsAt(kept, 8).color, '#0000ff', 'its own color wins over the configuration');
  assert.equal(charAttrsAt(kept, 8).fontStyle, 'Bold', 'what it did not have of its own, the configuration gives');
  assert.equal(charAttrsAt(kept, 8).underline, true);
  const target = (stroke: Stroke): Parameters<typeof readConfigTargets>[0] => [{ stroke, start: 6, end: 11 }];
  assert.deepEqual(readConfigTargets(target(kept)), { config: 'tc_callout', overrides: true });

  const cleared = applyTextConfig(text, { start: 6, end: 11 }, CALLOUT, true);
  assert.equal(charAttrsAt(cleared, 8).color, '#cc0000', 'Alt: the configuration whole');
  assert.equal(charAttrsAt(cleared, 8).underline, false, 'and nothing of its own');
  assert.equal(charAttrsAt(cleared, 6).kern, 40, 'kerning by hand is a pair\'s, and stays');
  assert.deepEqual(readConfigTargets(target(cleared)), { config: 'tc_callout', overrides: false });

  // Clear Overrides does the same to what it follows; a value set back to the configuration's is no override.
  assert.deepEqual(readConfigTargets(target(clearTextOverrides(kept, { start: 6, end: 11 }))), { config: 'tc_callout', overrides: false });
  const back = applyChar(kept, { start: 6, end: 11 }, { color: '#cc0000', underline: false });
  assert.deepEqual(readConfigTargets(target(back)), { config: 'tc_callout', overrides: false });
  assert.deepEqual(back.typeset?.runs?.find((run) => run.start <= 8 && run.end > 8)?.attrs, { config: 'tc_callout' }, 'the run holds the link alone again');

  // An override back to the base's own value is still one: the configuration would color it otherwise.
  const black = applyChar(kept, { start: 6, end: 11 }, { color: '#1f2328' });
  assert.equal(charAttrsAt(black, 8).color, '#1f2328');
  assert.equal(readConfigTargets(target(black))?.overrides, true);

  // Two texts, one following and one not: mixed. At a caret, what typing there would follow.
  assert.equal(readConfigTargets([...target(kept), { stroke: mark('plain'), start: 0, end: 5 }])?.config, 'mixed');
  assert.equal(readConfigTargets([{ stroke: kept, start: 9, end: 9 }])?.config, 'tc_callout');
  assert.equal(readConfigTargets([{ stroke: kept, start: 3, end: 3, typing: { config: 'tc_big' } }], [BIG])?.config, 'tc_big', 'typing attributes may name one from the book');
  // The Default Configuration has a plus for a text's own formatting too.
  assert.deepEqual(readConfigTargets([{ stroke: text, start: 6, end: 11 }]), { config: null, overrides: true });
});

test('the base keeps what is under a configuration: applied to the first character it stays, and going back to Default reverts', () => {
  const big = applyTextConfig(mark('Hello world'), { start: 0, end: 5 }, BIG);
  assert.equal(big.fontSize, 24, 'the base stays the text\'s own size');
  assert.equal(charAttrsAt(big, 0).fontSize, 48);
  assert.equal(charAttrsAt(big, 8).fontSize, 24);
  assert.deepEqual(big.typeset?.runs, [{ start: 0, end: 5, attrs: { config: 'tc_big' } }]);
  const plain = applyTextConfig(big, { start: 0, end: 5 }, null);
  assert.equal(charAttrsAt(plain, 0).fontSize, 24, 'the Default Configuration: the text\'s own again');
  assert.equal(plain.typeset, undefined, 'and nothing left to say');

  // Typing after a character that follows one follows it too; deleting the first keeps what was under it.
  const typed = spliceText(big, 5, 5, '!');
  assert.equal(charAttrsAt(typed, 5).config, 'tc_big');
  const cut = spliceText(big, 0, 6, '');
  assert.equal(cut.fontSize, 24);
  assert.equal(charAttrsAt(cut, 0).fontSize, 24);
});

test('redefining a configuration restyles every run that follows it, under its overrides', () => {
  let text = applyTextConfig(mark('Hello brave world'), { start: 6, end: 11 }, CALLOUT);
  text = applyTextConfig(text, { start: 12, end: 17 }, CALLOUT);
  text = applyChar(text, { start: 12, end: 17 }, { underline: true });
  const redefined = { ...CALLOUT, attrs: { fontStyle: 'Bold', color: '#cc0000', fontSize: 36 } };
  const after = withConfigDefinitions(text, [redefined]);
  assert.equal(charAttrsAt(after, 8).fontSize, 36);
  assert.equal(charAttrsAt(after, 14).fontSize, 36);
  assert.equal(charAttrsAt(after, 14).underline, true, 'the override stays');
  assert.equal(charAttrsAt(after, 2).fontSize, 24, 'what does not follow it is as it was');
  assert.deepEqual(after.typeset?.runs, text.typeset?.runs, 'the runs are as they were: only the definition changed');
  assert.equal(withConfigDefinitions(text, [CALLOUT]), text, 'the same definition changes nothing');
  assert.equal(withConfigDefinitions(mark('plain'), [redefined]).typeset, undefined);

  // A rename travels the same way.
  const renamed = withConfigDefinitions(text, [{ ...CALLOUT, name: 'Shout' }]);
  assert.equal(renamed.typeset?.configs?.[0].name, 'Shout');
});

test('deleting a configuration in use breaks the link, keeping the look, or reverts the runs to the text\'s own', () => {
  let text = applyTextConfig(mark('Hello world'), { start: 6, end: 11 }, CALLOUT);
  text = applyChar(text, { start: 6, end: 11 }, { underline: true });
  const detached = detachTextConfig(text, 'tc_callout');
  assert.equal(charAttrsAt(detached, 8).color, '#cc0000', 'Break Link: the look stays');
  assert.equal(charAttrsAt(detached, 8).fontStyle, 'Bold');
  assert.equal(charAttrsAt(detached, 8).config, undefined);
  assert.equal(detached.typeset?.configs, undefined, 'and the copy goes with the link');
  const reverted = revertTextConfig(text, 'tc_callout');
  assert.equal(charAttrsAt(reverted, 8).color, '#1f2328', 'Revert: the text\'s own color');
  assert.equal(charAttrsAt(reverted, 8).fontStyle, 'Regular');
  assert.equal(charAttrsAt(reverted, 8).underline, true, 'its overrides kept');
  assert.equal(detachTextConfig(mark('plain'), 'tc_callout').typeset, undefined, 'a text that follows none is left alone');
  // Break Link on a stretch: the same, for the stretch alone.
  const broken = breakTextConfigLink(text, { start: 6, end: 8 });
  assert.equal(charAttrsAt(broken, 6).config, undefined);
  assert.equal(charAttrsAt(broken, 6).color, '#cc0000');
  assert.equal(charAttrsAt(broken, 9).config, 'tc_callout');
});

test('another book\'s configurations merge in by name: one alike kept once, one that differs renamed Name 2', () => {
  const ids = ['tc_new1', 'tc_new2', 'tc_new3'];
  const merge = mergeTextConfigs(
    [CALLOUT, BIG],
    [
      { id: 'tc_other', name: 'callout', attrs: { color: '#cc0000', fontStyle: 'Bold' } },
      { id: 'tc_big', name: 'Big', attrs: { fontSize: 60 } },
      { id: 'tc_quiet', name: 'Quiet', attrs: { color: '#888888' } },
    ],
    () => ids.shift()!,
  );
  assert.equal(merge.same, 1, 'Callout, alike in any case and order');
  assert.deepEqual(merge.renamed, [{ from: 'Big', to: 'Big 2' }]);
  assert.deepEqual(merge.list.map((config) => `${config.id}:${config.name}`), ['tc_callout:Callout', 'tc_big:Big', 'tc_new1:Big 2', 'tc_quiet:Quiet']);
  assert.deepEqual(merge.added.map((config) => config.name), ['Big 2', 'Quiet']);

  // Names stay apart: a new one numbered, a copy named for its original, a rename made unique.
  assert.equal(nextConfigName([]), 'Text Configuration 1');
  assert.equal(nextConfigName([newTextConfig([], {}, 'a')]), 'Text Configuration 2');
  assert.equal(uniqueConfigName(merge.list, 'big 2'), 'big 3');
  assert.equal(uniqueConfigName(merge.list, 'Big', 'tc_big'), 'Big', 'its own name is not a clash');
  const copy = duplicateTextConfig(merge.list, 'tc_callout', 'tc_copy');
  assert.equal(copy?.config.name, 'Callout copy');
  assert.equal(copy?.list[1].id, 'tc_copy', 'after its original');
  assert.deepEqual(replaceTextConfig(merge.list, { ...BIG, name: 'Quiet' }).map((config) => config.name), ['Callout', 'Quiet 2', 'Big 2', 'Quiet']);
});

test('text from elsewhere is brought in by name: the book\'s definition wins, and one it has not joins it', () => {
  const pasted = [
    applyTextConfig(mark('Shout', { id: 'a' }), { start: 0, end: 5 }, { id: 'tc_foreign', name: 'callout', attrs: { color: '#00aa00' } }),
    applyTextConfig(mark('Hush', { id: 'b' }), { start: 0, end: 4 }, { id: 'tc_quiet', name: 'Quiet', attrs: { color: '#888888' } }),
    mark('plain', { id: 'c' }),
  ];
  const adopted = adoptTextConfigs([CALLOUT], pasted, () => 'tc_fresh');
  assert.deepEqual(adopted.list.map((config) => config.name), ['Callout', 'Quiet']);
  assert.equal(charAttrsAt(adopted.strokes[0], 0).config, 'tc_callout', 'relinked to the book\'s Callout');
  assert.equal(charAttrsAt(adopted.strokes[0], 0).color, '#cc0000', 'and looking as the book\'s does');
  assert.equal(adopted.strokes[1], pasted[1], 'one the book had not keeps its own');
  assert.equal(adopted.strokes[2], pasted[2]);
  // An id the book has under another name is not that one: the newcomer gets an id of its own.
  const clash = adoptTextConfigs([{ id: 'tc_quiet', name: 'Loud', attrs: {} }], [pasted[1]], () => 'tc_fresh');
  assert.deepEqual(clash.list.map((config) => `${config.id}:${config.name}`), ['tc_quiet:Loud', 'tc_fresh:Quiet']);
  assert.equal(charAttrsAt(clash.strokes[0], 0).config, 'tc_fresh');
  assert.equal(charAttrsAt(clash.strokes[0], 0).color, '#888888');
});

test('a book reads in step with its list, and keeps the configurations nothing follows unless asked to drop them', () => {
  const page = createSketch('one');
  const linked = applyTextConfig(mark('Hello world', { id: 't1' }), { start: 0, end: 5 }, CALLOUT);
  // The file's copy of Callout is stale: the list's definition wins on reading.
  const stale = { ...linked, typeset: { ...linked.typeset!, configs: [{ ...CALLOUT, attrs: { color: '#00ff00' } }] } };
  page.strokes = [stale, applyTextConfig(mark('Odd', { id: 't2' }), { start: 0, end: 3 }, { id: 'tc_odd', name: 'Odd', attrs: { caps: 'all' } })];
  const raw: SketchBook = { format: 'napkin-sketch', version: 4, name: 'b', sketches: [page], textConfigs: [CALLOUT, BIG], createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' };
  const book = normalizeSketchBook(JSON.parse(JSON.stringify(raw)));
  assert.deepEqual(book.textConfigs?.map((config) => config.name), ['Callout', 'Big', 'Odd'], 'Big kept though nothing follows it; Odd, only a text carried, joins');
  assert.equal(charAttrsAt(book.sketches[0].strokes[0], 0).color, '#cc0000');
  assert.deepEqual(Object.keys(book), ['format', 'version', 'name', 'sketches', 'textConfigs', 'createdAt', 'updatedAt']);
  assert.deepEqual(unusedTextConfigs(book).map((config) => config.name), ['Big']);
  assert.deepEqual(normalizeSketchBook(JSON.parse(serializeSketchBook(book)), 'b', { dropUnusedConfigs: true }).textConfigs?.map((config) => config.name), ['Callout', 'Odd']);
  assert.equal(dropUnusedTextConfigs({ ...book, textConfigs: [BIG] }).textConfigs, undefined);
  // A list in a file that repeats a name keeps the first.
  const twice = normalizeSketchBook({ ...raw, sketches: [], textConfigs: [CALLOUT, { ...BIG, name: 'CALLOUT' }] });
  assert.deepEqual(twice.textConfigs?.map((config) => config.id), ['tc_callout']);
});

test('copy and paste carry a configuration with the text; scaling makes its lengths overrides; a whole recolor overrides it', () => {
  const source = applyTextConfig(mark('Hello world'), { start: 6, end: 11 }, BIG);
  const clip = clipOf(source, 4, 9);
  assert.deepEqual(clip.configs?.map((config) => config.id), ['tc_big']);
  const pasted = spliceClip(mark('Copy: '), 6, 6, clip);
  assert.equal(charAttrsAt(pasted, 6).config, undefined, 'the plain part pastes plain');
  assert.equal(charAttrsAt(pasted, 9).config, 'tc_big', 'and the rest follows Big');
  assert.equal(charAttrsAt(pasted, 9).fontSize, 48);
  // A plain part pasted after a configured character stays plain: it does not take what typing there would.
  const after = spliceClip(source, 11, 11, { text: '!', runs: [{ start: 0, end: 1, attrs: { ...baseAttrs(source) } }] });
  assert.equal(charAttrsAt(after, 11).config, undefined);

  const scaled = scaleTypeset(source.typeset!, 2, 2);
  assert.equal(scaled.runs?.[0].attrs.fontSize, 96, 'Big\'s size, scaled, is the run\'s own');
  assert.equal(scaled.runs?.[0].attrs.config, 'tc_big');
  assert.deepEqual(scaleTypeset(source.typeset!, 1, 1).runs, source.typeset?.runs, 'at no scale, nothing is made an override');

  const red = applyTextConfig(mark('Hello world'), { start: 0, end: 5 }, CALLOUT);
  const patch = textColorPatch(red, '#00aa00');
  const recolored = { ...red, ...patch };
  assert.equal(charAttrsAt(recolored, 0).color, '#00aa00', 'the configured run is recolored too');
  assert.equal(charAttrsAt(recolored, 0).config, 'tc_callout', 'and still follows Callout, overriding it');
});

test('a new configuration takes what the selection has beyond its base; a link with no definition goes, the look kept', () => {
  const styled = applyChar(mark('Hello world'), { start: 6, end: 11 }, { fontStyle: 'Bold', color: '#cc0000', kern: 20 });
  assert.deepEqual(captureConfigAttrs([{ stroke: styled, start: 6, end: 11 }]), { fontStyle: 'Bold', color: '#cc0000' });
  assert.deepEqual(captureConfigAttrs([{ stroke: styled, start: 4, end: 9 }]), {}, 'what differs across the selection is left out');
  const made = newTextConfig([], captureConfigAttrs([{ stroke: styled, start: 6, end: 11 }]), 'tc_1', 'Callout');
  assert.deepEqual(made, { id: 'tc_1', name: 'Callout', attrs: { fontStyle: 'Bold', color: '#cc0000' } });

  // A run that names a configuration its text carries no definition of keeps what it has, and loses the link.
  const dangling = withTypeset(mark('Hello'), { kind: 'point', runs: [{ start: 2, end: 5, attrs: { config: 'tc_gone', color: '#cc0000' } }] });
  assert.deepEqual(dangling.typeset?.runs, [{ start: 2, end: 5, attrs: { color: '#cc0000' } }]);
  assert.equal(styleSegments(dangling)[1].attrs.config, undefined);
});

test('in the app a configuration changed under text on two pages is one undo step, and a paste brings its own in by name', async () => {
  const { Store } = await import('../src/renderer/store.js');
  const { createSketchBook } = await import('../src/core/types.js');
  const store = new Store(createSketchBook('configs'));
  store.editTextConfigs([CALLOUT], null);
  store.addStroke(applyTextConfig(mark('Hello world', { id: 'p1' }), { start: 6, end: 11 }, CALLOUT));
  store.addPage('two');
  store.addStroke(applyTextConfig(mark('Hi there', { id: 'p2' }), { start: 3, end: 8 }, CALLOUT));
  const firstPage = store.book.sketches[0];

  // Redefined from page two: both pages restyle, as one step.
  const redefined = { ...CALLOUT, attrs: { ...CALLOUT.attrs, fontSize: 36 } };
  store.editTextConfigs([redefined], (stroke) => withConfigDefinitions(stroke, [redefined]));
  assert.equal(charAttrsAt(store.sketch.strokes[0], 4).fontSize, 36);
  assert.equal(charAttrsAt(firstPage.strokes[0], 8).fontSize, 36, 'the other page too');
  store.undo();
  assert.equal(charAttrsAt(store.sketch.strokes[0], 4).fontSize, 24);
  assert.equal(charAttrsAt(firstPage.strokes[0], 8).fontSize, 24, 'undone on the other page too');
  assert.deepEqual(store.textConfigs, [CALLOUT]);
  store.redo();
  assert.equal(charAttrsAt(firstPage.strokes[0], 8).fontSize, 36, 'and redone there');

  // A text pasted from another book follows the book's Callout, and one the book has not joins its list - undone with the paste.
  const foreign = applyTextConfig(mark('Yo', { id: 'x1' }), { start: 0, end: 2 }, { id: 'tc_far', name: 'CALLOUT', attrs: { color: '#00ff00' } });
  const quiet = applyTextConfig(mark('Hm', { id: 'x2' }), { start: 0, end: 2 }, { id: 'tc_hush', name: 'Hush', attrs: { color: '#999999' } });
  store.addStrokes([foreign, quiet]);
  assert.equal(charAttrsAt(store.sketch.strokes.find((s) => s.id === 'x1')!, 0).config, 'tc_callout');
  assert.deepEqual(store.textConfigs.map((config) => config.name), ['Callout', 'Hush']);
  store.undo();
  assert.deepEqual(store.textConfigs.map((config) => config.name), ['Callout'], 'the paste undone takes Hush back off the list');
});

test('a script defines configurations that a text and its runs follow, and the writer writes each before the first text that does', async () => {
  const { evaluate, formatDiagnostic, bookToInstructions, formatScript } = await import('../src/core/script/index.js');
  const script = [
    'napkin 1',
    'page 400 200',
    'font "Arial" 24',
    'textconfig "Callout" face "Bold" color #cc0000',
    'textconfig "Big" size 48',
    'text "Hello brave world" at 20 40 runs (6 11 config "Callout" underline, 12 17 config "big")',
    'text "Whole" at 20 120 config "Callout"',
    'textconfig "Callout" face "Bold" color #0000ff',
  ].join('\n');
  const result = evaluate(script, { timestamp: '2026-10-03T00:00:00.000Z' });
  assert.deepEqual(result.diagnostics.map((d) => formatDiagnostic(d)), []);
  const book = result.book;
  assert.deepEqual(book.textConfigs?.map((config) => config.name), ['Callout', 'Big']);
  const [hello, whole] = book.sketches[0].strokes;
  assert.equal(charAttrsAt(hello, 8).color, '#0000ff', 'defined again, it changed for the text before it too');
  assert.equal(charAttrsAt(hello, 8).underline, true, "the run's own on top");
  assert.equal(charAttrsAt(hello, 14).fontSize, 48, 'a name in any case');
  assert.equal(charAttrsAt(whole, 0).color, '#0000ff');
  assert.equal(whole.color, '#1f2328', 'the base keeps what is under it');

  const wrong = evaluate('napkin 1\ntextconfig "Callout" color red\ntext "x" at 0 0 config "Calout"');
  assert.deepEqual(wrong.diagnostics.map((d) => d.code), ['unknown-config']);
  assert.match(wrong.diagnostics[0].message, /Did you mean `Callout`/);

  const written = formatScript(bookToInstructions(book).script);
  assert.ok(written.includes('textconfig "Callout" face "Bold" color #0000ff'), written);
  assert.ok(written.indexOf('textconfig "Callout"') < written.indexOf('text "Hello brave world"'), written);
  assert.ok(written.includes('config "Callout" underline'), written);
  assert.equal(written.split('textconfig "Callout"').length, 2, 'defined once');
  const again = evaluate(written, { timestamp: '2026-10-03T00:00:00.000Z' });
  assert.deepEqual(again.diagnostics.map((d) => formatDiagnostic(d)), []);
  const looks = (stroke: Stroke): unknown[] => styleSegments(stroke).map((s) => [s.start, s.end, s.attrs.config !== undefined, s.attrs.color, s.attrs.fontSize, s.attrs.fontStyle, s.attrs.underline]);
  book.sketches[0].strokes.forEach((stroke, i) => assert.deepEqual(looks(again.book.sketches[0].strokes[i]), looks(stroke)));
  assert.deepEqual(again.book.textConfigs?.map((config) => [config.name, config.attrs]), book.textConfigs?.map((config) => [config.name, config.attrs]));
});

test('a document a script copies in follows the script\'s configuration of the same name, and brings one it has not', async () => {
  const { evaluate, formatDiagnostic } = await import('../src/core/script/index.js');
  const stamp = { timestamp: '2026-10-03T00:00:00.000Z' };
  const badge = evaluate('napkin 1\ntextconfig "Callout" color #00aa00\ntextconfig "Quiet" color #888888\ntext "Badge" at 0 0 runs (0 2 config "Callout", 2 5 config "Quiet")', stamp).book;
  const result = evaluate('napkin 1\ntextconfig "Callout" color #0000ff\nuse "badge" at 10 10', { ...stamp, documents: { badge } });
  assert.deepEqual(result.diagnostics.map((d) => formatDiagnostic(d)), []);
  assert.deepEqual(result.book.textConfigs?.map((config) => [config.name, config.attrs.color]), [['Callout', '#0000ff'], ['Quiet', '#888888']]);
  const copied = result.book.sketches[0].strokes.find((stroke) => stroke.text === 'Badge')!;
  assert.equal(charAttrsAt(copied, 0).color, '#0000ff', "the script's Callout");
  assert.equal(charAttrsAt(copied, 3).color, '#888888', 'and the document\'s Quiet');
  const ids = new Set(result.book.textConfigs?.map((config) => config.id));
  assert.equal(ids.size, 2, 'each with an id of its own');
});
