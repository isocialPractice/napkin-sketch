/**
 * The documentation site under `docs/`, which `npm run site` writes from
 * Markdown (`src/docs/site.ts`).
 *
 * Every file is what the generator writes today, so a Markdown edit without
 * `npm run site` fails here. The chrome - the bar, the menu, the footer - is
 * one copy stamped into every page, and stays one: the pages agree once the
 * two things that rightly differ, the relative prefix and which menu group is
 * open, are set aside. Every relative link on every page reaches a file the
 * site publishes, and every `#anchor` a heading on its page. The manifest and
 * the sources agree both ways, the generator never writes the Markdown the
 * npm package ships, the landing page names the version it documents, the
 * stylesheet holds the design language's values, and the README's headings
 * that moved point at pages that exist. The Markdown converter is held to
 * the constructs the pages use, and the napkin examples moved out of the
 * README still run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { evaluate } from '../src/core/script/index.js';
import {
  buildSite,
  headingAnchors,
  renderMarkdown,
  SITE_COPIES,
  SITE_DIR,
  SITE_PAGES,
  SITE_STATIC,
  SITE_URL,
  SOURCE_DIR,
  type LinkContext,
} from '../src/docs/site.js';
import { repoRoot } from './helpers/repo-root.js';

const ROOT = repoRoot();
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  version: string;
  description: string;
  scripts: Record<string, string>;
};
const full = (path: string): string => join(ROOT, ...path.split('/'));
const reader = {
  read: (path: string): string | null => (existsSync(full(path)) && statSync(full(path)).isFile() ? readFileSync(full(path), 'utf8') : null),
  isFolder: (path: string): boolean => existsSync(full(path)) && statSync(full(path)).isDirectory(),
};
const FILES = buildSite(reader, {
  version: pkg.version,
  description: pkg.description,
  scripts: pkg.scripts,
  license: reader.read('LICENSE') ?? undefined,
});
const PAGE_FILES = SITE_PAGES.map((page) => `${SITE_DIR}/${page.out}`);
const html = (out: string): string => readFileSync(full(`${SITE_DIR}/${out}`), 'utf8');

function markdownUnder(dir: string): string[] {
  if (!existsSync(full(dir))) return [];
  return readdirSync(full(dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(full(path)).isDirectory()) return markdownUnder(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

test('every file is what npm run site writes today (run npm run site when this fails)', () => {
  for (const file of FILES) {
    assert.ok(existsSync(full(file.path)), `${file.path} is missing`);
    assert.equal(readFileSync(full(file.path), 'utf8').replace(/\r\n/g, '\n'), file.text, file.path);
  }
  for (const path of SITE_STATIC) assert.ok(existsSync(full(`${SITE_DIR}/${path}`)), `${SITE_DIR}/${path} is kept by hand and must exist`);
});

test('the generator writes the site and its own sources, never the Markdown the package ships', () => {
  for (const file of FILES) {
    const ours = file.path.startsWith(`${SOURCE_DIR}/`) || (file.path.startsWith(`${SITE_DIR}/`) && !file.path.endsWith('.md'));
    assert.ok(ours, `${file.path} is not the site's to write`);
  }
});

test('every page in the manifest has a source, and every source is in the manifest', () => {
  const outs = new Set<string>();
  for (const page of SITE_PAGES) {
    assert.ok(reader.read(page.source) !== null, `${page.out}: ${page.source} is missing`);
    assert.ok(!outs.has(page.out), `${page.out} is in the manifest twice`);
    outs.add(page.out);
    assert.ok(page.desc.length > 20 && page.title.length > 0 && page.nav.length > 0, page.out);
  }
  const listed = new Set(SITE_PAGES.map((page) => page.source));
  for (const source of markdownUnder(SOURCE_DIR)) assert.ok(listed.has(source), `${source} is a site source no page renders`);
  for (const source of markdownUnder('docs/api')) assert.ok(listed.has(source), `${source} is an API page the site leaves out`);
});

/**
 * A page's chrome with what rightly differs set aside: every relative link is
 * resolved from the page's folder to the site's root, and the open menu group,
 * the current page and the page's own source link are dropped.
 */
