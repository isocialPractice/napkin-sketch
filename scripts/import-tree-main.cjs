/**
 * Electron side of `npm run import-tree` (spawned by import-tree.mjs).
 *
 * Loads the bundled importer into a hidden window - importSvg needs real
 * browser SVG geometry APIs - runs it over the given SVG file, and prints
 * the imported layer tree to stdout.
 *
 *   argv: [electron, this-file, <bundle.js>, <file.svg>]
 */
const { app, BrowserWindow } = require('electron');
const { readFileSync } = require('node:fs');
const { basename } = require('node:path');

const [bundlePath, svgPath] = process.argv.slice(2);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
  let code = 0;
  try {
    await win.loadURL('about:blank');
    await win.webContents.executeJavaScript(readFileSync(bundlePath, 'utf8'));
    const svg = readFileSync(svgPath, 'utf8');
    const name = basename(svgPath).replace(/\.svg$/i, '');
    const tree = await win.webContents.executeJavaScript(`(() => {
      const imported = SvgImport.importSvg(${JSON.stringify(svg)}, { unnamedRootName: ${JSON.stringify(name)} });
      const lines = [];
      const walk = (layers, depth) => {
        for (const l of layers) {
          lines.push('  '.repeat(depth) + l.name + '  [' + l.strokes.length + ' strokes]');
          if (l.children) walk(l.children, depth + 1);
        }
      };
      walk(imported.layers, 0);
      return lines.join('\\n');
    })()`);
    console.log(tree);
  } catch (err) {
    // The parent suppresses stderr (Chromium logs there); report on stdout.
    console.log(`import-tree: ${err instanceof Error ? err.message : String(err)}`);
    code = 1;
  }
  app.exit(code);
});
