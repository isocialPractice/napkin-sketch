/**
 * Resolves a `references/resources.md` into brand assets a composition can draw.
 *
 * This is the Node half of the brand feature. The parsing, the vector
 * inlining, the slot placement and the fallback mark all live in the
 * graphic-design API, where both the analyzer and every generated script reach
 * them; what is left here is the part that needs a file system: find the file,
 * resolve its paths, follow its symlinks, read the bytes.
 *
 *   node brand-resources.mjs --print
 *   node brand-resources.mjs --print --resources path/to/resources.md
 *   node brand-resources.mjs --init path/to/references/
 *   node brand-resources.mjs --registration          what is wired up, if anything
 *
 * A generated skill carries a copy of this file, so the skill runs anywhere the
 * API does without reaching back into the helper that generated it.
 *
 * `references/resources.md` documents the format. The short version: a
 * markdown list of `- key: value`, where a value with a separator or a media
 * extension is a path and everything else is text to draw.
 */

import { existsSync } from 'node:fs';
import { readFile, readdir, realpath, stat, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Media types a placement recognises by extension. */
const MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Extensions worth reading out of a global assets folder. */
const ASSET_EXTENSIONS = new Set(Object.keys(MEDIA_TYPES));

/**
 * Finds the napkin-sketch graphic-design API.
 *
 * The package first, so this works as a dependency, then a clone's build
 * output. Mirrors the analyzer and every generated script, so all three run in
 * the same places.
 */
export async function loadGraphicApi(from = fileURLToPath(import.meta.url)) {
  try {
    return await import('napkin-sketch');
  } catch {
    // Not installed as a package; look for a clone's build output instead.
  }
  let dir = dirname(from);
  for (let i = 0; i < 12; i++) {
    const built = join(dir, 'dist', 'api', 'index.js');
    if (existsSync(built)) return import(pathToFileURL(built).href);
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(
    'graphic-design API not found. Run `npm run build` in a napkin-sketch clone, or install napkin-sketch.'
  );
}

/**
 * Finds the `resources.md` that applies, in the order a caller means it.
 *
 * An explicit path wins, then the environment - which is how a test points a
 * production script at test assets without editing the script - then the
 * skill's own `references/` folder, then any `references/resources.md` above
 * the working directory.
 */
export function findResourcesFile({ path, skillDir, cwd = process.cwd() } = {}) {
  if (path) return resolve(path);
  const fromEnv = process.env.NAPKIN_BRAND_RESOURCES;
  if (fromEnv) return resolve(fromEnv);
  if (skillDir) {
    const beside = join(skillDir, 'references', 'resources.md');
    if (existsSync(beside)) return beside;
  }
  let dir = resolve(cwd);
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'references', 'resources.md');
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** Resolves a declared path against the file that declared it, then the cwd. */
async function resolveDeclared(value, roots) {
  if (isAbsolute(value)) return existsSync(value) ? value : null;
  for (const root of roots) {
    const candidate = resolve(root, value);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** One resolved asset: what was declared, what it resolved to, what it is. */
async function describeAsset(key, declared, roots) {
  const found = await resolveDeclared(declared, roots);
  const extension = extname(declared).toLowerCase();
  const asset = {
    key,
    declared,
    path: found,
    exists: Boolean(found),
    mime: MEDIA_TYPES[extension] ?? 'application/octet-stream',
    kind: extension === '.svg' ? 'vector' : 'raster',
    /** Set when the declared path was a symlink, so a report can say so. */
    target: null,
  };
  if (found) {
    try {
      const real = await realpath(found);
      if (real !== found) asset.target = real;
    } catch {
      // A path that resolves but cannot be realpathed is still usable.
    }
  }
  return asset;
}

/**
 * Reads a `resources.md` and resolves everything it declares.
 *
 * Returns the assets keyed by descriptor, the raw text, and - the part worth
 * checking - `configured`, which is false when there is no file, no asset
 * resolved, and no text. That flag is what a script branches on to decide
 * between a real brand and a mark drawn in the design language.
 */
export async function loadBrandResources(options = {}) {
  const api = options.api ?? (await loadGraphicApi());
  const file = findResourcesFile(options);
  const resources = {
    path: file,
    assets: {},
    text: {},
    configured: false,
    notes: [],
  };

  if (!file || !existsSync(file)) {
    resources.notes.push(
      file
        ? `No \`resources.md\` at ${file}.`
        : 'No `references/resources.md` was found, so brand slots fall back to the design language.'
    );
    return resources;
  }

  const parsed = api.parseResources(await readFile(file, 'utf-8'));
  resources.text = { ...parsed.text };
  resources.notes.push(...parsed.notes);
  const roots = [dirname(file), dirname(dirname(file)), process.cwd()];

  // Folders first, so a single key can override what the folder supplies.
  for (const [key, declared] of Object.entries(parsed.directories)) {
    const dir = await resolveDeclared(declared, roots);
    if (!dir) {
      resources.notes.push(`\`${key}\` names \`${declared}\`, which is not there.`);
      continue;
    }
    let entries = [];
    try {
      entries = (await stat(dir)).isDirectory() ? await readdir(dir) : [basename(dir)];
    } catch {
      resources.notes.push(`\`${key}\` names \`${declared}\`, which could not be read.`);
      continue;
    }
    for (const name of entries) {
      if (!ASSET_EXTENSIONS.has(extname(name).toLowerCase())) continue;
      const descriptor = api.descriptorFromFilename(name);
      if (!descriptor) continue;
      resources.assets[descriptor] = await describeAsset(descriptor, join(dir, name), [dirname(file)]);
      resources.assets[descriptor].declared = join(declared, name).replace(/\\/g, '/');
    }
  }

  for (const [key, declared] of Object.entries(parsed.paths)) {
    const asset = await describeAsset(key, declared, roots);
    if (!asset.exists) {
      resources.notes.push(`\`${key}\` names \`${declared}\`, which is not there.`);
    }
    resources.assets[key] = asset;
  }

  resources.configured =
    Object.values(resources.assets).some((a) => a.exists) || Object.keys(resources.text).length > 0;
  return resources;
}

/**
 * Reads one resolved asset into something `placeBrand` can draw.
 *
 * A vector comes back as markup to inline, which is what puts a logo in the
 * PNG as well as the SVG; a raster comes back as a data URL. Anything the
 * rasterizer cannot decode is still returned - it draws in the SVG - and the
 * note says what the PNG will be missing.
 */
export async function readBrandSource(asset) {
  if (!asset?.exists || !asset.path) return null;
  if (asset.kind === 'vector') {
    return { kind: 'vector', svg: await readFile(asset.path, 'utf-8'), alt: asset.key };
  }
  const bytes = await readFile(asset.path);
  return {
    kind: 'raster',
    dataUrl: `data:${asset.mime};base64,${bytes.toString('base64')}`,
    alt: asset.key,
  };
}

/**
 * What else will do, when a slot's own name is not in `resources.md`.
 *
 * A design language names its slots after the source asset's layers, and a
 * brand names its files after what they are. Those two vocabularies meet in the
 * middle often enough - a band called `linkedMedia` wants the file called
 * `footer.png` - that refusing to connect them would make most `resources.md`
 * files look broken when they are merely worded differently.
 *
 * Order is preference: the first name that resolves wins, and a slot's own name
 * always comes first.
 */
const SLOT_ALIASES = {
  logo: ['logo', 'wordmark', 'brandMark', 'icon'],
  wordmark: ['wordmark', 'logo'],
  icon: ['icon', 'favicon', 'logo'],
  linkedMedia: ['linkedMedia', 'footer', 'banner', 'strip'],
  footer: ['footer', 'linkedMedia', 'banner', 'strip'],
  banner: ['banner', 'footer', 'linkedMedia'],
  badge: ['badge', 'icon', 'logo'],
};

/**
 * The whole brand, ready to draw.
 *
 * `brand.place(design, 'logo', box, options)` is the one call a composition
 * needs: it draws the asset when there is one and the language's own mark when
 * there is not, and either way it reports which happened so a script can say so
 * in its output rather than leaving the caller to wonder.
 */
export async function resolveBrand(options = {}) {
  const api = options.api ?? (await loadGraphicApi());
  const resources = await loadBrandResources({ ...options, api });
  const sources = new Map();

  for (const asset of Object.values(resources.assets)) {
    if (!asset.exists) continue;
    sources.set(asset.key, await readBrandSource(asset));
  }

  /** The asset a slot resolves to, following the alias order. */
  const sourceFor = (key) => {
    for (const name of SLOT_ALIASES[key] ?? [key]) {
      const source = sources.get(name);
      if (source) return source;
    }
    return null;
  };

  return {
    ...resources,
    api,
    /** The text a slot carries, if any: `brandName`, `domain`, `tagline`. */
    textFor(key) {
      return resources.text[key] ?? null;
    },
    /** Whether a slot has a real asset behind it, its aliases included. */
    has(key) {
      return sourceFor(key) !== null;
    },
    /**
     * Draws a brand slot into a box.
     *
     * @param {object} list a composition or a group
     * @param {string} key the slot: `logo`, `icon`, `footer`, anything declared
     * @param {{x:number,y:number,width:number,height:number}} box where it goes
     * @param {object} [options] `fit`, plus the palette the fallback draws in
     */
    place(list, key, box, placeOptions = {}) {
      const source = sourceFor(key);
      if (source) {
        return api.placeBrand(list, box, source, { name: key, ...placeOptions });
      }
      if (placeOptions.fallback === false) {
        return { placed: false, mode: 'none', box, notes: [`No asset for \`${key}\`.`] };
      }
      return api.brandMark(list, box, {
        label: resources.text.brandName ?? placeOptions.label ?? '',
        name: key,
        ...placeOptions,
      });
    },
  };
}

/** The closing instructions a generated script prints once it has drawn. */
export function brandInstructions(resources) {
  const path = resources?.path ? relative(process.cwd(), resources.path).replace(/\\/g, '/') : null;
  if (resources?.configured) {
    const drawn = Object.values(resources.assets).filter((a) => a.exists).length;
    return [
      `Brand: ${drawn} asset${drawn === 1 ? '' : 's'} from ${path}.`,
      'Change what the graphics carry by editing that file, not this script.',
    ].join('\n');
  }
  return [
    path
      ? `Brand: nothing configured in ${path}, so brand areas were drawn in the design language.`
      : 'Brand: no `references/resources.md`, so brand areas were drawn in the design language.',
    'To use your own marks, put this beside the skill as `references/resources.md`:',
    '',
    '  - logo: path/to/logo.svg',
    '  - GLOBAL_ASSETS: path/to/assets/',
    '  - brand name: Acme Corp.',
    '  - domain: example.com',
    '',
    'Paths are relative to that file. In a folder given as GLOBAL_ASSETS the file',
    'name is the slot it fills, so `logo.svg` fills the logo and `footer.png` the',
    'footer. Re-run this script and the graphics carry them.',
  ].join('\n');
}

/**
 * The file that says which generated skill is wired up, and to what.
 *
 * It sits beside `resources.md` for one reason: the two answer halves of the
 * same question. `resources.md` says what the brand is; this says which tool
 * draws with it, where its script lives, and what to draw when nobody says.
 * One folder, one discovery rule, nothing else to remember.
 *
 * This is what makes a generated skill plug-and-play. Without it, "draw
 * something in the captured language" needs a path nobody has memorised; with
 * it, the request is the whole instruction.
 */
export const REGISTRATION_NAME = 'graphic-design-api.json';

/** Finds the registration the way {@link findResourcesFile} finds its file. */
export function findRegistration({ registration, cwd = process.cwd() } = {}) {
  if (registration) return resolve(registration);
  const fromEnv = process.env.NAPKIN_GRAPHIC_DESIGN_API;
  if (fromEnv) return resolve(fromEnv);
  let dir = resolve(cwd);
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'references', REGISTRATION_NAME);
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/**
 * Reads the registration, resolving its paths against the project that holds it.
 *
 * Returns null when there is none, which is the ordinary state rather than an
 * error: a project that has not generated a skill yet is not broken, it is just
 * not wired up.
 */
export async function readRegistration(options = {}) {
  const file = findRegistration(options);
  if (!file || !existsSync(file)) return null;

  let data;
  try {
    data = JSON.parse(await readFile(file, 'utf-8'));
  } catch (err) {
    return { path: file, broken: `${REGISTRATION_NAME} is not valid JSON: ${err.message}` };
  }

  // Paths are stored relative to the project root, which is the folder holding
  // `references/`. Resolving them here is what lets the file survive a clone to
  // a different absolute path.
  const root = dirname(dirname(file));
  const absolute = (value) => (value ? resolve(root, value) : null);
  const script = absolute(data.script);
  return {
    ...data,
    path: file,
    root,
    script,
    skillDir: absolute(data.skillDir),
    resources: absolute(data.resources),
    out: absolute(data.out),
    /** False when the skill it names has been deleted since it was written. */
    usable: Boolean(script && existsSync(script)),
  };
}

/** Records which skill is wired up, and what a bare `generate` means. */
export async function writeRegistration(dir, data) {
  const target = join(resolve(dir), REGISTRATION_NAME);
  await mkdir(resolve(dir), { recursive: true });
  await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  return target;
}

/**
 * The command that satisfies a request, as a list a caller can run.
 *
 * A registration carries named modes - `card`, `cheatsheet` - each a set of
 * flags for the generated script. Matching a request to one is deliberately
 * dumb string matching: the request is read for a mode's keywords, and the
 * default mode wins when none appear. Anything cleverer would be a model's job,
 * and the point of this function is to be the part that is not.
 */
export function commandFor(registration, request = '') {
  if (!registration?.usable) return null;
  const text = String(request ?? '').toLowerCase().trim();
  const modes = registration.modes ?? {};
  const names = Object.keys(modes);
  if (names.length === 0) return null;

  const matched =
    names.find((name) => {
      const keywords = modes[name].keywords ?? [name];
      return keywords.some((word) => text.includes(String(word).toLowerCase()));
    }) ??
    registration.defaultMode ??
    names[0];

  const mode = modes[matched];
  if (!mode) return null;

  // The brand and the output folder come from the registration rather than the
  // mode, because they are properties of the project and the mode is a
  // property of the drawing. Passing the project's `resources.md` explicitly
  // matters: the skill carries a snapshot of one from generation time, and the
  // live file is the one somebody edits.
  const args = [registration.script, ...(mode.args ?? [])];
  if (registration.resources) args.push('--resources', registration.resources);
  if (registration.out) args.push('--out', registration.out);
  return { mode: matched, args, describes: mode.describes ?? matched };
}

/**
 * The starter file `--init` writes.
 *
 * Every value in it is a placeholder the parser rejects on purpose - a path
 * under `path/to/` and text reading `TBD`. A freshly initialised file is
 * therefore *not* configured, and the graphics look exactly as they did before
 * it existed. A template that shipped `Acme Corp.` as a working value would
 * quietly print it onto real work.
 */
const TEMPLATE = `# Brand resources

What this skill draws into the brand areas of every graphic it composes.
Paths are relative to this file. Delete the lines you do not have - a slot with
nothing behind it is drawn in the design language rather than left empty.

A filled-in file looks like this:

\`\`\`md
- logo: assets/logo.svg
- GLOBAL_ASSETS: assets/brand/
- brand name: Acme Corp.
- domain: example.com
\`\`\`

## This project

- logo: path/to/logo.svg
- icon: path/to/icon.png
- GLOBAL_ASSETS: path/to/assets/
- brand name: TBD
- domain: TBD
- tag line: TBD

> In a GLOBAL_ASSETS folder the file name is the slot it fills: \`logo.svg\`
> fills the logo, \`footer.png\` fills the footer.
`;

/** Writes the starter file, and never over one that is already there. */
export async function initResources(dir) {
  const target = join(resolve(dir), 'resources.md');
  if (existsSync(target)) return { path: target, written: false };
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, TEMPLATE, 'utf-8');
  return { path: target, written: true };
}

async function run() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const init = flag('init');
  if (init !== undefined) {
    const { path, written } = await initResources(init);
    console.log(written ? `wrote ${path}` : `${path} already exists; left it alone`);
    return;
  }

  // `--registration` answers the question an AI tool asks first: am I wired up,
  // and if so, what does a bare "generate" mean here?
  if (args.includes('--registration')) {
    const registration = await readRegistration({ registration: flag('registration') });
    if (!registration) {
      console.log('registration: none. Generate a skill first, or pass --resources by hand.');
      return;
    }
    console.log(`registration: ${registration.path}`);
    if (registration.broken) {
      console.log(`  broken: ${registration.broken}`);
      return;
    }
    console.log(`  skill:     ${registration.skill}`);
    console.log(`  script:    ${registration.script}${registration.usable ? '' : '  (MISSING)'}`);
    console.log(`  resources: ${registration.resources}`);
    console.log(`  output:    ${registration.out}`);
    console.log(`  default:   "${registration.defaultRequest ?? ''}"`);
    for (const [name, mode] of Object.entries(registration.modes ?? {})) {
      console.log(`  mode ${name.padEnd(12)} ${(mode.args ?? []).join(' ')}`);
    }
    const command = commandFor(registration, flag('request', registration.defaultRequest ?? ''));
    if (command) console.log(`  run:       node ${command.args.join(' ')}`);
    return;
  }

  const resources = await loadBrandResources({ path: flag('resources') });
  console.log(resources.path ? `resources: ${resources.path}` : 'resources: none found');
  const assets = Object.values(resources.assets);
  if (assets.length === 0) console.log('  (no assets declared)');
  for (const asset of assets) {
    const where = asset.exists ? asset.path : 'NOT FOUND';
    console.log(`  ${asset.key.padEnd(14)} ${asset.declared} -> ${where}${asset.target ? ` (symlink to ${asset.target})` : ''}`);
  }
  for (const [key, value] of Object.entries(resources.text)) {
    console.log(`  ${key.padEnd(14)} "${value}"`);
  }
  for (const note of resources.notes) console.log(`  note: ${note}`);
  console.log(`configured: ${resources.configured}`);
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
const self = resolve(fileURLToPath(import.meta.url));
if (process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self) {
  run().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
