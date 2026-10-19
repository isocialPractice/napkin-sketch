/**
 * `napkin-sketch vendor`: copies parts of the package into a project.
 *
 * A project that installs nothing - a static site served as it is, say - or
 * that would rather not load the main entry, takes a part as files of its
 * own: the part's entry and every file it reaches, byte for byte, laid out as
 * `dist/` lays them out so their imports resolve unchanged. What a part is
 * comes from `dist/parts.json`, which the build writes and `pack-check` holds
 * to the bundles, so nothing here guesses at a chunk's hashed name.
 *
 * Beside the parts go `LICENSE`, the third-party notices those files owe and
 * no others, `VENDOR.json` - the version, the registry's address and integrity
 * for it, and a sha256 per file - and `VENDOR-CHECK.mjs`, which checks the
 * folder against that record with plain `node`, no install and no network.
 * Nothing vendored is edited: a fix arrives by vendoring a newer version.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

import type { CommandArgs } from './args.js';
import { EXIT, type CommandIo } from './draw.js';

/** The record of a vendored folder, which `--check` and `VENDOR-CHECK.mjs` hold the folder to. */
export const RECORD_NAME = 'VENDOR.json';

/** The script that checks a vendored folder with nothing installed. */
export const CHECK_NAME = 'VENDOR-CHECK.mjs';

/** One part, as `dist/parts.json` records it. */
export interface PartRecord {
  subpath: string;
  entry: string;
  types: string | null;
  platform: 'browser' | 'node';
  files: string[];
  bytes: number;
  notices: string[];
}

/** `dist/parts.json`. */
export interface PartsRecord {
  name: string;
  version: string;
  notices: { [id: string]: string };
  parts: { [name: string]: PartRecord };
}

/**
 * `VENDOR.json`. Its first six fields are the ones a hand-written vendoring
 * script records as a pin - name, version, tarball, integrity, entries and a
 * sha256 per file - so a check written for that reads this too.
 */
export interface VendorRecord {
  name: string;
  version: string;
  /** The registry's address for this version's tarball, when it was reached. */
  tarball?: string;
  /** The registry's integrity for that tarball, when it was reached. */
  integrity?: string;
  /** Each part's entry, by part name. */
  entries: { [part: string]: string };
  /** Every file in the folder but this record, by path from the folder, with its sha256. */
  files: { [path: string]: string };
  parts: string[];
  /** The AI helper plugins copied beside the parts, under `ai-helper/`. */
  helpers: string[];
  /** Whether each part's declarations were copied. */
  types: boolean;
  /** The third-party notices the files owe, in `THIRD-PARTY-NOTICES.md`. */
  notices: string[];
  /** `package` for an installed package, `clone` for a repository's own build. */
  source: 'package' | 'clone';
  generator: string;
  writtenAt: string;
}

/** What `vendor` reports: printed for a person, or as one line of JSON with `--json`. */
interface VendorReport {
  ok: boolean;
  exitCode: number;
  version: string;
  mode: 'copy' | 'check' | 'list';
  /** The folder copied into or checked, as given. */
  folder?: string;
  parts?: string[];
  /** The AI helper plugins copied, or for `--list`, the ones there are. */
  helpers?: string[];
  /** The files written, by path from the folder. */
  files?: string[];
  /** The files a refresh removed, by path from the folder. */
  removed?: string[];
  notices?: string[];
  /** For `--check`: what does not match the record. */
  drift?: { differs: string[]; missing: string[]; added: string[] };
  /** For `--list`: every part, with what it costs a page. */
  list?: Array<{ name: string; subpath: string; platform: string; files: number; bytes: number; gzipped: number; notices: string[] }>;
  warnings: string[];
  error?: { kind: 'usage' | 'io'; message: string };
}

/** A file that could not be read or written, or a folder vendor will not write into: exit code 3. */
class VendorIoError extends Error {}

/**
 * What a vendored AI helper leaves out: what the package leaves out of its
 * `ai-helper/` folder, the reference sheets and their data, which the skills
 * fetch by the addresses in `assets/uri.md`. A copy from a clone is then the
 * copy an install gives.
 */
