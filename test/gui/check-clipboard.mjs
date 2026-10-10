/**
 * The system clipboard through the main process, both ways.
 *
 * Electron's clipboard is asynchronous, and a read handler that tests the
 * promise it gets back rather than the text it resolves to answers "no SVG"
 * every time - with no error, so pasting a graphic copied in Illustrator or
 * Inkscape just stops working. This writes SVG text the way another editor
 * would put it there, reads it back through each handler, pastes it, and then
 * copies the pasted marks out again to see SVG arrive on the clipboard.
 *
 * The clipboard is the computer's, so whatever text was on it is put back at
 * the end.
 */
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();
const app = launch({ mode: 'new', sketchName: 'clipboard' });

/** A graphic as another editor would copy it: plain SVG text, nothing of napkin's. */
const OUTSIDE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90">' +
  '<rect x="10" y="10" width="60" height="40" fill="#e3442b"/>' +
  '<circle cx="90" cy="60" r="20" fill="#2b6fe3"/>' +
  '</svg>';

let page;
let saved = null;
try {
  page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);

  saved = await page.evalIn('return await window.napkin.readClipboardText();');

  // --- Reading: text written as another editor would ------------------------
  await page.evalIn(`await window.napkin.writeClipboardText(${JSON.stringify(OUTSIDE_SVG)}); return true;`);
  c.eq(
    'the clipboard reads back as the text that was written',
    await page.evalIn('return await window.napkin.readClipboardText();'),
    OUTSIDE_SVG,
  );
  c.eq(
    'SVG text on the clipboard is read as SVG',
    await page.evalIn('return await window.napkin.readClipboardSvg();'),
    OUTSIDE_SVG,
  );

  // --- Pasting it ----------------------------------------------------------
  const marks = () => page.evalIn('return window.napkinCheck.strokeSummary();');
  const before = (await marks()).length;
  await page.chord(86, 'v', 2); // Ctrl+V
  await sleep(800);
  const after = (await marks()).length;
  c.ok('Paste brings the outside graphic in as marks', after > before, `${before} -> ${after}`);

  // --- Writing: an in-app copy goes out as SVG -----------------------------
  await page.evalIn(`await window.napkin.writeClipboardText('plain words'); return true;`);
  c.eq(
    'text that is not SVG is not read as SVG',
    await page.evalIn('return await window.napkin.readClipboardSvg();'),
    null,
  );
  await page.chord(65, 'a', 2); // Ctrl+A
  await sleep(200);
  await page.chord(67, 'c', 2); // Ctrl+C
  await sleep(800);
  const copied = await page.evalIn('return await window.napkin.readClipboardText();');
  c.ok('Copy puts the selection on the clipboard as SVG', /<svg[\s>]/i.test(copied ?? ''), String(copied).slice(0, 60));

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  if (page && typeof saved === 'string') {
    await page.evalIn(`await window.napkin.writeClipboardText(${JSON.stringify(saved)}); return true;`).catch(() => undefined);
  }
  await stop(app);
}
