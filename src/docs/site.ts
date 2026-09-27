/**
 * The documentation site: every page written as static HTML under `docs/`,
 * from Markdown, with one chrome stamped into every page.
 *
 * The pages come from three kinds of source. The API documentation and the
 * root guides (`QUICKSTART.md`, `CHEATSHEET.md`, `API*.md`, `CHANGELOG.md`)
 * ship in the npm package and `npm run api-docs` rewrites their tables every
 * release, so the site renders them where they are and never edits them. The
 * app's manual, moved out of the README, lives in `docs/site-src/` as
 * Markdown a person edits. The landing page, the guide's overview and About
 * are Markdown there too, with lists this generator fills in.
 *
 * {@link SITE_PAGES} is the manifest: every page, its source, its place in
 * the menu. {@link renderMarkdown} converts the subset of Markdown these
 * pages use - headings, paragraphs, nested lists, tables, fenced code,
 * block quotes, images, emphasis, code spans and links - and nothing more;
 * a page that needs more fails the test rather than rendering wrong.
 * {@link buildSite} does the rest: fills the generated blocks in the
 * sources, rewrites each link to the page that now holds its target, and
 * wraps each page in the chrome, which is written once, here.
 *
 * Every link the site writes is relative, because a project site is served
 * from `/napkin-sketch/` and the same files open from `file://` in the app's
 * Help window. Nothing fetches. Pure: the caller reads and writes the files.
 */

import { posix } from 'node:path';

import { defaultSettings, SETTINGS_LIMITS } from '../core/settings.js';
import { DOCS_SITE_ADDRESS, REPO_URL } from '../core/menu/links.js';
import { DOC_CATEGORIES, HUB_PAGES } from './api-docs.js';
import { replaceBetweenMarkers } from '../core/script/reference.js';

/** Where the repository lives; files the site does not publish are linked there. */
export { REPO_URL };

/** Where the site is published once Pages deploys it. */
export const SITE_URL = DOCS_SITE_ADDRESS;

/** The folder the site is written to, and the one its own Markdown sources live in. */
export const SITE_DIR = 'docs';
export const SOURCE_DIR = 'docs/site-src';