const HELPER_LEFT_OUT = /(?:^|\/)assets\/[^/]+\.(?:svg|png|json)$/;

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The AI helper plugins a package or a clone holds: each folder of `ai-helper/` with a plugin manifest. */
export function helpersIn(packageRoot: string): string[] {
  const root = join(packageRoot, 'ai-helper');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, '.claude-plugin', 'plugin.json')))
    .map((entry) => entry.name)
    .sort();
}

/** Every file under `dir`, as POSIX paths from it. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(dir, path).split(sep).join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return found.sort();
}

/** Reads the built package's record of its parts. */
export function readParts(dist: string): PartsRecord {
  const path = join(dist, 'parts.json');
  if (!existsSync(path)) throw new VendorIoError(`${path} is missing: this build records no parts; run npm run build`);
  return JSON.parse(readFileSync(path, 'utf8')) as PartsRecord;
}

/** A part's name as `parts.json` keys it, from the name or the subpath a person typed. */
export function partName(typed: string): string {
  const name = typed.replace(/^@isocialpractice\/napkin-sketch\/?/, '').replace(/^\.\/?/, '');
  return name === '' ? 'main' : name;
}

/** The declarations a part's types reach, from `dist/`, walked through their relative imports. */
export function typesClosure(dist: string, types: string): string[] {
  const seen = new Set<string>();
  const stack = [types];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file) || !existsSync(join(dist, file))) continue;
    seen.add(file);
    const text = readFileSync(join(dist, file), 'utf8');
    for (const match of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      stack.push(posix.normalize(posix.join(posix.dirname(file), match[1].replace(/\.js$/, '.d.ts'))));
    }
  }
  return [...seen].sort();
}

/**
 * The notices file for a vendored folder: the sections of the package's
 * `THIRD-PARTY-NOTICES.md` its files owe, and no others. A section runs from
 * its heading to the next heading outside a code fence, since a license
 * reproduced in a fence carries headings of its own.
 */
export function cutNotices(text: string, owed: readonly string[], headings: { [id: string]: string }, name: string, version: string): string {
  const wanted = new Set(owed.map((id) => headings[id]).filter(Boolean));
  const sections: string[][] = [];
  let current: string[] | null = null;
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (!fenced && /^#{1,3} /.test(line)) {
      current = wanted.has(line) ? [] : null;
      if (current) sections.push(current);
    }
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (current) current.push(line);
  }
  const intro =
    sections.length > 0
      ? `These files are ${name} ${version}, MIT-licensed (see LICENSE), copied here by \`napkin-sketch vendor\`. They bundle the code and the data below, each under its own license, which is reproduced here as that license asks.`
      : `These files are ${name} ${version}, MIT-licensed (see LICENSE), copied here by \`napkin-sketch vendor\`. They bundle no third-party code, so LICENSE is the only license that applies.`;
  const body = sections.map((lines) => lines.join('\n').trimEnd()).join('\n\n');
  return `# Third-party notices\n\n${intro}\n${body ? `\n${body}\n` : ''}`;
}

/** The script written as `VENDOR-CHECK.mjs`: the same check as `vendor --check`, with plain node. */
export const CHECK_SCRIPT = `#!/usr/bin/env node
// Checks this folder against the VENDOR.json beside it: every file it records
// is here with the same sha256, and nothing else is. It needs no install and
// no network. Written by \`napkin-sketch vendor\`, which also runs this check as
// \`napkin-sketch vendor --check <dir>\`. Exits 0 when the folder matches, and
// 1, naming each file, when it does not.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const record = JSON.parse(readFileSync(join(here, '${RECORD_NAME}'), 'utf8'));
const found = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else found.push(relative(here, path).split(sep).join('/'));
  }
};
walk(here);

const problems = [];
for (const [file, sha256] of Object.entries(record.files)) {
  let bytes;
  try {
    bytes = readFileSync(join(here, ...file.split('/')));
  } catch {
    problems.push(\`missing: \${file}\`);
    continue;
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) problems.push(\`differs: \${file}\`);
}
for (const file of found) if (file !== '${RECORD_NAME}' && !(file in record.files)) problems.push(\`added: \${file}\`);

if (problems.length > 0) {
  console.error(\`\${record.name} \${record.version}, vendored here, does not match ${RECORD_NAME}:\\n\${problems.map((p) => \`  \${p}\`).join('\\n')}\`);
  process.exit(1);
}
console.log(\`\${record.name} \${record.version}: \${Object.keys(record.files).length} files match ${RECORD_NAME}.\`);
`;

