/**
 * The documentation window's decisions (`src/main/docs.ts`), which Help >
 * Verbose and the Help > Tool Types rows act on: where the pages are read
 * from, which page names reach a file, what a row does when the pages are
 * missing, where a link in them may go, and which keys move through them.
 * The Help rows' pages are held to the site, so a renamed page fails here
 * rather than as a toast in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DOCS_MISSING,
  docsAppCommand,
  docsKey,
  docsLink,
  docsPagePath,
  docsPlan,
  docsRoot,
  type DocsKeyInput,
} from '../src/main/docs.js';
import { DOCS_INDEX_PAGE, DOCS_SITE_ADDRESS, DOCS_SITE_URL, docsPageFile, REPO_URL } from '../src/core/menu/links.js';
import { defaultRegistry, helpTopics } from '../src/core/menu/registry.js';
import { SITE_DIR, SITE_PAGES } from '../src/docs/site.js';
import { repoRoot } from './helpers/repo-root.js';

const ROOT = resolve('napkin', 'docs');

test("the pages are the resources folder's docs when packaged, and the repository's otherwise", () => {
  const resources = resolve('install', 'resources');
  const mainDir = resolve('repo', 'dist', 'main');
  assert.equal(docsRoot({ packaged: true, resourcesPath: resources, mainDir }), join(resources, 'docs'));
  assert.equal(docsRoot({ packaged: false, resourcesPath: resources, mainDir }), resolve('repo', 'docs'));
});

test('a page name reaches its file under the root, and no other name reaches anything', () => {
  assert.equal(docsPagePath(ROOT, 'guide/index'), join(ROOT, 'guide', 'index.html'));
  assert.equal(docsPagePath(ROOT, 'api/language/cheatsheet'), join(ROOT, 'api', 'language', 'cheatsheet.html'));
  assert.equal(docsPagePath(ROOT, 'import-export'), join(ROOT, 'import-export.html'));
  for (const page of ['', '../secret', 'guide/../../x', '/etc/passwd', 'C:/x', 'guide//index', 'Guide/Index', 'guide/index.html', 'guide\\index', '-x', 'guide/', ' guide']) {
    assert.equal(docsPagePath(ROOT, page), null, JSON.stringify(page));
  }
});

test('Help > Verbose and every Tool Types row open a page the site publishes', () => {
  const pages = [DOCS_INDEX_PAGE, ...helpTopics(defaultRegistry()).map((topic) => topic.page)];
  assert.equal(pages.length, 6);
  for (const page of pages) {
    assert.ok(SITE_PAGES.some((site) => site.out === docsPageFile(page)), `${page} is a page of the site`);
    const file = docsPagePath(join(repoRoot(), SITE_DIR), page);
    assert.ok(file !== null && existsSync(file), `${page} is on disk (npm run site)`);
  }
});

test('a Help row opens the window when its page is on disk, the site when it is not, and says where the pages come from otherwise', () => {
  const site = 'https://example.org/napkin/';
  const file = join(ROOT, 'quickstart', 'draw.html');
  assert.deepEqual(docsPlan('quickstart/draw', ROOT, (f) => f === file, site), { kind: 'window', file });
  assert.deepEqual(docsPlan('quickstart/draw', ROOT, () => false, site), { kind: 'browser', url: 'https://example.org/napkin/quickstart/draw.html' });
  assert.deepEqual(docsPlan('quickstart/draw', ROOT, () => false, null), { kind: 'notice', message: DOCS_MISSING });
  // A name that is no page's never reaches the disk; the site's front page is the nearest thing.
  assert.deepEqual(docsPlan('../x', ROOT, () => true, site), { kind: 'browser', url: 'https://example.org/napkin/index.html' });
  assert.deepEqual(docsPlan('../x', ROOT, () => true, null), { kind: 'notice', message: DOCS_MISSING });
  assert.match(DOCS_MISSING, /npm run site/);
});

test('a link in the pages stays when it is a page, opens in the browser when it is on the web, and goes nowhere otherwise', () => {
  const page = (...parts: string[]): string => pathToFileURL(join(ROOT, ...parts)).href;
  assert.deepEqual(docsLink(page('guide', 'tools.html'), ROOT), { kind: 'stay' });
  assert.deepEqual(docsLink(`${page('guide', 'transform.html')}#rotate`, ROOT), { kind: 'stay' });
  assert.deepEqual(docsLink(page('assets', 'mark.svg'), ROOT), { kind: 'stay' });
  assert.deepEqual(docsLink(`${REPO_URL}/blob/main/README.md`, ROOT), { kind: 'browser', url: `${REPO_URL}/blob/main/README.md` });
  assert.deepEqual(docsLink('http://example.com/a', ROOT), { kind: 'browser', url: 'http://example.com/a' });
  assert.deepEqual(docsLink('mailto:someone@example.com', ROOT), { kind: 'browser', url: 'mailto:someone@example.com' });
  const refused = [
    pathToFileURL(ROOT).href, // the folder itself
    pathToFileURL(join(ROOT, '..', 'secret.txt')).href,
    pathToFileURL(`${ROOT}-old${'/'}index.html`).href, // a folder whose name starts with the root's
    'file:///Z:/elsewhere/docs/index.html',
    'javascript:alert(1)',
    'data:text/html,<p>hi</p>',
    'chrome://gpu',
    'not a link',
  ];
  for (const url of refused) assert.deepEqual(docsLink(url, ROOT), { kind: 'refuse' }, url);
});

const key = (name: string, mods: Partial<DocsKeyInput> = {}): DocsKeyInput => ({
  type: 'keyDown',
  key: name,
  alt: false,
  control: false,
  meta: false,
  shift: false,
  ...mods,
});

test("Alt and an arrow move through the pages, Ctrl+W closes the window, and every other key is the page's", () => {
  assert.equal(docsKey(key('ArrowLeft', { alt: true }), false), 'back');
  assert.equal(docsKey(key('ArrowRight', { alt: true }), false), 'forward');
  assert.equal(docsKey(key('BrowserBack'), false), 'back');
  assert.equal(docsKey(key('BrowserForward'), false), 'forward');
  assert.equal(docsKey(key('w', { control: true }), false), 'close');
  assert.equal(docsKey(key('W', { control: true }), false), 'close', 'with Caps Lock on');
  for (const input of [
    key('ArrowLeft'),
    key('ArrowLeft', { control: true }),
    key('ArrowLeft', { alt: true, shift: true }),
    key('ArrowLeft', { alt: true, type: 'keyUp' }),
    key('[', { alt: true }),
    key('w'),
    key('w', { control: true, shift: true }),
    key('w', { meta: true }),
    key('c', { control: true }),
  ]) {
    assert.equal(docsKey(input, false), null, JSON.stringify(input));
  }
});

test('on macOS, Cmd and an arrow or a bracket move through the pages, and Cmd+W closes', () => {
  assert.equal(docsKey(key('ArrowLeft', { meta: true }), true), 'back');
  assert.equal(docsKey(key('[', { meta: true }), true), 'back');
  assert.equal(docsKey(key(']', { meta: true }), true), 'forward');
  assert.equal(docsKey(key('ArrowRight', { meta: true }), true), 'forward');
  assert.equal(docsKey(key('w', { meta: true }), true), 'close');
  assert.equal(docsKey(key('w', { control: true }), true), null);
  assert.equal(docsKey(key('ArrowLeft', { alt: true }), true), null);
});

test("the mouse's side buttons go back and forward", () => {
  assert.equal(docsAppCommand('browser-backward'), 'back');
  assert.equal(docsAppCommand('browser-forward'), 'forward');
  assert.equal(docsAppCommand('media-play-pause'), null);
});

test('Source Docs waits for a checked deployment, and then opens the address the site is written for', () => {
  assert.equal(DOCS_SITE_ADDRESS, 'https://isocialpractice.github.io/napkin-sketch/');
  assert.ok(DOCS_SITE_URL === null || DOCS_SITE_URL === DOCS_SITE_ADDRESS, 'set only to the address the site links');
  assert.equal(REPO_URL, 'https://github.com/isocialPractice/napkin-sketch');
});