/** A section of the menu, in the order the menu shows them. */
export const SECTIONS = [
  { id: 'start', label: 'Start' },
  { id: 'quickstarts', label: 'Quickstarts' },
  { id: 'guide', label: 'Using the app' },
  { id: 'api', label: 'Drawing from a script' },
  { id: 'building', label: 'Building on it' },
  { id: 'developing', label: 'Developing' },
  { id: 'project', label: 'Project' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/** One page of the site. */
export interface SitePage {
  /** The page's path under `docs/`: `guide/tools.html`. */
  readonly out: string;
  /** The Markdown it is rendered from, from the repository root. */
  readonly source: string;
  /** The page's title, for the browser tab and the breadcrumb. */
  readonly title: string;
  /** Its label in the menu. */
  readonly nav: string;
  /** One sentence: the meta description, and its line in the lists of pages. */
  readonly desc: string;
  readonly section: SectionId;
  /** A group inside the section, drawn as a folding list: the API categories. */
  readonly group?: string;
}

const page = (out: string, source: string, title: string, nav: string, section: SectionId, desc: string, group?: string): SitePage => ({
  out,
  source,
  title,
  nav,
  desc,
  section,
  ...(group ? { group } : {}),
});

const SRC = (path: string): string => `${SOURCE_DIR}/${path}`;

/** Every page, in reading order: the menu, previous and next, and the lists of pages all follow it. */
export const SITE_PAGES: readonly SitePage[] = [
  page('index.html', SRC('index.md'), 'napkin-sketch documentation', 'Home', 'start', 'A sketching app that sharpens what you draw by hand, and a drawing language that draws the same way from a script.'),
  page('install.html', SRC('install.md'), 'Installation', 'Install', 'start', 'Build the desktop installer for Windows, macOS or Linux, or run napkin-sketch from a clone.'),
  page('quickstart.html', 'QUICKSTART.md', 'Quickstart', 'Quickstart', 'start', 'From a fresh clone to a sharpened sketch in five minutes.'),
  page('cheatsheet.html', 'CHEATSHEET.md', 'Cheatsheet', 'Cheatsheet', 'start', 'Every shortcut, command-line flag and npm script on one page.'),

  page('quickstart/draw.html', SRC('quickstart/draw.md'), 'Quickstart: drawing', 'Draw', 'quickstarts', 'Pick a tool, draw, use the quick gestures and sharpen: the Sketch menu in one sitting.'),
  page('quickstart/transform.html', SRC('quickstart/transform.md'), 'Quickstart: transforming', 'Transform', 'quickstarts', 'Move, rotate, mirror, scale and bend a selection: the Transform menu in one sitting.'),
  page('quickstart/layers.html', SRC('quickstart/layers.md'), 'Quickstart: layers', 'Layers', 'quickstarts', 'Name, group and restack layers, and edit a selection in the Properties panel.'),
  page('quickstart/pages.html', SRC('quickstart/pages.md'), 'Quickstart: pages', 'Pages', 'quickstarts', 'Add pages three ways, size them, move between them, and export them all.'),
  page('quickstart/automate.html', SRC('quickstart/automate.md'), 'Quickstart: automating', 'Automate', 'quickstarts', 'Write a script from a drawing, record a session, and draw with no window at all.'),

  page('guide/index.html', SRC('guide/index.md'), 'Using the app', 'Overview', 'guide', 'The manual, in the order it is best read, one line per page.'),
  page('guide/tools.html', SRC('guide/tools.md'), 'Tools', 'Tools', 'guide', 'The drawing tools, the Copic marker and its nib, and the Sketch Support toolbar.'),
  page('guide/gestures.html', SRC('guide/gestures.md'), 'Gestures and input', 'Gestures', 'guide', 'Pen, touch and mouse; pan and zoom; the straight line, the quick curve, endpoint snap and the held keys.'),
  page('guide/vector-paths.html', SRC('guide/vector-paths.md'), 'Vector paths and stroke profiles', 'Vector paths', 'guide', 'Editing anchors and handles, rounding corners, Sharpen Selection, and the four stroke profiles.'),
  page('guide/selection.html', SRC('guide/selection.md'), 'Selecting and editing', 'Selection and editing', 'guide', 'Selecting, filling, widening, the clipboard, and what a press on a selection does.'),
  page('guide/transform.html', SRC('guide/transform.md'), 'Transform, Rotate, Mirror and Mesh Warp', 'Transform', 'guide', 'The Transform box, Rotate, Mirror, Mesh Warp, and docking their panels.'),
  page('guide/layers.html', SRC('guide/layers.md'), 'Layers and the Properties panel', 'Layers', 'guide', 'The Layers panel, groups, restacking, and editing a selection in the Properties panel.'),
  page('guide/pages.html', SRC('guide/pages.md'), 'Pages', 'Pages', 'guide', 'The pages panel, page sizes, and the three ways to add a page.'),
  page('guide/import-export.html', SRC('guide/import-export.md'), 'Import and export', 'Import and export', 'guide', 'What SVG, PDF and pictures arrive as, and what PNG, JPEG, SVG and PDF exports keep.'),
  page('guide/sharpen.html', SRC('guide/sharpen.md'), 'Sharpening', 'Sharpen', 'guide', 'Live sharpen, Sharpen all, and how the auto-sharpen engine decides what a stroke meant.'),
  page('guide/settings.html', SRC('guide/settings.md'), 'Settings', 'Settings', 'guide', 'Quick Settings and Verbose Settings, and every setting with its default and range.'),
  page('guide/menus-and-shortcuts.html', SRC('guide/menus-and-shortcuts.md'), 'Menus and shortcuts', 'Menus and shortcuts', 'guide', 'The menu bar, the right-click menus, every keyboard shortcut, and changing them.'),
  page('guide/automate.html', SRC('guide/automate.md'), 'Automate', 'Automate', 'guide', 'Generate Script from a file, the selected layers or the session history, and Track History.'),
  page('guide/animation-mode.html', SRC('guide/animation-mode.md'), 'Animation Mode', 'Animation Mode', 'guide', 'The optional add-on that draws animation frames with an AI helper: installing it and using it.'),
  page('guide/skbk-format.html', SRC('guide/skbk-format.md'), 'The .skbk file format', 'The .skbk format', 'guide', 'What a saved sketch book holds, and how older files open.'),
  page('guide/command-line.html', SRC('guide/command-line.md'), 'The command line', 'Command line', 'guide', 'Opening the app from a shell: every option, and the four commands that need no window.'),

  page('api/index.html', HUB_PAGES[0], 'Drawing from a script', 'Overview', 'api', 'napkin script and its API: what it is, the eight categories of pages, and where to start.'),
  page('api/quickstart.html', HUB_PAGES[1], 'API quickstart', 'Quickstart', 'api', 'The whole API in five steps.'),
  page('api/cheatsheet.html', HUB_PAGES[2], 'API cheatsheet', 'Cheatsheet', 'api', 'Every verb, command, import, option and exit code on one page.'),
  ...DOC_CATEGORIES.flatMap((category) => [
    page(`api/${category.id}/index.html`, `docs/api/${category.id}/README.md`, category.title, 'Reference', 'api', category.summary, category.title),
    page(`api/${category.id}/quickstart.html`, `docs/api/${category.id}/QUICKSTART.md`, `${category.title}: quickstart`, 'Quickstart', 'api', `${category.title}, in numbered steps that run on a clone.`, category.title),
    page(`api/${category.id}/cheatsheet.html`, `docs/api/${category.id}/CHEATSHEET.md`, `${category.title}: cheatsheet`, 'Cheatsheet', 'api', `${category.title}, as tables to look things up in.`, category.title),
  ]),

  page('embed.html', SRC('embed.md'), 'Embedding the editor', 'Embedding', 'building', 'The editor in your own page, the pure engine, and the graphic-design API.'),
  page('scripting.html', SRC('scripting.md'), 'Drawing from a script', 'Scripting', 'building', 'napkin script from a shell, from Node or from any language, and what it writes.'),
  page('ai-helpers.html', SRC('ai-helpers.md'), 'The AI helpers', 'AI helpers', 'building', 'The graphic-designer and scripting helpers: what each does and how to use it.'),
  page('ai-helper.html', 'ai-helper/README.md', 'The AI helper plugins', 'Helper plugins', 'building', 'The three plugins, and installing them where an AI tool looks.'),

  page('develop/building.html', SRC('develop/building.md'), 'Building and packaging', 'Building', 'developing', 'Building, watching and packaging the app, and every npm script.'),
  page('develop/testing.html', SRC('develop/testing.md'), 'Testing', 'Testing', 'developing', 'The test suites, the golden scripts, the GUI checks and the package check.'),
  page('develop/project-structure.html', SRC('develop/project-structure.md'), 'Project structure', 'Project structure', 'developing', 'Every folder and file under src/ and docs/api/, and what each holds.'),

  page('changelog.html', 'CHANGELOG.md', 'Changelog', 'Changelog', 'project', 'Every release, newest first.'),
  page('about.html', SRC('about.md'), 'About and license', 'About and license', 'project', 'The license, the repository, and how these pages are kept true.'),
];

/** Files the site publishes as they are, copied from the repository: `docs/` path to source. */
export const SITE_COPIES: Readonly<Record<string, string>> = {
  'assets/mark.svg': 'assets/icon.svg',
};

/**
 * Files kept by hand in `docs/`: what every page needs, and the home page's
 * banner, a GIF that plays once and holds its last frame (it carries no
 * loop block, which `test/site.test.ts` holds it to).
 */
export const SITE_STATIC = ['assets/site.css', 'assets/site.js', '.nojekyll', 'assets/banner.gif'] as const;

// ---- Text ---------------------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The anchor GitHub gives a heading: lower case, punctuation dropped, spaces to hyphens. */
export function headingAnchor(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** The anchors of a Markdown page's headings, in order, repeats numbered as GitHub numbers them. */
export function headingAnchors(markdown: string): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  let fence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^#{1,6} (.+?)\s*#*$/.exec(line);
    if (!m) continue;
    const base = headingAnchor(m[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    out.push(count === 0 ? base : `${base}-${count}`);
  }
  return out;
}

// ---- Links ----------------------------------------------------------------------------------------

/** How the page being rendered turns a link in its source into a link on the site. */
export interface LinkContext {
  /** The page's source, from the repository root. */
  readonly source: string;
  /** The page's path under `docs/`. */
  readonly out: string;
  /** Rewrites one href. */
  readonly link: (href: string) => string;
}

/** A relative URL from one site path to another. */
function relativeUrl(fromOut: string, toOut: string): string {
  const rel = posix.relative(posix.dirname(fromOut), toOut);
  return rel === '' ? posix.basename(toOut) : rel;
}

// ---- Markdown -------------------------------------------------------------------------------------

/** A heading as the page has it: its level, its text and its anchor. */
export interface Heading {
  readonly level: number;
  readonly text: string;
  readonly id: string;
}

interface RenderState {
  readonly context: LinkContext;
  readonly headings: Heading[];
  readonly seen: Map<string, number>;
}

/** The run of backticks that opens a code span at `i`, and where it closes; null when it does not close. */
function codeSpanAt(text: string, i: number): { end: number; code: string } | null {
  const run = /^`+/.exec(text.slice(i))![0];
  let at = i + run.length;
  while (at <= text.length) {
    const close = text.indexOf(run, at);
    if (close < 0) return null;
    // A longer run is not the close.
    if (text[close + run.length] === '`' || text[close - 1] === '`') {
      at = close + run.length;
      while (text[at] === '`') at++;
      continue;
    }
    const inner = text.slice(i + run.length, close);
    const code = /^ .* $/.test(inner) && inner.trim() !== '' ? inner.slice(1, -1) : inner;
    return { end: close + run.length, code };
  }
  return null;
}

/** The `]` that closes the `[` at `i`, skipping code spans and nested brackets; -1 when none. */
function closeBracket(text: string, i: number): number {
  let depth = 0;
  for (let at = i; at < text.length; at++) {
    const ch = text[at];
    if (ch === '\\') {
      at++;
      continue;
    }
    if (ch === '`') {
      const span = codeSpanAt(text, at);
      if (span) {
        at = span.end - 1;
        continue;
      }
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return at;
    }
  }
  return -1;
}

/** The `(href)` after a link's `]`, allowing one level of parentheses inside the href. */
function linkTarget(text: string, i: number): { href: string; end: number } | null {
  if (text[i] !== '(') return null;
  let depth = 0;
  for (let at = i; at < text.length; at++) {
    if (text[at] === '(') depth++;
    else if (text[at] === ')') {
      depth--;
      if (depth === 0) {
        const inside = text.slice(i + 1, at).trim();
        const href = inside.replace(/\s+"[^"]*"$/, '');
        return /\s/.test(href) ? null : { href, end: at + 1 };
      }
    }
  }
  return null;
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|<>~]/;

/** Inline Markdown to HTML: code spans, links, images, emphasis, escapes, and `<br>`. */
export function renderInline(text: string, context: LinkContext): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '\\' && next !== undefined && ESCAPABLE.test(next)) {
      out += escapeHtml(next);
      i += 2;
      continue;
    }
    if (ch === '`') {
      const span = codeSpanAt(text, i);
      if (span) {
        out += `<code>${escapeHtml(span.code)}</code>`;
        i = span.end;
        continue;
      }
      const run = /^`+/.exec(text.slice(i))![0];
      out += run;
      i += run.length;
      continue;
    }
    if ((ch === '!' && next === '[') || ch === '[') {
      const open = ch === '!' ? i + 1 : i;
      const close = closeBracket(text, open);
      const target = close > 0 ? linkTarget(text, close + 1) : null;
      if (close > 0 && target) {
        const label = text.slice(open + 1, close);
        const href = escapeHtml(context.link(target.href));
        out +=
          ch === '!'
            ? `<img src="${href}" alt="${escapeHtml(label.replace(/[*_`]/g, ''))}" loading="lazy">`
            : `<a href="${href}"${/^https?:/.test(target.href) ? ' rel="noopener"' : ''}>${renderInline(label, context)}</a>`;
        i = target.end;
        continue;
      }
    }
    if (ch === '<') {
      const auto = /^<(https?:\/\/[^\s>]+)>/.exec(text.slice(i));
      if (auto) {
        out += `<a href="${escapeHtml(auto[1])}" rel="noopener">${escapeHtml(auto[1])}</a>`;
        i += auto[0].length;
        continue;
      }
      const br = /^<br\s*\/?>/i.exec(text.slice(i));
      if (br) {
        out += '<br>';
        i += br[0].length;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const strong = ch === next;
      const mark = strong ? ch + ch : ch;
      const before = text[i - 1] ?? ' ';
      const after = text[i + mark.length] ?? ' ';
      // An underscore inside a word is part of the word: snake_case stays.
      const opens = after !== ' ' && after !== mark[0] && !(ch === '_' && /[\p{L}\p{N}]/u.test(before));
      if (opens) {
        let at = i + mark.length;
        let found = -1;
        while (at < text.length) {
          if (text[at] === '\\') {
            at += 2;
            continue;
          }
          if (text[at] === '`') {
            const span = codeSpanAt(text, at);
            if (span) {
              at = span.end;
              continue;
            }
          }
          if (text.startsWith(mark, at) && text[at - 1] !== ' ' && (strong || text[at + 1] !== ch)) {
            const tail = text[at + mark.length] ?? ' ';
            if (!(ch === '_' && /[\p{L}\p{N}]/u.test(tail))) {
              found = at;
              break;
            }
          }
          at++;
        }
        if (found > i + mark.length - 1) {
          const tag = strong ? 'strong' : 'em';
          out += `<${tag}>${renderInline(text.slice(i + mark.length, found), context)}</${tag}>`;
          i = found + mark.length;
          continue;
        }
      }
    }
    out += escapeHtml(ch);
    i++;
  }
  return out;
}