/** What in `dir` does not match its record: a file that differs, is missing, or is not recorded. */
export function driftOf(dir: string, record: VendorRecord): { differs: string[]; missing: string[]; added: string[] } {
  const differs: string[] = [];
  const missing: string[] = [];
  for (const [file, hash] of Object.entries(record.files)) {
    const path = join(dir, ...file.split('/'));
    if (!existsSync(path)) missing.push(file);
    else if (sha256(readFileSync(path)) !== hash) differs.push(file);
  }
  const added = filesUnder(dir).filter((file) => file !== RECORD_NAME && !(file in record.files));
  return { differs, missing, added };
}

/** The registry's tarball address and integrity for a version, or why there are none. */
async function registryEntry(name: string, version: string): Promise<{ tarball: string; integrity: string } | { warning: string }> {
  const address = `https://registry.npmjs.org/${name}/${version}`;
  try {
    const response = await fetch(address, { signal: AbortSignal.timeout(15000) });
    if (response.status === 404) return { warning: `${name} ${version} is not on the registry, so VENDOR.json records no tarball or integrity` };
    if (!response.ok) return { warning: `the registry answered ${response.status} for ${address}, so VENDOR.json records no tarball or integrity` };
    const document = (await response.json()) as { dist?: { tarball?: string; integrity?: string } };
    if (!document.dist?.tarball || !document.dist.integrity) return { warning: `the registry gave no tarball and integrity for ${name} ${version}` };
    return { tarball: document.dist.tarball, integrity: document.dist.integrity };
  } catch (err) {
    return { warning: `the registry could not be reached (${(err as Error).message}), so VENDOR.json records no tarball or integrity; --offline says so without trying` };
  }
}

/** Removes the folders under `dir` that a refresh left empty. */
function removeEmptyFolders(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    removeEmptyFolders(path);
    if (readdirSync(path).length === 0) rmdirSync(path);
  }
}

/** Runs `vendor` and returns its exit code. */
export async function vendor(io: CommandIo, args: CommandArgs): Promise<number> {
  const mode = args.list ? 'list' : args.verify !== undefined ? 'check' : 'copy';
  const report: VendorReport = { ok: false, exitCode: EXIT.ok, version: io.version ?? 'unknown', mode, warnings: [] };
  try {
    if (mode === 'check') return check(io, args, report, args.verify!);
    if (!io.dist) throw new VendorIoError('vendor found no built package to copy from');
    if (mode === 'list') return list(io, args, report, io.dist);
    return await copy(io, args, report, io.dist);
  } catch (err) {
    if (err instanceof VendorIoError) return done(io, args, report, EXIT.io, { kind: 'io', message: err.message });
    if ((err as NodeJS.ErrnoException).code && (err as NodeJS.ErrnoException).path) {
      return done(io, args, report, EXIT.io, { kind: 'io', message: (err as Error).message });
    }
    throw err;
  }
}

/** Sets the exit code, prints the report, and returns the code. */
function done(io: CommandIo, args: CommandArgs, report: VendorReport, code: number, error?: VendorReport['error']): number {
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
    if (error.kind === 'usage') io.stderr.write('Run "napkin-sketch vendor --help" for its options.\n');
  }
  return code;
}

