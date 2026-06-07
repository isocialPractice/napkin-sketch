/**
 * Tiny, dependency-free path helpers that work in both the browser (renderer)
 * and Node. Only the small subset napkin-sketch needs.
 */

/** Returns the final path segment (file name) of a `/`- or `\`-separated path. */
export function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

/** Returns the lowercase extension (without the dot), or '' if none. */
export function extension(filePath: string): string {
  const name = basename(filePath);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Returns the file name without its extension. */
export function stem(filePath: string): string {
  const name = basename(filePath);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