/** The leading spaces of a line, a tab counted as four. */
function indentOf(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ') n++;
    else if (ch === '\t') n += 4;
    else break;
  }
  return n;
}

/** A line with up to `n` columns of leading space taken off. */
function dedent(line: string, n: number): string {
  let taken = 0;
  let i = 0;
  while (i < line.length && taken < n && (line[i] === ' ' || line[i] === '\t')) {
    taken += line[i] === '\t' ? 4 : 1;
    i++;
  }
  return line.slice(i);
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * A table row's cells. An escaped pipe is a pipe in its cell, and GitHub
 * takes the escape away before anything else reads the cell, so `\|` in a
 * code span shows as `|` too.
 */
function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  const push = (): void => {
    cells.push(cell.trim().replace(/\\\|/g, '|'));
    cell = '';
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') {
      cell += '\\|';
      i++;
      continue;
    }
    if (ch === '`') {
      const span = codeSpanAt(body, i);
      if (span) {
        // A pipe in a code span is still a cell break in GitHub's tables, unless escaped.
        const inner = body.slice(i, span.end);
        if (!/(^|[^\\])\|/.test(inner)) {
          cell += inner;
          i = span.end - 1;
          continue;
        }
      }
    }
    if (ch === '|') {
      push();
      continue;
    }
    cell += ch;
  }
  push();
  return cells;
}