function list(io: CommandIo, args: CommandArgs, report: VendorReport, dist: string): number {
  const record = readParts(dist);
  report.list = Object.entries(record.parts).map(([name, part]) => ({
    name,
    subpath: part.subpath,
    platform: part.platform,
    files: part.files.length,
    bytes: part.bytes,
    gzipped: part.files.reduce((sum, file) => sum + gzipSync(readFileSync(join(dist, file)), { level: 6 }).length, 0),
    notices: part.notices,
  }));
  report.helpers = helpersIn(dirname(dist));
  if (!args.json && !args.quiet) {
    const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
    const lines = [`${record.name} ${record.version}: ${report.list.length} parts`, ''];
    lines.push(`  ${'part'.padEnd(22)}${'runs in'.padEnd(10)}${'files'.padStart(6)}${'gzipped'.padStart(11)}  notices`);
    for (const part of report.list) {
      lines.push(`  ${part.name.padEnd(22)}${part.platform.padEnd(10)}${String(part.files).padStart(6)}${kb(part.gzipped).padStart(11)}  ${part.notices.join(', ') || '-'}`);
    }
    if (report.helpers.length > 0) lines.push('', `AI helpers for --ai-helper (experimental): ${report.helpers.join(', ')}`);
    io.stdout.write(`${lines.join('\n')}\n`);
  }
  return done(io, args, report, EXIT.ok);
}

function check(io: CommandIo, args: CommandArgs, report: VendorReport, folder: string): number {
  report.folder = folder;
  const dir = resolve(io.cwd, folder);
  const path = join(dir, RECORD_NAME);
  if (!existsSync(path)) throw new VendorIoError(`${folder} holds no ${RECORD_NAME}, so it was not vendored, or its record was removed`);
  const record = JSON.parse(readFileSync(path, 'utf8')) as VendorRecord;
  report.parts = record.parts;
  report.drift = driftOf(dir, record);
  const { differs, missing, added } = report.drift;
  const count = differs.length + missing.length + added.length;
  if (!args.json && count === 0 && !args.quiet) {
    io.stdout.write(`${folder}: ${Object.keys(record.files).length} files match ${RECORD_NAME} (${record.name} ${record.version})\n`);
  }
  if (count === 0) return done(io, args, report, EXIT.ok);
  if (!args.json) {
    const lines = [...differs.map((file) => `differs: ${file}`), ...missing.map((file) => `missing: ${file}`), ...added.map((file) => `added: ${file}`)];
    io.stderr.write(`napkin-sketch: ${folder} does not match its ${RECORD_NAME} (${record.name} ${record.version}):\n${lines.map((line) => `  ${line}`).join('\n')}\n`);
  }
  return done(io, args, report, EXIT.drift);
}

