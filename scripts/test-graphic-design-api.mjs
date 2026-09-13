/**
 * End-to-end check of the graphic-design API's design-language pipeline.
 *
 *   npm run test:graphic-design-api
 *
 * `npm test` measures compositions. This measures the road to them: reading an
 * asset, generating a skill from it, pointing that skill at a brand, and
 * drawing graphics that carry the brand's own files. Those steps involve the
 * file system, a symlinked asset folder and a generated script, none of which a
 * bundled `node:test` suite can exercise honestly.
 *
 * What it runs is what a user runs. Every step here is a production entry
 * point - `generate-skill.mjs`, `brand-resources.mjs`, the generated script -
 * invoked exactly as the documentation says to invoke it. Nothing about the
 * brand path is test-only, which is the property the whole exercise is for: if
 * this passes, cloning the repository and following `API-QUICKSTART.md` works.
 *
 * The one thing it does differently: `--force`. Generating a skill over one
 * that already exists asks first, and a test cannot answer. Interactive use
 * still prompts; only this script assumes the answer.
 *
 * **It leaves the tool installed and wired up**, which is the point of running
 * it rather than merely of passing it. Afterwards the generated skill is in the
 * AI tool's real skills folder, `references/resources.md` names this
 * repository's own brand assets, and `references/graphic-design-api.json`
 * records what a bare request means - so the next thing anyone has to do is
 * ask for a graphic. Nothing to configure, unless the brand is a real one, in
 * which case the only edit is `references/resources.md`.
 *
 * Where things land:
 *
 *   references/resources.md              this repository's brand wiring
 *   references/graphic-design-api.json   which skill is wired, and to what
 *   <tool>/skills/<stem>/                the generated skill, installed for use
 *   test/graphic-design-api/generated-graphics/   the graphics, tracked
 *
 * `test/graphic-design-api/design-language/DESIGN_LANGUAGE.md` is deliberately
 * left alone. It is a worked example with a reader's corrections in it - the
 * analyzer's mechanical guess about colour roles was wrong and that file says
 * so - and corrections are the most valuable thing in a design language. The
 * regenerated one goes into the skill folder, where regenerating it is free.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = join(ROOT, 'test', 'graphic-design-api');
const HELPER = join(ROOT, 'ai-helper', 'graphic-designer', 'skills', 'design-language', 'scripts');
const SOURCE = join(SAMPLES, 'reference-graphics', 'created-svg_graphic-api.svg');
const REFERENCES = join(ROOT, 'references');
const RESOURCES = join(REFERENCES, 'resources.md');
const GRAPHICS = join(SAMPLES, 'generated-graphics');

/**
 * The request this run wires up as the default.
 *
 * It is the sentence somebody would actually type, kept verbatim on purpose:
 * the registration matches a request to a drawing mode by looking for a mode's
 * keywords in it, so recording the real wording is also the test of whether
 * that matching works on real wording.
 */
const DEFAULT_REQUEST = 'make a html cheatsheet. ensure to include linked assets';

/**
 * The AI tool folder the helper was installed to.
 *
 * `ai-helper/installed.json` records it. Falling back to `.claude` matches what
 * the installer itself defaults to, so a clone that has never run the installer
 * still ends up somewhere a tool will look.
 */
function toolFolder() {
  const record = join(ROOT, 'ai-helper', 'installed.json');
  if (existsSync(record)) {
    try {
      const target = JSON.parse(readFileSync(record, 'utf-8')).target;
      if (target) return join(ROOT, target);
    } catch {
      // A corrupt record is not worth failing over; the default is right.
    }
  }
  return join(ROOT, '.claude');
}

/**
 * The `resources.md` this run writes.
 *
 * It points at `test-assets/`, which holds git symlinks into
 * `reference-graphics/links/`. That indirection is the point rather than an
 * accident: a real project's brand folder is usually a link to somewhere else,
 * and a resolver that stops at a symlink would work everywhere except where it
 * matters.
 */