/** A block of Markdown lines to HTML. */
function renderBlocks(lines: readonly string[], state: RenderState): string {
  const out: string[] = [];
  let i = 0;
  const blank = (line: string | undefined): boolean => line === undefined || line.trim() === '';
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const indent = fence[1].length;
      const marker = fence[2];
      const lang = fence[3].trim().split(/\s+/)[0] ?? '';
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) {
        body.push(dedent(lines[i], indent));
        i++;
      }
      i++;
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const base = headingAnchor(text);
      const count = state.seen.get(base) ?? 0;
      state.seen.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count}`;
      state.headings.push({ level, text, id });
      const inner = renderInline(text, state.context);
      out.push(`<h${level} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${level}>`);
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && !blank(lines[i]) && /^\s*>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*> ?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderBlocks(quoted, state)}</blockquote>`);
      continue;
    }
    if (line.trim().startsWith('|') && TABLE_RULE.test(lines[i + 1] ?? '')) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((rule) =>
        rule.startsWith(':') && rule.endsWith(':') ? 'center' : rule.endsWith(':') ? 'right' : rule.startsWith(':') ? 'left' : '',
      );
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const cell = (tag: string, text: string, n: number): string =>
        `<${tag}${align[n] ? ` style="text-align:${align[n]}"` : ''}>${renderInline(text, state.context)}</${tag}>`;
      out.push(
        `<div class="table-wrap"><table>\n<thead><tr>${head.map((text, n) => cell('th', text, n)).join('')}</tr></thead>\n<tbody>\n${rows
          .map((row) => `<tr>${head.map((_, n) => cell('td', row[n] ?? '', n)).join('')}</tr>`)
          .join('\n')}\n</tbody></table></div>`,
      );
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      i = renderList(lines, i, state, out);
      continue;
    }
    if (/^\s*(\*\s*){3,}$|^\s*(-\s*){3,}$|^\s*(_\s*){3,}$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && !blank(lines[i])) {
      const current = lines[i];
      if (paragraph.length > 0 && (FENCE.test(current) || /^#{1,6}\s/.test(current) || /^\s*>/.test(current) || LIST_ITEM.test(current))) break;
      if (paragraph.length > 0 && current.trim().startsWith('|') && TABLE_RULE.test(lines[i + 1] ?? '')) break;
      paragraph.push(current.trim());
      i++;
    }
    out.push(`<p>${renderInline(paragraph.join('\n'), state.context)}</p>`);
  }
  return out.join('\n');
}

