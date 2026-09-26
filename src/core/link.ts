/**
 * Linked files, with no DOM: what a link is called, the placeholder it is
 * drawn as, and which paths a host may follow.
 *
 * A linked graphic stands for a file instead of holding it: one image item
 * and one layer row, with the file's contents neither drawn into the document
 * nor broken into its layers. That is Illustrator's placed (linked) file, as
 * opposed to an import. The item's `image` is a placeholder - a dashed box
 * with the file's name - which the canvas draws, and which a build that does
 * not know links shows in its place. An output that has to draw the file asks
 * the host for it through a {@link LinkResolver}: a script names a file, and
 * only the host reads it.
 */

import type { LinkKind, Stroke } from './types.js';

/**
 * Reads a linked file for an output that has to draw it: the file's bytes and
 * media type, or null when the host cannot, or will not, read it.
 */
export type LinkResolver = (href: string) => { bytes: Uint8Array; mediaType: string } | null;

const KINDS: Readonly<Record<string, LinkKind>> = { svg: 'svg', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', pdf: 'pdf' };

const MEDIA_TYPES: Readonly<Record<LinkKind, string>> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  pdf: 'application/pdf',
  unknown: 'application/octet-stream',
};

/** A link's path: its query and fragment dropped, and its percent-escapes decoded where they decode. */
function pathOf(href: string): string {
  const path = href.trim().split(/[?#]/)[0];
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** What kind of file a link names, by its extension. */
export function linkKind(href: string): LinkKind {
  const extension = /\.([a-z0-9]+)$/i.exec(pathOf(href));
  return (extension && KINDS[extension[1].toLowerCase()]) || 'unknown';
}

/** The media type a kind of linked file is read as. */
export function linkMediaType(kind: LinkKind): string {
  return MEDIA_TYPES[kind];
}

/** The name a link is shown by: the last part of its path. */
export function linkName(href: string): string {
  const parts = pathOf(href).split(/[\\/]+/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? href.trim();
}

/** True when a stroke is a linked file: an image item that stands for a file. */
export function isLinkStroke(stroke: Stroke): boolean {
  return stroke.tool === 'image' && typeof stroke.image === 'string' && typeof stroke.link?.href === 'string';
}

/**
 * The path a host may read a link from, relative to the folder it resolves
 * links in, or null when the link points outside that folder: an absolute
 * path, a drive letter, a UNC share, a `..` step, or an address with a scheme
 * such as `https:` or `file:`. These are the rules `normalizeRelativePath`
 * holds a settings path to, checked after percent-escapes are decoded so that
 * `%2e%2e` is a `..` too.
 */
export function safeLinkPath(href: string): string | null {
  const path = pathOf(href);
  if (path === '' || /^[\\/]/.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  const segments = path.split(/[\\/]+/);
  if (segments.includes('..')) return null;
  const kept = segments.filter((segment) => segment !== '' && segment !== '.');
  return kept.length > 0 ? kept.join('/') : null;
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The placeholder a linked file is drawn as until something reads the file:
 * an SVG the placed size, a dashed box crossed from corner to corner with the
 * file's name in the middle. A long name is shortened with an ellipsis to fit.
 */
export function linkPlaceholderSvg(name: string, width: number, height: number): string {
  const w = Math.max(4, round2(width));
  const h = Math.max(4, round2(height));
  const size = round2(Math.min(28, Math.max(8, Math.min(w, h) * 0.14)));
  // The built-in face averages about six tenths of the size a character.
  const room = Math.max(3, Math.floor((w - 8) / (size * 0.6)));
  const label = [...name].length > room ? `${[...name].slice(0, room - 1).join('')}…` : name;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect x="1" y="1" width="${round2(w - 2)}" height="${round2(h - 2)}" fill="#f6f8fa" stroke="#6e7781" stroke-width="2" stroke-dasharray="6 4"/>` +
    `<path d="M1 1L${round2(w - 1)} ${round2(h - 1)}M${round2(w - 1)} 1L1 ${round2(h - 1)}" fill="none" stroke="#d0d7de" stroke-width="1"/>` +
    `<text x="${round2(w / 2)}" y="${round2(h / 2 + size * 0.35)}" font-family="sans-serif" font-size="${size}" fill="#57606a" text-anchor="middle">${escapeXml(label)}</text>` +
    '</svg>'
  );
}

/** The placeholder for a linked file, as the data URL an image item carries. */
export function linkPlaceholder(name: string, width: number, height: number): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(linkPlaceholderSvg(name, width, height))}`;
}
