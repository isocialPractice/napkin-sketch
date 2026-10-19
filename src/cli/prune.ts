/**
 * `napkin-sketch prune`: removes from a project's install of the package what
 * the parts it keeps do not need.
 *
 * It saves disk, and only disk: a bundler already takes what a program
 * imports, and a page without one fetches only what its entry reaches, which
 * is what the parts themselves are for. Three things follow from where it
 * runs. A project's `npm run` reaches only the project's own scripts, so this
 * is a command, and the line that runs it is the project's. Every install puts
 * back what a prune removed, so a project runs it from its own `postinstall`,
 * and its marks live in its `package.json` for that run to read. And it never
 * touches a copy that is not under `node_modules`: a clone linked with
 * `npm link` is somebody's working tree.
 */

import { existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

import type { CommandArgs } from './args.js';
import { EXIT, type CommandIo } from './draw.js';
import { filesUnder, partName, readParts, removeEmptyFolders, typesClosure, type PartsRecord } from './vendor.js';

/** The package a project prunes. */
export const PACKAGE_NAME = '@isocialpractice/napkin-sketch';

/** What may be kept besides the parts. */
export const EXTRAS = ['types', 'docs', 'helpers', 'cli'] as const;

/**
 * What is always kept: the manifest npm reads, the licenses, the README, the
 * record a later prune and `vendor` read, and the script the package's own
 * `postinstall` runs, which `npm rebuild` would run again.
 */
const ALWAYS = ['package.json', 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'README.md', 'dist/parts.json', 'scripts/install-ai-helper.mjs'];

/** The API pages, which `docs` keeps. */
const DOCS = /^(?:docs\/api\/|API(?:-QUICKSTART|-CHEATSHEET)?\.md$)/;

/** The AI helper plugins and their marketplace, which `helpers` keeps. */
const HELPERS = /^(?:ai-helper\/|\.claude-plugin\/)/;

/** What `prune` reports: printed for a person, or as one line of JSON with `--json`. */
interface PruneReport {
  ok: boolean;
  exitCode: number;
  version: string;
  mode: 'plan' | 'apply';
  /** The project's folder, and its install of the package, as found. */
  project?: string;
  installed?: string;
  keep?: string[];
  /** The files that go, or went, by path from the install. */
  remove?: string[];
  removedBytes?: number;
  keptBytes?: number;
  /** The package's subpaths that will no longer import. */
  unimportable?: string[];
  warnings: string[];
  error?: { kind: 'usage' | 'io'; message: string };
}

/** A reason to stop, with its exit code. */
class PruneStop extends Error {
  constructor(
    message: string,
    readonly kind: 'usage' | 'io',
  ) {
    super(message);
  }
}

/** The nearest folder at or above `dir` with a package.json: the project. */
function projectOf(dir: string): string | null {
  let current = resolve(dir);
  for (;;) {
    if (existsSync(join(current, 'package.json'))) return current;
    const up = dirname(current);
    if (up === current) return null;
    current = up;
  }
}

/** The files a built entry reaches through its relative imports, with their scope markers, from `dist/`. */
function reachOf(dist: string, entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file) || !existsSync(join(dist, ...file.split('/')))) continue;
    seen.add(file);
    const text = readFileSync(join(dist, ...file.split('/')), 'utf8');
    for (const match of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      stack.push(posix.normalize(posix.join(posix.dirname(file), match[1])));
    }
  }
  const files = new Set<string>();
  for (const file of seen) {
    files.add(file);
    files.add(posix.join(posix.dirname(file), 'package.json'));
  }
  return [...files];
}

/** The marks, each a part or an extra, or why one is not. */
function readMarks(marks: readonly string[], record: PartsRecord): string[] {
  const named = [...new Set(marks.map((mark) => ((EXTRAS as readonly string[]).includes(mark) ? mark : partName(mark))))];
  const unknown = named.filter((mark) => !record.parts[mark] && !(EXTRAS as readonly string[]).includes(mark));
  if (unknown.length > 0) {
    throw new PruneStop(
      `there is no part ${unknown.map((mark) => `"${mark}"`).join(', ')} to keep; the marks are ${[...Object.keys(record.parts), ...EXTRAS].join(', ')}`,
      'usage',
    );
  }
  return named.sort();
}

/** Records the marks in the project's package.json, keeping its indentation and line ends. */
function writeMarks(path: string, marks: readonly string[]): void {
  const text = readFileSync(path, 'utf8');
  const manifest = JSON.parse(text) as { napkinSketch?: { keep?: string[] } };
  manifest.napkinSketch = { ...(manifest.napkinSketch ?? {}), keep: [...marks] };
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? '  ';
  let out = JSON.stringify(manifest, null, indent);
  if (text.includes('\r\n')) out = out.replace(/\n/g, '\r\n');
  writeFileSync(path, `${out}${/\r?\n$/.test(text) ? (text.includes('\r\n') ? '\r\n' : '\n') : ''}`, 'utf-8');
}

/** Every file the marks keep, by path from the install. */
export function keptFiles(root: string, record: PartsRecord, marks: readonly string[]): Set<string> {
  const dist = join(root, 'dist');
  const keep = new Set<string>(ALWAYS);
  for (const mark of marks) {
    const part = record.parts[mark];
    if (!part) continue;
    for (const file of part.files) keep.add(`dist/${file}`);
    if (marks.includes('types') && part.types) for (const file of typesClosure(dist, part.types)) keep.add(`dist/${file}`);
  }
  if (marks.includes('cli')) for (const file of reachOf(dist, 'cli/index.js')) keep.add(`dist/${file}`);
  for (const file of filesUnder(root)) {
    if ((marks.includes('docs') && DOCS.test(file)) || (marks.includes('helpers') && HELPERS.test(file))) keep.add(file);
  }
  return keep;
}