const RESOURCES_BODY = `# Brand resources

The brand \`npm run test:graphic-design-api\` draws with. \`scripts/test-graphic-design-api.mjs\`
rewrites this file on every run, so edit that script rather than this file.

It exists to prove one thing: the brand path a real project uses is the brand
path the test uses. Nothing here is test-only - the same \`resources.md\`, read
by the same resolver, placed by the same API.

- GLOBAL_ASSETS: ../test/graphic-design-api/test-assets/
- brand name: Acme Corp.
- domain: example.com
- tag line: Drawn from a design language

> That folder holds two git symlinks into \`reference-graphics/links/\`. The file
> name is the slot: \`logo.svg\` fills the logo, \`footer.png\` the footer.
>
> Point this at your own brand by changing the GLOBAL_ASSETS line. Paths are
> relative to this file.
`;

let failures = 0;
let checks = 0;

/** One assertion, reported and counted rather than thrown. */
function check(condition, description, detail = '') {
  checks++;
  if (condition) {
    console.log(`  ok    ${description}`);
    return true;
  }
  failures++;
  console.log(`  FAIL  ${description}${detail ? `\n        ${detail}` : ''}`);
  return false;
}

/** A path as the repository writes it, for output that is the same everywhere. */
const show = (path) => relative(ROOT, path).replace(/\\/g, '/');

