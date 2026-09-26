/**
 * `napkin-sketch/node`: a script read from a file, the images and documents
 * it names read in by the host, links read inside one folder, and a drawing
 * written out as files - on a real file system, in a temporary folder each
 * test makes and removes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import {
  drawFile,
  drawToFiles,
  loadAssets,
  loadDocuments,
  readScript,
  writeBook,
} from '../src/api/node.js';
import { fileStem, scriptName } from '../src/core/script-files.js';
import { evaluate } from '../src/core/script/index.js';
import { decodePng, encodePng, isPng } from '../src/core/graphic-design/index.js';
import { parseSketchBook, serializeSketchBook } from '../src/core/serialize.js';
import { BADGE } from './helpers/script-fixtures.js';

const TIME = '2026-09-25T00:00:00.000Z';

/** Runs `body` with a fresh temporary folder, removed afterwards whatever happens. */
async function inFolder(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-files-'));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A 2 by 2 PNG in one color, as bytes. */
function pngBytes(): Uint8Array {
  return encodePng(new Uint8Array([50, 100, 120, 255, 50, 100, 120, 255, 50, 100, 120, 255, 50, 100, 120, 255]), 2, 2);
}

/** The straight RGBA of one pixel of a PNG. */
function pixel(png: Uint8Array, x: number, y: number): number[] {
  const image = decodePng(png);
  const i = (y * image.width + x) * 4;
  return [...image.data.slice(i, i + 4)];
}

test('readScript reads napkin text, and a .json file as the object form', async () => {
  await inFolder(async (dir) => {
    writeFileSync(join(dir, 'card.napkin'), '\uFEFFnapkin 1\ncircle 10 10 5\n');
    assert.equal(await readScript(join(dir, 'card.napkin')), 'napkin 1\ncircle 10 10 5\n', 'text, with a byte-order mark left out');
    const script = [{ verb: 'napkin', version: 1 }, { verb: 'circle', cx: 10, cy: 10, r: 5 }];
    writeFileSync(join(dir, 'card.napkin.json'), JSON.stringify(script));
    assert.deepEqual(await readScript(join(dir, 'card.napkin.json')), script);
    writeFileSync(join(dir, 'broken.json'), '[{ "verb": "circle",');
    await assert.rejects(readScript(join(dir, 'broken.json')), /broken\.json is not JSON/);
    writeFileSync(join(dir, 'object.json'), '{ "verb": "circle" }');
    await assert.rejects(readScript(join(dir, 'object.json')), /object\.json is JSON but not a script, which is an array of instructions/);
    await assert.rejects(readScript(join(dir, 'missing.napkin')), /ENOENT/, 'a file that is not there is an error, not a diagnostic');
  });
  assert.deepEqual(
    ['card.napkin', 'card.napkin.json', 'CARD.NAPKIN.JSON', 'my.card.napkin', 'notes.txt', 'README', '.napkin'].map(scriptName),
    ['card', 'card', 'CARD', 'my.card', 'notes', 'README', 'drawing'],
  );
});

test('drawToFiles writes one file a format, under the name the script gives its page', async () => {
  await inFolder(async (dir) => {
    const out = join(dir, 'out');
    const result = await drawToFiles('napkin 1\npage 200 100\nname "card"\nfill #ffe08a\nrect 10 10 180 80 r 8\n', {
      out,
      formats: ['svg', 'png', 'pdf', 'skbk'],
      timestamp: TIME,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.stats.marks, 1);
    assert.deepEqual(
      result.files,
      [
        { path: join(out, 'card.svg'), format: 'svg', page: 1 },
        { path: join(out, 'card.png'), format: 'png', page: 1 },
        { path: join(out, 'card.pdf'), format: 'pdf' },
        { path: join(out, 'card.skbk'), format: 'skbk' },
      ],
      'the output folder is made, and each file is named after the page',
    );
    assert.ok(readFileSync(join(out, 'card.svg'), 'utf8').startsWith('<?xml'));
    const png = new Uint8Array(readFileSync(join(out, 'card.png')));
    assert.ok(isPng(png));
    assert.deepEqual([decodePng(png).width, decodePng(png).height], [200, 100]);
    assert.ok(readFileSync(join(out, 'card.pdf'), 'latin1').startsWith('%PDF-1.4'));
    const book = parseSketchBook(readFileSync(join(out, 'card.skbk'), 'utf8'));
    assert.equal(book.sketches[0].strokes.length, 1, 'the .skbk is the drawing, to open in the app');
    assert.equal(book.updatedAt, TIME, 'with the time the run was given');
    assert.deepEqual(readdirSync(out).sort(), ['card.pdf', 'card.png', 'card.skbk', 'card.svg'], 'and no scratch file is left behind');
  });
});

test('several pages are a file a page for SVG and PNG, numbered from 1, and one PDF for the book', async () => {
  await inFolder(async (dir) => {
    const result = await drawToFiles('napkin 1\npage 100 100\ncircle 50 50 20\nnewpage\nrect 20 20 60 60\n', {
      out: dir,
      formats: ['png', 'pdf', 'png'],
    });
    assert.deepEqual(
      result.files.map((file) => [file.path.slice(dir.length + 1), file.page]),
      [
        ['drawing-1.png', 1],
        ['drawing-2.png', 2],
        ['drawing.pdf', undefined],
      ],
      'a format asked for twice is written once',
    );
    assert.equal(readFileSync(join(dir, 'drawing.pdf'), 'latin1').match(/\/Type \/Page /g)?.length, 2);
  });
});

test('a name given wins over the script\'s, and no name reaches outside the output folder', async () => {
  await inFolder(async (dir) => {
    const out = join(dir, 'out');
    const named = await drawToFiles('napkin 1\nname "card"\ncircle 50 50 20\n', { out, name: 'poster' });
    assert.deepEqual(named.files.map((file) => file.path), [join(out, 'poster.svg')]);
    const escaping = await drawToFiles('napkin 1\nname "../../escape"\ncircle 50 50 20\n', { out });
    assert.deepEqual(escaping.files.map((file) => file.path), [join(out, '-..-escape.svg')], 'the separators become dashes');
    for (const file of escaping.files) assert.ok(resolve(file.path).startsWith(resolve(out) + sep));
    assert.deepEqual(readdirSync(dir), ['out'], 'nothing was written beside the output folder');
  });
  assert.equal(fileStem('Acme Corp: Q3 <draft>?'), 'Acme Corp- Q3 -draft--');
  assert.equal(fileStem('  ..hidden..  '), 'hidden');
  assert.equal(fileStem('con'), 'con-drawing', 'a Windows device name is never a file name');
  assert.equal(fileStem('...'), 'drawing');
  assert.equal(fileStem('x'.repeat(300)).length, 120);
});

test('drawFile names the book after the file, and reads the links beside the script', async () => {
  await inFolder(async (dir) => {
    mkdirSync(join(dir, 'art'));
    writeFileSync(
      join(dir, 'art', 'logo.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#326478"/></svg>',
    );
    writeFileSync(join(dir, 'secret.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ff0000"/></svg>');
    writeFileSync(
      join(dir, 'art', 'card.napkin'),
      'napkin 1\npage 200 100\nlink "logo.svg" at 10 10 size 40 40\nlink "../secret.svg" at 100 10 size 40 40\n',
    );
    const out = join(dir, 'out');
    const result = await drawFile(join(dir, 'art', 'card.napkin'), { out, formats: ['png'] });
    assert.deepEqual(result.files.map((file) => file.path), [join(out, 'card.png')], 'named after card.napkin');
    const png = new Uint8Array(readFileSync(join(out, 'card.png')));
    assert.deepEqual(pixel(png, 30, 30), [50, 100, 120, 255], 'the link beside the script is drawn from its file');
    assert.notDeepEqual(pixel(png, 120, 30), [255, 0, 0, 255], 'a link out of the script\'s folder is not followed');
    assert.deepEqual(result.warnings, ['page "card": link "../secret.svg" could not be read, so its placeholder was drawn']);
  });
});

test('assets and documents are read by name, from paths or as they are given', async () => {
  await inFolder(async (dir) => {
    writeFileSync(join(dir, 'logo.png'), pngBytes());
    writeFileSync(join(dir, 'badge.skbk'), serializeSketchBook({ ...evaluate('napkin 1\ncircle 20 20 10\n').book, name: 'badge' }));
    const assets = await loadAssets({ logo: 'logo.png', inline: 'data:image/png;base64,AAAA' }, dir);
    assert.match(assets.logo, /^data:image\/png;base64,iVBORw0KGgo/);
    assert.equal(assets.inline, 'data:image/png;base64,AAAA', 'a data URL is kept as it is');
    await assert.rejects(loadAssets({ logo: 'nope.png' }, dir), /asset "logo" could not be read from .*nope\.png/);
    const documents = await loadDocuments({ badge: join(dir, 'badge.skbk'), page: BADGE });
    assert.equal((documents.badge as { name: string }).name, 'badge');
    assert.equal(documents.page, BADGE, 'a page in hand is kept as it is');
    await assert.rejects(loadDocuments({ badge: join(dir, 'nope.skbk') }), /document "badge" could not be read/);

    const result = await drawToFiles('napkin 1\npage 100 100\nimage "logo" at 10 10 size 20\nuse "badge" at 50 50\n', {
      out: dir,
      assets: { logo: join(dir, 'logo.png') },
      documents: { badge: join(dir, 'badge.skbk') },
    });
    assert.deepEqual(result.diagnostics, [], 'the image and the document were there for the script to name');
    assert.equal(result.stats.marks, 2);
  });
});

test('a script with errors still writes what it drew, unless strict', async () => {
  await inFolder(async (dir) => {
    const broken = await drawToFiles('napkin 1\ncircl 10 10 5\ncircle 50 50 20\n', { out: join(dir, 'loose') });
    assert.equal(broken.ok, false);
    assert.deepEqual(broken.diagnostics.map((d) => d.code), ['unknown-verb']);
    assert.equal(broken.files.length, 1, 'the page is written, with the circle that could be drawn');

    const warned = await drawToFiles('circle 50 50 20\n', { out: join(dir, 'strict'), strict: true });
    assert.deepEqual(warned.diagnostics.map((d) => d.code), ['version-missing']);
    assert.equal(warned.ok, false, 'strict: a warning is enough to fail');
    assert.deepEqual(warned.files, []);
    assert.equal(existsSync(join(dir, 'strict')), false, 'and nothing is written');

    const leftOut = await drawToFiles('napkin 1\nlink "nowhere.svg" at 10 10 size 20 20\n', {
      out: join(dir, 'strict'),
      formats: ['png'],
      base: dir,
      strict: true,
    });
    assert.deepEqual(leftOut.diagnostics, []);
    assert.equal(leftOut.warnings.length, 1, 'the PNG drew the link as its placeholder');
    assert.equal(leftOut.ok, false, 'which strict counts too');
    assert.equal(existsSync(join(dir, 'strict')), false);
  });
});

test('writeBook writes a book already drawn, whole, over what was there', async () => {
  await inFolder(async (dir) => {
    const first = evaluate('napkin 1\npage 100 100\nname "frame"\ncircle 50 50 20\n', { timestamp: TIME }).book;
    const second = evaluate('napkin 1\npage 100 100\nname "frame"\nrect 20 20 60 60\n', { timestamp: TIME }).book;
    await writeBook(first, { out: dir, formats: ['svg', 'skbk'] });
    const written = await writeBook(second, { out: dir, formats: ['svg', 'skbk'] });
    assert.deepEqual(written.map((file) => file.path), [join(dir, 'frame.svg'), join(dir, 'frame.skbk')]);
    assert.equal(parseSketchBook(readFileSync(join(dir, 'frame.skbk'), 'utf8')).sketches[0].strokes[0].vector?.anchors.length, 4, 'the second book is there');
    assert.deepEqual(readdirSync(dir).sort(), ['frame.skbk', 'frame.svg'], 'with no scratch files beside it');
    const cropped = await writeBook(first, { out: dir, name: 'sprite', crop: 'auto', transparent: true, formats: ['png'], scale: 2 });
    const png = decodePng(new Uint8Array(readFileSync(cropped[0].path)));
    assert.deepEqual([png.width, png.height], [86, 86], 'render options reach the files: the ink, grown by half the line, at twice the size');
  });
});