/** Runs `prune` and returns its exit code. */
export async function prune(io: CommandIo, args: CommandArgs): Promise<number> {
  const report: PruneReport = { ok: false, exitCode: EXIT.ok, version: io.version ?? 'unknown', mode: args.apply ? 'apply' : 'plan', warnings: [] };
  try {
    return run(io, args, report);
  } catch (err) {
    if (err instanceof PruneStop) return done(io, args, report, err.kind === 'usage' ? EXIT.usage : EXIT.io, { kind: err.kind, message: err.message });
    if ((err as NodeJS.ErrnoException).code && (err as NodeJS.ErrnoException).path) {
      return done(io, args, report, EXIT.io, { kind: 'io', message: (err as Error).message });
    }
    throw err;
  }
}

/** Sets the exit code, prints the report, and returns the code. */
function done(io: CommandIo, args: CommandArgs, report: PruneReport, code: number, error?: PruneReport['error']): number {
  report.exitCode = code;
  report.ok = code === EXIT.ok;
  if (error) report.error = error;
  if (args.json) {
    io.stdout.write(`${JSON.stringify(report)}\n`);
    return code;
  }
  if (!args.quiet) for (const warning of report.warnings) io.stderr.write(`napkin-sketch: warning: ${warning}\n`);
  if (error) {
    io.stderr.write(`napkin-sketch: ${error.message}\n`);
    if (error.kind === 'usage') io.stderr.write('Run "napkin-sketch prune --help" for its options.\n');
  }
  return code;
}

function run(io: CommandIo, args: CommandArgs, report: PruneReport): number {
  const project = projectOf(io.cwd);
  if (!project) throw new PruneStop(`there is no package.json at or above ${io.cwd}, so there is no project to prune`, 'io');
  const installed = join(project, 'node_modules', ...PACKAGE_NAME.split('/'));
  if (!existsSync(installed)) throw new PruneStop(`${project} has no install of ${PACKAGE_NAME} in node_modules`, 'io');
  const root = realpathSync(installed);
  if (!root.split(sep).includes('node_modules') || existsSync(join(root, '.git'))) {
    throw new PruneStop(`${installed} is ${root}, which is not an install under node_modules - a clone or a linked folder - and prune never removes from one`, 'io');
  }
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string; version?: string; exports?: Record<string, unknown> };
  if (manifest.name !== PACKAGE_NAME) throw new PruneStop(`${installed} holds ${manifest.name ?? 'a package with no name'}, not ${PACKAGE_NAME}`, 'io');
  const record = readParts(join(root, 'dist'));
  report.project = relative(io.cwd, project) || '.';
  report.installed = relative(io.cwd, installed).split(sep).join('/');

  // The marks: the ones given, recorded for the next prune, or the recorded ones.
  const projectManifest = join(project, 'package.json');
  let marks: string[];
  if (args.keep.length > 0) {
    marks = readMarks(args.keep, record);
    writeMarks(projectManifest, marks);
  } else {
    const recorded = (JSON.parse(readFileSync(projectManifest, 'utf8')) as { napkinSketch?: { keep?: unknown } }).napkinSketch?.keep;
    if (!Array.isArray(recorded) || recorded.length === 0) {
      throw new PruneStop(`nothing is marked to keep in ${report.project === '.' ? 'package.json' : join(report.project, 'package.json')}: run napkin-sketch prune --keep <marks>`, 'usage');
    }
    marks = readMarks(recorded.map(String), record);
  }
  report.keep = marks;

  const keep = keptFiles(root, record, marks);
  const all = filesUnder(root);
  const size = (file: string): number => statSync(join(root, ...file.split('/'))).size;
  // The command line goes last, since this is it running.
  const remove = all.filter((file) => !keep.has(file)).sort((a, b) => Number(a.startsWith('dist/cli/')) - Number(b.startsWith('dist/cli/')));
  report.remove = remove;
  report.removedBytes = remove.reduce((sum, file) => sum + size(file), 0);
  report.keptBytes = all.filter((file) => keep.has(file)).reduce((sum, file) => sum + size(file), 0);
  report.unimportable = Object.values(record.parts)
    .filter((part) => !marks.includes(partName(part.subpath)) && part.files.some((file) => !keep.has(`dist/${file}`)))
    .map((part) => (part.subpath === '.' ? PACKAGE_NAME : `${PACKAGE_NAME}/${part.subpath.slice(2)}`));
  if (!marks.includes('cli') && remove.some((file) => file.startsWith('dist/cli/'))) {
    report.warnings.push('the napkin-sketch command is not kept, so it goes too; the next install brings it back, and runs a postinstall prune from it');
  }

  if (args.apply) {
    for (const file of remove) rmSync(join(root, ...file.split('/')), { force: true });
    removeEmptyFolders(root);
  }

  if (!args.json && !args.quiet) {
    const mb = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`);
    const total = report.removedBytes + report.keptBytes;
    const lines = [`keeping ${marks.join(', ')} in ${report.installed}`];
    lines.push(
      args.apply
        ? `removed ${remove.length} files, ${mb(report.removedBytes)}; ${mb(report.keptBytes)} of ${mb(total)} kept`
        : `would remove ${remove.length} files, ${mb(report.removedBytes)} of ${mb(total)}; run napkin-sketch prune --apply to remove them`,
    );
    if (report.unimportable.length > 0) lines.push(`${args.apply ? 'no longer importable' : 'would no longer import'}: ${report.unimportable.join(', ')}`);
    io.stdout.write(`${lines.join('\n')}\n`);
  }
  return done(io, args, report, EXIT.ok);
}