/** Runs a command, returning its output and failing the run if it exits badly. */
function run(command, args, description) {
  try {
    return execFileSync(command, args, { cwd: ROOT, encoding: 'utf-8' });
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${description}\n        ${err.stdout ?? ''}${err.stderr ?? err.message}`);
    return '';
  }
}

/** Runs one of the helper's scripts under the Node that is running this. */
const node = (script, args, description) => run(process.execPath, [script, ...args], description);

async function main() {
  console.log('graphic-design API: design language, brand resources, generated skill\n');

  // 0. The API has to be built, because every step below reaches it the way a
  //    user does: the package if installed, a clone's `dist/` otherwise.
  if (!existsSync(join(ROOT, 'dist', 'api', 'index.js'))) {
    console.log('building the API first (dist/ was missing)\n');
    run('npm', ['run', 'build'], 'npm run build');
  }

  console.log('the symlinked test assets');
  const listed = run('git', ['ls-files', '-s', 'test/graphic-design-api/test-assets/'], 'git ls-files');
  for (const name of ['footer.png', 'logo.svg']) {
    const row = listed.split('\n').find((line) => line.trim().endsWith(name));
    check(Boolean(row && row.startsWith('120000 ')), `${name} is committed as a symlink`, row ?? 'not in the index');
    if (row) {
      const target = run('git', ['cat-file', '-p', row.split(/\s+/)[1]], 'git cat-file').trim();
      check(
        target.startsWith('../') && !target.includes('\\'),
        `${name} stores a relative, forward-slash target`,
        target
      );
    }
    check(existsSync(join(SAMPLES, 'test-assets', name)), `${name} resolves to a real file`);
  }

  // 1. Point the brand at those assets. A project edits this file by hand; the
  //    test writes it so a clone needs no setup before the first run.
  console.log('\nresources.md');
  await mkdir(REFERENCES, { recursive: true });
  await writeFile(RESOURCES, RESOURCES_BODY, 'utf-8');
  const printed = node(join(HELPER, 'brand-resources.mjs'), ['--print', '--resources', RESOURCES], 'brand-resources --print');
  check(/logo\s+\S*test-assets\/logo\.svg ->/.test(printed), 'the logo resolves through the global assets folder');
  check(/footer\s+\S*test-assets\/footer\.png ->/.test(printed), 'the footer resolves through the global assets folder');
  check(/symlink to/.test(printed), 'the resolver follows the symlinks and says so');
  check(/configured: true/.test(printed), 'the brand reports itself configured');

  // 2. Make sure the helper itself is current, so the skill that answers a
  //    request is the one this repository ships rather than an older copy.
  console.log('\ninstalling the helper');
  node(join(ROOT, 'scripts', 'install-ai-helper.mjs'), ['--helper', 'graphic-designer'], 'install the helper');
  const TOOL = toolFolder();
  check(existsSync(join(TOOL, 'skills', 'graphic-design-api', 'SKILL.md')), 'the composition skill is installed');
  check(existsSync(join(TOOL, 'skills', 'design-language', 'SKILL.md')), 'the design-language skill is installed');

  // 3. Generate the skill the way `/graphic-designer:design-language` does -
  //    into the tool's real skills folder, so it is usable the moment this
  //    finishes. `--force` is the only concession to being a test: interactive
  //    use asks before replacing a skill, and a script cannot answer.
  console.log('\ngenerating the skill from the reference graphic');
  const generated = node(
    join(HELPER, 'generate-skill.mjs'),
    [
      SOURCE,
      '--to', join(TOOL, 'skills'),
      '--resources', RESOURCES,
      '--register', REFERENCES,
      '--out', GRAPHICS,
      '--default-request', DEFAULT_REQUEST,
      '--default-mode', 'cheatsheet',
      '--force',
    ],
    'generate-skill'
  );
  const skillDir = join(TOOL, 'skills', 'created-svg_graphic-api');
  check(existsSync(join(skillDir, 'SKILL.md')), 'the skill has a SKILL.md');
  check(existsSync(join(skillDir, 'DESIGN_LANGUAGE.md')), 'the skill carries its design language');
  check(existsSync(join(skillDir, 'references', 'resources.md')), 'the skill carries a resources.md');
  check(existsSync(join(skillDir, 'scripts', 'brand-resources.mjs')), 'the skill carries its brand resolver');
  check(/brand slots:.*logo/.test(generated), 'the generator found a logo slot in the source', generated.trim());

  // The measured slots have to be the ones the source asset names, not
  // defaults. This is the whole claim of reading layer names.
  const skillDoc = await readFile(join(skillDir, 'SKILL.md'), 'utf-8');
  check(/\| `logo` \| top-right \|/.test(skillDoc), 'the logo slot was measured at the top right');
  check(/\| `linkedMedia` \| bottom-center \|/.test(skillDoc), 'the linked-media band was measured at the bottom');
  check(/named \|/.test(skillDoc.replace(/\s+/g, ' ')) || /\| named/.test(skillDoc), 'the slots came from layer names, not a scan');

  // A copied resources.md has to keep pointing at the same files.
  const copied = await readFile(join(skillDir, 'references', 'resources.md'), 'utf-8');
  check(/GLOBAL_ASSETS:.*test-assets/.test(copied), 'the copied resources.md still names the assets folder');

  // 4. The registration: what a request means, with no paths in it.
  //
  // This is the plug-and-play claim, and it is worth testing rather than
  // asserting in a README. A request arrives as a sentence; the registration
  // turns it into a command. If that works here it works for the next caller,
  // because there is nothing else in between.
  console.log('\nthe registration');
  const brandModule = await import(pathToFileURL(join(HELPER, 'brand-resources.mjs')).href);
  const registration = await brandModule.readRegistration({ cwd: ROOT });
  check(Boolean(registration), 'a registration was written');
  check(registration?.usable === true, 'it names a script that is there', registration?.script ?? '');
  check(registration?.defaultRequest === DEFAULT_REQUEST, 'it remembers the default request', registration?.defaultRequest);
  check(registration?.resources === RESOURCES, 'it points at the project brand file', registration?.resources ?? '');

  // The sentence somebody types, matched to a mode by its own words.
  const asked = brandModule.commandFor(registration, DEFAULT_REQUEST);
  check(asked?.mode === 'cheatsheet', 'the default request asks for a cheatsheet', asked?.mode ?? 'no match');

  // And the bare word, which has none of those words in it and has to fall
  // through to the default rather than matching nothing.
  const bare = brandModule.commandFor(registration, 'generate');
  check(bare?.mode === 'cheatsheet', '`generate` alone means the default request', bare?.mode ?? 'no match');
  check(
    bare?.args.includes('--resources') && bare?.args.includes('--out'),
    'the registered command carries the brand and the output folder'
  );

  // 5. Draw, by running exactly the command the registration produced.
  console.log('\ndrawing');
  await mkdir(GRAPHICS, { recursive: true });
  run(process.execPath, [...(bare?.args ?? []), '--name', 'cheatsheet'], 'the registered command draws a cheatsheet');

  const cardCommand = brandModule.commandFor(registration, 'make a card for the quarterly summary');
  check(cardCommand?.mode === 'card', 'a different request reaches a different mode', cardCommand?.mode ?? 'no match');
  run(
    process.execPath,
    [...(cardCommand?.args ?? []), '--name', 'card', '--heading', 'Quarterly Summary'],
    'the registered command draws a card'
  );

  for (const name of ['card', 'cheatsheet']) {
    check(existsSync(join(GRAPHICS, `${name}.svg`)), `${name}.svg was written`);
    check(existsSync(join(GRAPHICS, `${name}.png`)), `${name}.png was written`);
  }

  // 4. The claims worth making about what was drawn.
  console.log('\nwhat the graphics carry');
  const api = await import(pathToFileURL(join(ROOT, 'dist', 'api', 'index.js')).href);
  const logoMarkup = await readFile(join(SAMPLES, 'test-assets', 'logo.svg'), 'utf-8');
  const logoShapes = api.inlineSvg(logoMarkup);
  const logoPaths = logoShapes.elements.filter((el) => el.type === 'path').map((el) => el.d);

  for (const name of ['card', 'cheatsheet']) {
    const svg = await readFile(join(GRAPHICS, `${name}.svg`), 'utf-8');

    // The logo is inlined rather than linked, which is what puts it in the PNG.
    check(
      logoPaths.every((d) => svg.includes(d)),
      `${name}.svg draws the logo's own geometry, not a link to it`
    );
    check(!/<image[^>]*xlink:href="[^"d]/.test(svg), `${name}.svg has no external image reference`);

    // The footer strip is a raster, so it is placed as an image - a data URL,
    // embedded, with nothing to fetch.
    check(/<image[^>]*data:image\/png;base64/.test(svg), `${name}.svg embeds the footer artwork`);

    // And the PNG drew everything: a skipped placement lands in `warnings`, not
    // in an exception, so silence here is the only proof the raster is whole.
    const png = await readFile(join(GRAPHICS, `${name}.png`));
    check(png.length > 8000, `${name}.png is a real render`, `${png.length} bytes`);
  }

  // The raster path, measured rather than assumed: re-render the cheatsheet
  // through the API and read the warnings the file itself cannot show.
  const fixture = await import(
    pathToFileURL(join(SAMPLES, 'generated-skill', 'scripts', 'make-created-svg_graphic-api.mjs')).href
  );
  const brand = await brandModule.resolveBrand({ api, path: RESOURCES });
  const branded = fixture.composeCheatsheet(api, {
    title: 'HTML',
    heading: 'HTML Document Structure Starting Point',
    subheading: 'Head, Body, and the Tags Worth Memorizing',
    footer: 'jane.doe@example.com',
    rows: [[['<html>', 'tag']]],
    brand,
  });
  const render = api.renderPng(branded.toDocument(), { scale: 2 });
  check(render.warnings.length === 0, 'the raster skipped nothing', render.warnings.join('; '));

  // 6. The other half of the promise: with no brand configured, the same script
  //    still draws a complete page.
  console.log('\nwith no brand configured');
  const plain = fixture.composeCheatsheet(api, {
    title: 'HTML',
    heading: 'HTML Document Structure Starting Point',
    subheading: 'Head, Body, and the Tags Worth Memorizing',
    footer: 'jane.doe@example.com',
    rows: [[['<html>', 'tag']]],
  });
  const plainSvg = plain.toSVG();
  check(!plainSvg.includes('<image'), 'nothing is placed that was not configured');
  check(plainSvg.includes('CHEATSHEET'), 'the badge falls back to the design language');
  check(
    api.renderPng(plain.toDocument(), { scale: 1 }).warnings.length === 0,
    'the unconfigured page renders clean too'
  );
  check(
    plainSvg !== branded.toSVG(),
    'a configured brand actually changes the graphic'
  );

  console.log('');
  console.log(`${checks - failures}/${checks} checks passed`);
  console.log(`graphics: ${show(GRAPHICS)}`);
  console.log(`skill:    ${show(skillDir)}`);
  console.log('');
  console.log(brandModule.brandInstructions(brand));
  console.log('');
  console.log('To point this at your own brand instead, edit the GLOBAL_ASSETS line in');
  console.log(`${show(RESOURCES)} - or, in your own project, the copy the generator wrote to`);
  console.log(`${show(join(skillDir, 'references', 'resources.md'))}. A folder there is read by file`);
  console.log('name: logo.svg fills the logo slot, footer.png the footer. Nothing else to wire up.');

  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