/** A list starting at `start`, with its nested blocks; returns the line after it. */
function renderList(lines: readonly string[], start: number, state: RenderState, out: string[]): number {
  const first = LIST_ITEM.exec(lines[start])!;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: string[][] = [];
  let loose = false;
  let i = start;
  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i]);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    const content = indent + m[2].length + m[3].length;
    const body = [m[4]];
    i++;
    let sawBlank = false;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') {
        sawBlank = true;
        body.push('');
        i++;
        continue;
      }
      const deeper = indentOf(line) >= content;
      const sibling = LIST_ITEM.exec(line);
      if (deeper) {
        body.push(dedent(line, content));
        i++;
        continue;
      }
      // A line that is not indented continues the paragraph only when no blank line came between.
      if (!sawBlank && !sibling && !FENCE.test(line) && !/^#{1,6}\s/.test(line)) {
        body.push(line.trim());
        i++;
        continue;
      }
      break;
    }
    while (body.length > 0 && body[body.length - 1] === '') body.pop();
    if (sawBlank && i < lines.length && LIST_ITEM.exec(lines[i])?.[1].length === indent) loose = true;
    if (body.some((line, n) => line === '' && n > 0 && n < body.length - 1)) loose = true;
    items.push(body);
  }
  const tag = ordered ? 'ol' : 'ul';
  const startAt = ordered ? Number(/\d+/.exec(first[2])![0]) : 1;
  const rendered = items.map((body) => {
    const html = renderBlocks(body, state);
    // A tight list's items hold their text without a paragraph round it.
    return `<li>${loose ? html : html.replace(/^<p>([\s\S]*?)<\/p>/, '$1')}</li>`;
  });
  out.push(`<${tag}${ordered && startAt !== 1 ? ` start="${startAt}"` : ''}>\n${rendered.join('\n')}\n</${tag}>`);
  return i;
}