async function copy(io: CommandIo, args: CommandArgs, report: VendorReport, dist: string): Promise<number> {
  const record = readParts(dist);
  const names = [...new Set(args.parts.map(partName))];
  const unknown = names.filter((name) => !record.parts[name]);
  if (unknown.length > 0) {
    return done(io, args, report, EXIT.usage, {
      kind: 'usage',
      message: `there is no part ${unknown.map((name) => `"${name}"`).join(', ')}; the parts are ${Object.keys(record.parts).join(', ')}`,
    });
  }
  const packageRoot = dirname(dist);
  const helpers = helpersIn(packageRoot);
  const strangers = args.aiHelpers.filter((name) => !helpers.includes(name));
  if (strangers.length > 0) {
    return done(io, args, report, EXIT.usage, {
      kind: 'usage',
      message: `there is no AI helper ${strangers.map((name) => `"${name}"`).join(', ')}; the helpers are ${helpers.join(', ') || 'none in this install'}`,
    });
  }
  report.parts = names;
  report.helpers = args.aiHelpers;
  report.folder = args.out!;

  const out = resolve(io.cwd, args.out!);
  const inside = (parent: string): boolean => out === parent || out.startsWith(`${parent}${sep}`);
  if (inside(packageRoot)) throw new VendorIoError(`--out ${args.out} is inside the package it would copy from`);
  const before = filesUnder(out);
  if (before.length > 0 && !before.includes(RECORD_NAME)) {
    throw new VendorIoError(`${args.out} holds files and no ${RECORD_NAME}, so vendor did not write it; give an empty or new folder`);
  }

  // What to copy, each from where it lives: each part's files, and with
  // --types its declarations, with a declaration beside an entry whose types
  // live elsewhere so an import of the entry finds them; each AI helper, under
  // ai-helper/ as the package lays it out, so its scripts find the API in the
  // VENDOR.json above them; and the license.
  const copied = new Map<string, string>();
  const written = new Map<string, string>();
  const owed = new Set<string>();
  const fromDist = (file: string): string => join(dist, ...file.split('/'));
  for (const name of names) {
    const part = record.parts[name];
    for (const file of part.files) copied.set(file, fromDist(file));
    for (const id of part.notices) owed.add(id);
    if (part.platform === 'node' && names.some((other) => record.parts[other].platform === 'browser')) {
      report.warnings.push(`${name} runs in Node only, as it reads files; a page must not load it`);
    }
    if (args.types && part.types) {
      if (!existsSync(fromDist(part.types))) {
        throw new VendorIoError(`${name}'s declarations, dist/${part.types}, are missing: this build has no types; run npm run build:types`);
      }
      for (const file of typesClosure(dist, part.types)) copied.set(file, fromDist(file));
      const beside = part.entry.replace(/\.js$/, '.d.ts');
      if (part.entry.endsWith('.js') && beside !== part.types) {
        const target = posix.relative(posix.dirname(beside), part.types.replace(/\.d\.ts$/, '.js'));
        written.set(beside, `export * from '${target.startsWith('.') ? target : `./${target}`}';\n`);
      }
    }
  }
  for (const name of args.aiHelpers) {
    const folder = join(packageRoot, 'ai-helper', name);
    for (const file of filesUnder(folder)) {
      if (!HELPER_LEFT_OUT.test(file)) copied.set(`ai-helper/${name}/${file}`, join(folder, ...file.split('/')));
    }
  }
  copied.set('LICENSE', join(packageRoot, 'LICENSE'));
  report.notices = [...owed].sort();

  for (const [file, from] of copied) {
    const target = join(out, ...file.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(from, target);
  }
  const notices = readFileSync(join(packageRoot, 'THIRD-PARTY-NOTICES.md'), 'utf8');
  written.set('THIRD-PARTY-NOTICES.md', cutNotices(notices, report.notices, record.notices, record.name, record.version));
  written.set(CHECK_NAME, CHECK_SCRIPT);
  for (const [file, text] of written) {
    const target = join(out, ...file.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, 'utf-8');
  }

  // A refresh removes what the new copy does not hold.
  const kept = new Set([...copied.keys(), ...written.keys()]);
  report.removed = before.filter((file) => file !== RECORD_NAME && !kept.has(file));
  for (const file of report.removed) rmSync(join(out, ...file.split('/')), { force: true });
  removeEmptyFolders(out);

  const source: VendorRecord['source'] = existsSync(join(packageRoot, 'src', 'api')) ? 'clone' : 'package';
  const registry = source === 'package' && !args.offline ? await registryEntry(record.name, record.version) : null;
  if (registry && 'warning' in registry) report.warnings.push(registry.warning);

  const files: VendorRecord['files'] = {};
  for (const file of [...kept].sort()) files[file] = sha256(readFileSync(join(out, ...file.split('/'))));
  const vendored: VendorRecord = {
    name: record.name,
    version: record.version,
    ...(registry && !('warning' in registry) ? { tarball: registry.tarball, integrity: registry.integrity } : {}),
    entries: Object.fromEntries(names.map((name) => [name, record.parts[name].entry])),
    files,
    parts: names,
    helpers: args.aiHelpers,
    types: args.types,
    notices: report.notices,
    source,
    generator: `napkin-sketch vendor ${record.version}`,
    writtenAt: new Date().toISOString(),
  };
  writeFileSync(join(out, RECORD_NAME), `${JSON.stringify(vendored, null, 2)}\n`, 'utf-8');
  report.files = Object.keys(files);

  if (!args.json && !args.quiet) {
    const check = posix.join(args.out!.split(sep).join('/'), CHECK_NAME);
    const what = [...names, ...args.aiHelpers.map((name) => `the ${name} helper`)].join(', ');
    io.stdout.write(
      `vendored ${what} from ${record.name} ${record.version} into ${args.out}: ${report.files.length} files` +
        `${report.removed.length > 0 ? `, ${report.removed.length} removed` : ''}\n` +
        `check it with: node ${check}\n`,
    );
  }
  return done(io, args, report, EXIT.ok);
}