function chrome(out: string): string {
  const page = html(out);
  const head = page.slice(page.indexOf('<body>'), page.indexOf('<main'));
  const foot = page.slice(page.indexOf('<footer'), page.indexOf('</footer>'));
  return (head + foot)
    .replace(/(href|src)="([^"#:]+)(?=["#])/g,(_, attr: string, path: string) => `${attr}="${posix.normalize(posix.join(posix.dirname(out), path))}`)
    .replace(/ open>/g, '>')
    .replace(/ aria-current="page"/g, '')
    .replace(/<a href="[^"]*" rel="noopener">This page's source<\/a>/, '');
}

test('every page carries the same chrome, stamped from one copy', () => {
  const first = chrome(SITE_PAGES[0].out);
  for (const page of SITE_PAGES) assert.equal(chrome(page.out), first, page.out);
});

test('every page marks itself in the menu, and opens its own group', () => {
  for (const page of SITE_PAGES) {
    const text = html(page.out);
    const menu = text.slice(text.indexOf('<nav class="sidebar"'), text.indexOf('</nav>', text.indexOf('<nav class="sidebar"')));
    assert.equal((menu.match(/aria-current="page"/g) ?? []).length, 1, page.out);
    const opened = (menu.match(/<details class="nav-group" open>/g) ?? []).length;
    assert.equal(opened, page.group ? 1 : 0, `${page.out}: its group, and only its, is open`);
  }
});

/** The ids of a page's headings and anchors. */
function ids(text: string): Set<string> {
  return new Set([...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

test('every relative link reaches a published file, and every anchor a heading', () => {
  const problems: string[] = [];
  for (const page of SITE_PAGES) {
    const text = html(page.out);
    for (const m of text.matchAll(/\s(href|src)="([^"]*)"/g)) {
      const href = m[2].replace(/&amp;/g, '&');
      if (/^(https?:|mailto:)/.test(href)) continue;
      const [path, anchor] = href.split('#');
      const target = path === '' ? page.out : posix.normalize(posix.join(posix.dirname(page.out), path));
      const file = `${SITE_DIR}/${target}`;
      if (!existsSync(full(file))) {
        problems.push(`${page.out}: ${href} reaches nothing`);
        continue;
      }
      if (anchor && target.endsWith('.html') && !ids(readFileSync(full(file), 'utf8')).has(decodeURIComponent(anchor))) {
        problems.push(`${page.out}: ${href} has no such heading`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('every link leaving the site is to the repository, a known host, or mail', () => {
  for (const page of SITE_PAGES) {
    for (const m of html(page.out).matchAll(/\shref="(https?:[^"]*)"/g)) {
      const href = m[1];
      if (href.startsWith('https://github.com/isocialPractice/napkin-sketch')) continue;
      assert.ok(/^https:\/\//.test(href), `${page.out}: ${href} is not https`);
    }
  }
});

test('the landing page names the version it documents, and every page shows it', () => {
  assert.match(html('index.html'), new RegExp(`This documents napkin-sketch <strong>${pkg.version.replace(/\./g, '\\.')}</strong>`));
  for (const page of SITE_PAGES) assert.ok(html(page.out).includes(`<span class="version" title="The version these pages document">${pkg.version}</span>`), page.out);
});

test('the site copies what it publishes, and nothing on it fetches or reaches outside it', () => {
  for (const [out, from] of Object.entries(SITE_COPIES)) assert.equal(readFileSync(full(`${SITE_DIR}/${out}`), 'utf8'), readFileSync(full(from), 'utf8'), out);
  const script = readFileSync(full(`${SITE_DIR}/assets/site.js`), 'utf8');
  assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|import\(/, 'site.js fetches nothing');
  for (const page of SITE_PAGES) assert.doesNotMatch(html(page.out), /(href|src)="\//, `${page.out} has an absolute path`);
});

/**
 * Whether a GIF plays more than once: it does when it carries the
 * NETSCAPE2.0 block, which sets a loop count. Without it a browser plays the
 * frames once and holds the last.
 */
function gifLoops(bytes: Buffer): boolean {
  const skip = (from: number): number => {
    while (bytes[from] !== 0) from += bytes[from] + 1;
    return from + 1;
  };
  let at = 13;
  if (bytes[10] & 0x80) at += 3 * (1 << ((bytes[10] & 7) + 1));
  while (at < bytes.length && bytes[at] !== 0x3b) {
    if (bytes[at] === 0x21) {
      if (bytes[at + 1] === 0xff && bytes.toString('latin1', at + 3, at + 14) === 'NETSCAPE2.0') return true;
      at = skip(at + 2);
    } else if (bytes[at] === 0x2c) {
      const packed = bytes[at + 9];
      at += 10;
      if (packed & 0x80) at += 3 * (1 << ((packed & 7) + 1));
      at = skip(at + 1);
    } else {
      throw new Error(`no GIF block starts at byte ${at}`);
    }
  }
  return false;
}

test('the home page opens on the banner, which plays once and holds its last frame', () => {
  const home = html('index.html');
  assert.match(home, /<\/h1>\n<p><img src="assets\/banner\.gif" alt="[^"]{20,}"[^>]*><\/p>\n<details class="toc"/, 'the banner is the hero, above the contents');
  const gif = readFileSync(full(`${SITE_DIR}/assets/banner.gif`));
  assert.equal(gif.toString('latin1', 0, 6), 'GIF89a');
  assert.equal(gifLoops(gif), false, 'a loop block would play it again and again');
});

test("the stylesheet holds the design language's values", () => {
  const css = readFileSync(full(`${SITE_DIR}/assets/site.css`), 'utf8');
  const design = readFileSync(full('DESIGN_LANGUAGE.md'), 'utf8').toLowerCase();
  const tokens = [...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)];
  assert.ok(tokens.length >= 20);
  for (const [, name, hex] of tokens) {
    assert.ok(design.includes(`\`--${name}\``), `--${name} is in DESIGN_LANGUAGE.md`);
    assert.ok(design.includes(hex.toLowerCase()), `--${name}'s ${hex} is in DESIGN_LANGUAGE.md`);
  }
});

test("the README's moved sections link to pages the site has", () => {
  const readme = readFileSync(full('README.md'), 'utf8');
  const links = [...readme.matchAll(/\]\((https:\/\/isocialpractice\.github\.io\/napkin-sketch\/[^)]*)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 20, `the README links the site (${links.length})`);
  for (const link of links) {
    const [path, anchor] = link.slice(SITE_URL.length).split('#');
    assert.ok(SITE_PAGES.some((page) => page.out === path), `${link}: no such page`);
    if (anchor) assert.ok(ids(html(path)).has(anchor), `${link}: no such heading`);
  }
  // Other files link to these headings, and GitHub makes their anchors from the words.
  for (const heading of ['Embedding the editor', 'Animation Mode', 'Drawing from a script', 'The graphic-designer helper', 'The scripting helper']) {
    assert.match(readme, new RegExp(`^#{2,3} \\[${heading}\\]\\(`, 'm'), heading);
  }
  assert.match(readme, /^`Ctrl \+ click` to view \[napkin-sketch documentation\]\(https:\/\/isocialpractice\.github\.io\/napkin-sketch\/index\.html\)/m);
});

test("the napkin examples moved out of the README still run", () => {
  let blocks = 0;
  for (const source of markdownUnder(SOURCE_DIR)) {
    const text = readFileSync(full(source), 'utf8').replace(/\r\n/g, '\n');
    for (const m of text.matchAll(/```napkin\n([\s\S]*?)```/g)) {
      blocks++;
      const result = evaluate(m[1], { timestamp: '2026-09-26T00:00:00.000Z' });
      assert.deepEqual(result.diagnostics.filter((d) => d.level === 'error'), [], `${source}: a napkin block`);
    }
  }
  assert.ok(blocks >= 2, `found ${blocks} napkin blocks`);
});

// ---- The converter -------------------------------------------------------------------------------

const CONTEXT: LinkContext = { source: 'docs/site-src/guide/x.md', out: 'guide/x.html', link: (href) => `LINK(${href})` };
const render = (md: string): string => renderMarkdown(md, CONTEXT).html;

test('headings get the anchors GitHub gives them, repeats numbered', () => {
  assert.deepEqual(headingAnchors('# The `.skbk` file format\n## Rotate\n## Rotate\n```\n# not a heading\n```\n### [Link](x.md) text'), [
    'the-skbk-file-format',
    'rotate',
    'rotate-1',
    'link-text',
  ]);
  const out = render('## Rotate\n\n## Rotate');
  assert.match(out, /<h2 id="rotate">Rotate<a class="anchor" href="#rotate"/);
  assert.match(out, /<h2 id="rotate-1">/);
});

test('inline code, emphasis, links and escapes render as GitHub renders them', () => {
  assert.equal(render('Press `Ctrl+T` **now**, *then* a [link](a.md) and a\\|pipe.'), '<p>Press <code>Ctrl+T</code> <strong>now</strong>, <em>then</em> a <a href="LINK(a.md)">link</a> and a|pipe.</p>');
  assert.equal(render('snake_case_word and `a_b` stay'), '<p>snake_case_word and <code>a_b</code> stay</p>');
  assert.equal(render('``code with ` tick``'), '<p><code>code with ` tick</code></p>');
  assert.equal(render('<https://example.com> and a <b> tag'), '<p><a href="https://example.com" rel="noopener">https://example.com</a> and a &lt;b&gt; tag</p>');
  assert.equal(render('![A *picture*](p.svg)'), '<p><img src="LINK(p.svg)" alt="A picture" loading="lazy"></p>');
});

test('nested lists, loose and tight, with code inside', () => {
  const tight = render('- one\n  - nested\n- two\n  continued');
  assert.equal(tight, '<ul>\n<li>one\n<ul>\n<li>nested</li>\n</ul></li>\n<li>two\ncontinued</li>\n</ul>');
  const numbered = render('3. first\n\n   ```bash\n   npm test\n   ```\n4. second');
  assert.match(numbered, /^<ol start="3">/);
  assert.match(numbered, /<pre><code class="language-bash">npm test<\/code><\/pre>/);
});

test('tables keep escaped pipes and alignment, and quotes and fences render', () => {
  const table = render('| A | B |\n| :-- | --: |\n| `x \\| y` | 2 |');
  assert.match(table, /<th style="text-align:left">A<\/th><th style="text-align:right">B<\/th>/);
  assert.match(table, /<td style="text-align:left"><code>x \| y<\/code><\/td>/);
  assert.equal(render('> **Note** it'), '<blockquote><p><strong>Note</strong> it</p></blockquote>');
  assert.equal(render('```napkin\nrect 1 2 3 4 <x>\n```'), '<pre><code class="language-napkin">rect 1 2 3 4 &lt;x&gt;</code></pre>');
  assert.equal(render('<!-- a:start -->\ntext\n<!-- a:end -->'), '<p>text</p>');
});