/** A Markdown page to HTML, and its headings. HTML comments - the generators' markers - are dropped. */
export function renderMarkdown(markdown: string, context: LinkContext): { html: string; headings: Heading[] } {
  const lines: string[] = [];
  let fence = false;
  let comment = false;
  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (!comment && FENCE.test(raw)) fence = !fence;
    if (fence) {
      lines.push(raw);
      continue;
    }
    let line = raw;
    if (comment) {
      const end = line.indexOf('-->');
      if (end < 0) continue;
      line = line.slice(end + 3);
      comment = false;
    }
    line = line.replace(/<!--[\s\S]*?-->/g, '');
    const open = line.indexOf('<!--');
    if (open >= 0) {
      comment = true;
      line = line.slice(0, open);
    }
    if (raw.trim() !== '' && line.trim() === '') continue;
    lines.push(line);
  }
  const state: RenderState = { context, headings: [], seen: new Map() };
  return { html: renderBlocks(lines, state), headings: state.headings };
}

// ---- Generated blocks in the sources -----------------------------------------------------------

/** A setting's value as the table shows it. */
function shown(value: unknown): string {
  if (Array.isArray(value)) return value.length > 4 ? `${value.length} values` : value.map((v) => `\`${String(v)}\``).join(', ');
  if (typeof value === 'string') return value === '' ? '(empty)' : `\`${value.replace(/\|/g, '\\|')}\``;
  return `\`${String(value)}\``;
}

/** Every setting in `settings.json`, with its default and, for a number, its range and step. */
export function settingsMarkdown(): string {
  const defaults = defaultSettings() as unknown as Record<string, unknown>;
  const limits = SETTINGS_LIMITS as Record<string, { min: number; max: number; step: number }>;
  const rows = Object.keys(defaults).map((key) => {
    const limit = limits[key];
    const range = limit ? `${limit.min} to ${limit.max}, in steps of ${limit.step}` : '';
    return `| \`${key}\` | ${shown(defaults[key])} | ${range} |`;
  });
  return ['| Setting | Default | Range |', '| --- | --- | --- |', ...rows].join('\n');
}

/** Every npm script, as `package.json` has it. */
export function npmScriptsMarkdown(scripts: Readonly<Record<string, string>>): string {
  const rows = Object.entries(scripts).map(([name, command]) => `| \`npm run ${name}\` | \`${command.replace(/\|/g, '\\|')}\` |`);
  return ['| Script | Runs |', '| --- | --- |', ...rows].join('\n');
}

/** The pages of a section as a list: each one a link with its line. `from` is the source the list is written in. */
export function pagesMarkdown(section: SectionId, from: string, skip: string[] = []): string {
  const byOut = new Map(SITE_PAGES.map((p) => [p.out, p]));
  return SITE_PAGES.filter((p) => p.section === section && !skip.includes(p.out))
    .map((p) => {
      const target = posix.relative(posix.dirname(from), p.source);
      return `- [${byOut.get(p.out)!.title}](${target}) - ${p.desc}`;
    })
    .join('\n');
}

/** What the generator knows of the project, from `package.json`. */
export interface SiteMeta {
  readonly version: string;
  readonly description: string;
  readonly scripts: Readonly<Record<string, string>>;
  /** The license, as the LICENSE file has it. */
  readonly license?: string;
}

/** The generated blocks each site source holds, by marker. */
function generatedBlocks(source: string, meta: SiteMeta): Record<string, string> {
  const blocks: Record<string, string> = {
    version: `This documents napkin-sketch **${meta.version}**.`,
    settings: settingsMarkdown(),
    'npm-scripts': npmScriptsMarkdown(meta.scripts),
    license: meta.license ? ['```text', meta.license.replace(/\r\n/g, '\n').trim(), '```'].join('\n') : '',
  };
  for (const section of SECTIONS) blocks[`pages:${section.id}`] = pagesMarkdown(section.id, source, [SITE_PAGES.find((p) => p.source === source)?.out ?? '']);
  return blocks;
}

/** A site source with its generated blocks filled; unchanged when it has none. */
export function fillSource(source: string, text: string, meta: SiteMeta): string {
  let out = text;
  for (const [name, body] of Object.entries(generatedBlocks(source, meta))) {
    if (out.includes(`<!-- ${name}:start -->`)) out = replaceBetweenMarkers(out, name, body);
  }
  return out;
}

