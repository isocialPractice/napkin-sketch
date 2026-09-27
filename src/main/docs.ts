/**
 * The documentation window's decisions, apart from Electron: where the pages
 * are, what a Help row does when they are missing, where a link in them may
 * go, and which keys move through them.
 *
 * The pages are the site `npm run site` writes into `docs/`. A packaged app
 * carries them in its resources folder (`build.extraResources`), and a
 * checkout reads the repository's own `docs/`, so Help works with no network
 * either way. The window gives the pages no bridge to the app: a page link
 * stays in it, a web or mail link opens in the system browser, and anything
 * else is refused.
 *
 * Nothing here imports Electron, so the unit tests run what the app runs.
 */

import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docsPageFile } from '../core/menu/links.js';

/** Where the app is running from, as far as finding its pages goes. */
export interface DocsWhere {
  /** True in an installed app, whose pages are in its resources folder. */
  packaged: boolean;
  /** Electron's `process.resourcesPath`. */
  resourcesPath: string;
  /** The folder `main.js` is in: `dist/main` in a checkout. */
  mainDir: string;
}

/** The folder the pages are read from: the resources folder's `docs`, or the repository's. */
export function docsRoot(where: DocsWhere): string {
  return where.packaged ? join(where.resourcesPath, 'docs') : resolve(where.mainDir, '..', '..', 'docs');
}

/**
 * A page's file under the root, such as `<root>/quickstart/draw.html` for
 * `quickstart/draw`, or null for a name that is not a page's: only lower-case
 * words, digits and hyphens between slashes, so no name can leave the root.
 */
export function docsPagePath(root: string, page: string): string | null {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(page)) return null;
  return join(root, ...docsPageFile(page).split('/'));
}

/** What the toast says when the pages are not in this copy of the app and the site is not up. */
export const DOCS_MISSING =
  'The documentation pages are not in this copy of napkin-sketch: npm run site writes them into docs/ from docs/site-src/.';

/** What a Help row does: open the window at a file, open the published site, or say where the pages are. */
export type DocsPlan =
  | { kind: 'window'; file: string }
  | { kind: 'browser'; url: string }
  | { kind: 'notice'; message: string };

/**
 * What opening `page` does. The window when the page is on disk; the same
 * page on the published site when it is not and the site is up (`siteUrl`,
 * ending in a slash); otherwise a toast, since there is nothing to open.
 */
export function docsPlan(page: string, root: string, exists: (file: string) => boolean, siteUrl: string | null): DocsPlan {
  const file = docsPagePath(root, page);
  if (file !== null && exists(file)) return { kind: 'window', file };
  if (siteUrl !== null) return { kind: 'browser', url: new URL(docsPageFile(file === null ? 'index' : page), siteUrl).href };
  return { kind: 'notice', message: DOCS_MISSING };
}

/** Where a link in the documentation goes. */
export type DocsLink = { kind: 'stay' } | { kind: 'browser'; url: string } | { kind: 'refuse' };

/**
 * Where a link clicked in the documentation window goes: a file under the
 * root stays in the window, a web or mail link opens in the system browser,
 * and anything else - another folder on disk, a script, a data URL - goes
 * nowhere.
 */
export function docsLink(url: string, root: string): DocsLink {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'refuse' };
  }
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:') return { kind: 'browser', url: parsed.href };
  if (parsed.protocol !== 'file:') return { kind: 'refuse' };
  let path: string;
  try {
    path = fileURLToPath(parsed);
  } catch {
    return { kind: 'refuse' };
  }
  const inside = relative(root, path);
  return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside) ? { kind: 'stay' } : { kind: 'refuse' };
}

/** What a key or a mouse button does in the documentation window. */
export type DocsAction = 'back' | 'forward' | 'close';

/** The parts of an Electron `before-input-event` input the window reads. */
export interface DocsKeyInput {
  type: string;
  key: string;
  alt: boolean;
  control: boolean;
  meta: boolean;
  shift: boolean;
}

/**
 * The keys a browser gives these moves, as the window has no menu to carry
 * them: back and forward with Alt and an arrow (Cmd and an arrow or a
 * bracket on macOS) or the keyboard's own Back and Forward keys, and Ctrl+W
 * (Cmd+W) to close. Every other key is the page's.
 */
export function docsKey(input: DocsKeyInput, mac: boolean): DocsAction | null {
  if (input.type !== 'keyDown') return null;
  if (input.key === 'BrowserBack') return 'back';
  if (input.key === 'BrowserForward') return 'forward';
  const command = mac ? input.meta && !input.control && !input.alt : input.control && !input.meta && !input.alt;
  if (command && !input.shift && input.key.toLowerCase() === 'w') return 'close';
  const moving = mac ? input.meta && !input.control && !input.alt : input.alt && !input.control && !input.meta;
  if (!moving || input.shift) return null;
  if (input.key === 'ArrowLeft' || (mac && input.key === '[')) return 'back';
  if (input.key === 'ArrowRight' || (mac && input.key === ']')) return 'forward';
  return null;
}

/** A mouse's back and forward buttons, which Windows and Linux send the window as app commands. */
export function docsAppCommand(command: string): DocsAction | null {
  if (command === 'browser-backward') return 'back';
  if (command === 'browser-forward') return 'forward';
  return null;
}