// ---- The chrome ------------------------------------------------------------------------------------

/** The folding groups of the menu, and the section each is in. */
function groupsOf(section: SectionId): string[] {
  return [...new Set(SITE_PAGES.filter((p) => p.section === section && p.group).map((p) => p.group!))];
}

/** The side menu: every page, the current one marked, its group open. */
function menu(current: SitePage): string {
  const link = (p: SitePage): string =>
    `<li><a href="${relativeUrl(current.out, p.out)}"${p.out === current.out ? ' aria-current="page"' : ''}>${escapeHtml(p.nav)}</a></li>`;
  const sections = SECTIONS.map((section) => {
    const pages = SITE_PAGES.filter((p) => p.section === section.id);
    const loose = pages.filter((p) => !p.group).map(link);
    const groups = groupsOf(section.id).map((group) => {
      const inside = pages.filter((p) => p.group === group);
      const open = inside.some((p) => p.out === current.out) ? ' open' : '';
      return `<li><details class="nav-group"${open}><summary>${escapeHtml(group)}</summary><ul>${inside.map(link).join('')}</ul></details></li>`;
    });
    return `<p class="nav-section">${escapeHtml(section.label)}</p>\n<ul>${[...loose, ...groups].join('')}</ul>`;
  });
  return `<nav class="sidebar" id="menu" aria-label="Documentation">\n${sections.join('\n')}\n</nav>`;
}

/** The trail from the home page to this one. */
function breadcrumb(current: SitePage): string {
  if (current.out === 'index.html') return '';
  const home = `<a href="${relativeUrl(current.out, 'index.html')}">Docs</a>`;
  const section = SECTIONS.find((s) => s.id === current.section)!;
  const hub = SITE_PAGES.find((p) => p.section === current.section && /(^|\/)index\.html$/.test(p.out) && !p.group);
  const parts = [home];
  if (hub && hub.out !== current.out) parts.push(`<a href="${relativeUrl(current.out, hub.out)}">${escapeHtml(section.label)}</a>`);
  else if (!hub) parts.push(escapeHtml(section.label));
  if (current.group) {
    const reference = SITE_PAGES.find((p) => p.group === current.group && p.out.endsWith('/index.html'));
    if (reference && reference.out !== current.out) parts.push(`<a href="${relativeUrl(current.out, reference.out)}">${escapeHtml(current.group)}</a>`);
  }
  parts.push(`<span aria-current="page">${escapeHtml(current.nav)}</span>`);
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${parts.join(' <span class="sep">/</span> ')}</nav>`;
}

/** The previous and next pages in reading order. */
function pageNav(current: SitePage): string {
  const index = SITE_PAGES.indexOf(current);
  const previous = SITE_PAGES[index - 1];
  const next = SITE_PAGES[index + 1];
  const left = previous ? `<a href="${relativeUrl(current.out, previous.out)}" rel="prev"><span>Previous</span>${escapeHtml(previous.title)}</a>` : '<span></span>';
  const right = next ? `<a href="${relativeUrl(current.out, next.out)}" rel="next"><span>Next</span>${escapeHtml(next.title)}</a>` : '<span></span>';
  return `<nav class="page-nav" aria-label="Previous and next pages">${left}${right}</nav>`;
}

/** The page's own contents, when it has enough sections to need them. */
function tableOfContents(headings: readonly Heading[]): string {
  const sections = headings.filter((h) => h.level === 2);
  if (sections.length < 4) return '';
  const items = sections.map((h) => `<li><a href="#${h.id}">${renderInline(h.text, NO_LINKS)}</a></li>`).join('');
  return `<details class="toc" open><summary>On this page</summary><ul>${items}</ul></details>`;
}

/** Heading text in the contents: links become their words. */
const NO_LINKS: LinkContext = { source: '', out: '', link: () => '#' };

/** A whole page: the chrome round the rendered body. */
function renderPage(current: SitePage, body: string, headings: readonly Heading[], meta: SiteMeta): string {
  const root = relativeUrl(current.out, 'index.html').replace(/index\.html$/, '');
  const title = current.out === 'index.html' ? current.title : `${current.title} - napkin-sketch`;
  const toc = tableOfContents(headings);
  // The contents follow the title, and a picture set straight under the
  // title, which is that page's hero, as the home page's banner is.
  const withToc = toc ? body.replace(/(<\/h1>(?:\n<p><img [^>]*><\/p>)?)/, `$1\n${toc}`) : body;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(current.desc)}">
<meta name="generator" content="napkin-sketch npm run site">
<link rel="icon" href="${root}assets/mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="${root}assets/site.css">
<script src="${root}assets/site.js"></script>
</head>
<body>
<a class="skip-link" href="#content">Skip to the page</a>
<header class="topbar">
<button class="topbar-button menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-controls="menu">Menu</button>
<a class="brand" href="${root}index.html"><img src="${root}assets/mark.svg" alt="" width="28" height="28"><span>napkin-sketch</span><span class="brand-sub">docs</span></a>
<span class="topbar-spacer"></span>
<span class="version" title="The version these pages document">${escapeHtml(meta.version)}</span>
<a class="topbar-button" href="${REPO_URL}" rel="noopener">GitHub</a>
<button class="topbar-button" type="button" data-theme-toggle aria-label="Switch between light and dark">Dark</button>
</header>
<div class="scrim" data-scrim></div>
${menu(current)}
<main class="page" id="content">
<article class="content">
${breadcrumb(current)}
${withToc}
${pageNav(current)}
</article>
</main>
<footer class="site-footer">
<p>napkin-sketch is published under the MIT license. These pages are written from the repository's own Markdown by <code>npm run site</code>; the tables in them come from the code.</p>
<p><a href="${REPO_URL}/blob/main/${escapeHtml(current.source)}" rel="noopener">This page's source</a></p>
</footer>
</body>
</html>
`;
}

// ---- The site ---------------------------------------------------------------------------------------

/** How the generator reads the repository: a file's text, or null when there is none. */
export interface SiteReader {
  read(path: string): string | null;
  /** True for a path that is a folder in the repository. */
  isFolder?(path: string): boolean;
}

/** A file the generator writes: its path from the repository root, and its text. */
export interface SiteFile {
  readonly path: string;
  readonly text: string;
}

/**
 * Every file the site is: the filled sources under `docs/site-src/`, the
 * pages under `docs/`, and the copies it publishes. Throws when a page's
 * source is missing.
 */
export function buildSite(reader: SiteReader, meta: SiteMeta): SiteFile[] {
  const files: SiteFile[] = [];
  const sources = new Map<string, string>();
  for (const p of SITE_PAGES) {
    const raw = reader.read(p.source);
    if (raw === null) throw new Error(`The site page ${p.out} has no source: ${p.source} is missing.`);
    const text = raw.replace(/\r\n/g, '\n');
    const filled = p.source.startsWith(`${SOURCE_DIR}/`) ? fillSource(p.source, text, meta) : text;
    if (filled !== text) files.push({ path: p.source, text: filled });
    sources.set(p.source, filled);
  }

  // Where each heading now lives, for a link to README.md#anchor, which moved.
  const bySource = new Map(SITE_PAGES.map((p) => [p.source, p]));
  const anchorHome = new Map<string, SitePage>();
  for (const p of SITE_PAGES) {
    if (p.source.startsWith('docs/api/')) continue;
    for (const anchor of headingAnchors(sources.get(p.source)!)) if (!anchorHome.has(anchor)) anchorHome.set(anchor, p);
  }
  const copies = new Map(Object.entries(SITE_COPIES).map(([out, from]) => [from, out]));

  for (const p of SITE_PAGES) {
    const link = (href: string): string => {
      if (/^(https?:|mailto:)/.test(href)) return href;
      if (href.startsWith('#')) return href;
      const [pathPart, fragment] = href.split('#');
      const target = posix.normalize(posix.join(posix.dirname(p.source), decodeURI(pathPart)));
      const hash = fragment !== undefined ? `#${fragment}` : '';
      const page = bySource.get(target);
      if (page) return relativeUrl(p.out, page.out) + hash;
      if (target === 'README.md') {
        const home = fragment ? anchorHome.get(fragment) : undefined;
        return home ? relativeUrl(p.out, home.out) + hash : relativeUrl(p.out, 'index.html');
      }
      const copied = copies.get(target);
      if (copied) return relativeUrl(p.out, copied);
      if (target.startsWith(`${SITE_DIR}/`) && reader.read(target) !== null && !target.endsWith('.md')) {
        return relativeUrl(p.out, target.slice(SITE_DIR.length + 1)) + hash;
      }
      const folder = pathPart.endsWith('/') || reader.isFolder?.(target) === true;
      return `${REPO_URL}/${folder ? 'tree' : 'blob'}/main/${target.replace(/\/$/, '')}${hash}`;
    };
    const { html, headings } = renderMarkdown(sources.get(p.source)!, { source: p.source, out: p.out, link });
    files.push({ path: `${SITE_DIR}/${p.out}`, text: renderPage(p, html, headings, meta) });
  }

  for (const [out, from] of Object.entries(SITE_COPIES)) {
    const text = reader.read(from);
    if (text === null) throw new Error(`The site copies ${from}, which is missing.`);
    files.push({ path: `${SITE_DIR}/${out}`, text });
  }
  return files;
}
