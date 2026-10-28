import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { PDFDocument } from 'pdf-lib';
import { launchFolio, dropFile, waitForPdf, assert, dragOnPage } from './harness.mjs';

const outputDir = path.resolve('tests/output/e2e');
fs.rmSync(outputDir, { recursive: true, force: true });
const fixture = path.resolve('tests/fixtures/sample.pdf');
const broken = path.join(outputDir, 'broken.pdf');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(broken, 'This is definitely not a PDF file.');

const app = await launchFolio({
  port: 9350,
  outputDir,
  extraEnv: { FOLIO_TEST_OPEN_FILE: fixture },
});
const { page, child } = app;
let completed = false;

const step = (message) => console.log(`\n• ${message}`);
const screenshot = (name) => page.screenshot({ path: path.join(outputDir, name) });

async function documentId() {
  return page.locator('.app-root').getAttribute('data-document-id');
}

async function waitForDocumentChange(previousId, timeout = 20000) {
  await page.waitForFunction(
    (id) =>
      document.querySelector('.app-root')?.getAttribute('data-document-id') !== id,
    previousId,
    { timeout },
  );
}

async function waitForFile(filePath, timeout = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function normalizedBox(locator, pageLocator) {
  const box = await locator.boundingBox();
  const pageBox = await pageLocator.boundingBox();
  assert(box && pageBox, 'expected layout boxes');
  return {
    x: (box.x - pageBox.x) / pageBox.width,
    y: (box.y - pageBox.y) / pageBox.height,
    width: box.width / pageBox.width,
    height: box.height / pageBox.height,
  };
}

try {
  await page.locator('.welcome').waitFor();
  step('Welcome screen rendered');
  await screenshot('01-welcome.png');

  step('Invalid PDF shows a friendly error');
  await dropFile(page, broken, 'broken.pdf');
  await page.locator('.welcome-error').waitFor({ timeout: 10000 });
  assert((await page.locator('.welcome-error').innerText()).length > 10, 'welcome error text');

  step('Drag and drop loading');
  await dropFile(page, fixture);
  await waitForPdf(page, 4);
  assert((await page.locator('.pdf-page').count()) === 4, 'four pages');
  assert((await page.locator('.thumbnail-item').count()) === 4, 'four thumbnails');
  assert((await page.locator('.welcome').count()) === 0, 'welcome dismissed');
  await screenshot('02-reader.png');

  step('Previous and next page buttons');
  await page.locator('button[aria-label="Next page"]').click();
  await page.waitForTimeout(1100);
  assert((await page.locator('.page-number-input').inputValue()) === '2', 'next page');
  await page.locator('button[aria-label="Previous page"]').click();
  await page.waitForTimeout(1100);
  assert((await page.locator('.page-number-input').inputValue()) === '1', 'previous page');

  step('Table of contents navigation');
  await page.getByRole('tab', { name: 'Contents' }).click();
  await page.locator('.outline-row').first().waitFor();
  assert((await page.locator('.outline-row').count()) === 4, 'four outline entries');
  await page.locator('.outline-row').filter({ hasText: 'A room with warm light' }).click();
  await page.waitForTimeout(1300);
  assert((await page.locator('.page-number-input').inputValue()) === '3', 'outline jumps to page 3');
  await page.getByRole('tab', { name: 'Pages' }).click();
  await page.waitForTimeout(500);
  assert((await page.locator('.thumbnail-item.active .thumbnail-number').innerText()) === '3', 'active thumbnail');
  await page.locator('.thumbnail-item[data-thumb-page="1"]').click();
  await page.waitForTimeout(1300);
  assert((await page.locator('.page-number-input').inputValue()) === '1', 'thumbnail navigates to page 1');

  step('Hide and restore the sidebar');
  await page.locator('.sidebar-toggle').click();
  await page.waitForTimeout(300);
  assert((await page.locator('.sidebar').count()) === 0, 'sidebar hidden');
  await page.locator('.sidebar-toggle').click();
  await page.locator('.sidebar').waitFor();
  assert((await page.locator('.sidebar').count()) === 1, 'sidebar restored');

  step('Zoom and fit page');
  const initialZoom = Number(
    (await page.locator('.zoom-value').innerText()).replace('%', ''),
  );
  await page.locator('button[aria-label="Zoom in"]').click();
  await page.waitForTimeout(500);
  const zoomed = Number((await page.locator('.zoom-value').innerText()).replace('%', ''));
  assert(zoomed > initialZoom, 'zoom in increases zoom');
  await page.locator('button[aria-label="Fit page"]').click();
  await page.waitForTimeout(800);
  const fitted = Number((await page.locator('.zoom-value').innerText()).replace('%', ''));
  assert(Math.abs(fitted - initialZoom) <= 1, 'fit page restores fitted zoom');

  step('Highlight a line and change its color');
  await page.locator('.tool-button').filter({ hasText: 'Highlight' }).click();
  const line = page
    .locator('.pdf-page[data-page="1"] .text-layer span')
    .filter({ hasText: 'There is a particular kind' })
    .first();
  await line.waitFor();
  const lineBox = await line.boundingBox();
  assert(lineBox, 'text line box');
  await dragOnPage(
    page,
    { x: lineBox.x + 2, y: lineBox.y + lineBox.height / 2 },
    { x: lineBox.x + lineBox.width - 2, y: lineBox.y + lineBox.height / 2 },
    16,
  );
  await page.waitForTimeout(500);
  assert((await page.locator('.highlight-mark').count()) >= 1, 'highlight created');
  await page.locator('.tool-button').filter({ hasText: 'Select' }).click();
  await page.locator('.highlight-mark').first().click();
  await page.locator('.selection-inspector').waitFor();
  const swatches = await page.locator('.selection-inspector .swatch').count();
  assert(swatches >= 5, 'multiple highlight colors available');
  await page.locator('.selection-inspector .swatch').nth(2).click();
  const highlightColor = await page
    .locator('.highlight-mark')
    .first()
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--highlight-color').trim());
  assert(highlightColor === '#8ec5ed', 'highlight color changed');
  await page.locator('.selection-inspector button[aria-label="Deselect"]').click();

  step('Draw, select, recolor, and move a freehand stroke');
  await page.locator('.tool-button').filter({ hasText: 'Draw' }).click();
  const pageBox = await page.locator('.pdf-page[data-page="1"]').boundingBox();
  assert(pageBox, 'page box');
  const strokeStart = { x: pageBox.x + 200, y: pageBox.y + pageBox.height - 160 };
  const strokeEnd = { x: strokeStart.x + 190, y: strokeStart.y - 90 };
  await dragOnPage(page, strokeStart, strokeEnd, 24);
  await page.waitForTimeout(400);
  assert((await page.locator('.ink-stroke').count()) === 1, 'ink stroke created');
  const stroke = page.locator('.ink-stroke').first();
  const pathBefore = await stroke.getAttribute('d');
  await page.locator('.tool-button').filter({ hasText: 'Select' }).click();
  const midpoint = {
    x: (strokeStart.x + strokeEnd.x) / 2,
    y: (strokeStart.y + strokeEnd.y) / 2,
  };
  await dragOnPage(page, midpoint, { x: midpoint.x + 55, y: midpoint.y + 35 }, 14);
  await page.waitForTimeout(500);
  const pathAfter = await stroke.getAttribute('d');
  assert(pathBefore !== pathAfter, 'drawing moved');
  assert((await page.locator('.selection-inspector').count()) === 1, 'drawing selected');
  await page.locator('.selection-inspector .swatch').nth(2).click();
  const strokeColor = await stroke.getAttribute('stroke');
  assert(strokeColor === '#3268a8', 'drawing color changed');
  await page.locator('.selection-inspector button[aria-label="Deselect"]').click();

  step('Add, move, and edit a text note');
  await page.locator('.tool-button').filter({ hasText: 'Note' }).click();
  await page.mouse.click(pageBox.x + 360, pageBox.y + 430);
  await page.locator('.note-textarea').fill('A note that travels with the page.');
  await page.locator('.note-modal').getByRole('button', { name: 'Save note' }).click();
  await page.waitForTimeout(400);
  assert((await page.locator('.note-card').count()) === 1, 'note created');
  const note = page.locator('.note-card').first();
  const noteBox = await note.boundingBox();
  assert(noteBox, 'note box');
  await dragOnPage(
    page,
    { x: noteBox.x + noteBox.width / 2, y: noteBox.y + noteBox.height / 2 },
    { x: noteBox.x + noteBox.width / 2 + 40, y: noteBox.y + noteBox.height / 2 - 25 },
    10,
  );
  await page.waitForTimeout(400);
  const movedNoteBox = await note.boundingBox();
  assert(movedNoteBox && movedNoteBox.x !== noteBox.x, 'note moved');
  await page.mouse.dblclick(
    movedNoteBox.x + movedNoteBox.width / 2,
    movedNoteBox.y + movedNoteBox.height / 2,
  );
  await page.locator('.note-textarea').waitFor();
  assert(
    (await page.locator('.note-textarea').inputValue()).includes('travels with the page'),
    'note editor restores text',
  );
  await page.locator('.note-textarea').fill('Edited after moving.');
  await page.locator('.note-modal').getByRole('button', { name: 'Save note' }).click();
  await page.waitForTimeout(300);
  assert((await page.locator('.note-card-text').first().innerText()).includes('Edited after moving'), 'note edited');

  step('Draw a signature and place it');
  await page.locator('.tool-button').filter({ hasText: 'Sign' }).click();
  await page.locator('.signature-modal').waitFor();
  const pad = await page.locator('.signature-pad').boundingBox();
  assert(pad, 'signature pad');
  await dragOnPage(page, { x: pad.x + 80, y: pad.y + 120 }, { x: pad.x + 300, y: pad.y + 90 }, 28);
  await page.getByRole('button', { name: 'Use this signature' }).click();
  await page.waitForTimeout(500);
  assert((await page.locator('.signature-modal').count()) === 0, 'signature dialog closed');
  await page.mouse.click(pageBox.x + pageBox.width * 0.55, pageBox.y + pageBox.height * 0.8);
  await page.waitForTimeout(400);
  assert((await page.locator('.signature-mark').count()) === 1, 'signature placed');

  step('Select, resize, and move the signature');
  await page.locator('.tool-button').filter({ hasText: 'Select' }).click();
  const signature = page.locator('.signature-mark').first();
  await signature.click();
  assert((await page.locator('.resize-handle').count()) === 4, 'resize handles');
  const signatureBefore = await signature.evaluate((el) => ({
    width: el.style.width,
    height: el.style.height,
    transform: el.style.transform,
  }));
  const handle = page.locator('.resize-handle.br').first();
  const handleBox = await handle.boundingBox();
  assert(handleBox, 'resize handle box');
  await dragOnPage(page, { x: handleBox.x + 4, y: handleBox.y + 4 }, { x: handleBox.x + 50, y: handleBox.y + 25 }, 12);
  await page.waitForTimeout(400);
  const signatureResized = await signature.evaluate((el) => ({
    width: el.style.width,
    height: el.style.height,
    transform: el.style.transform,
  }));
  assert(signatureBefore.width !== signatureResized.width, 'signature resized');
  const signatureBox = await signature.boundingBox();
  assert(signatureBox, 'signature box');
  await dragOnPage(
    page,
    { x: signatureBox.x + signatureBox.width / 2, y: signatureBox.y + signatureBox.height / 2 },
    { x: signatureBox.x + signatureBox.width / 2 + 50, y: signatureBox.y + signatureBox.height / 2 - 30 },
    12,
  );
  await page.waitForTimeout(300);
  assert((await signature.evaluate((el) => el.style.transform)) !== signatureResized.transform, 'signature moved');

  step('Reuse the same signature');
  await page.locator('.tool-button').filter({ hasText: 'Sign' }).click();
  await page.mouse.click(pageBox.x + pageBox.width * 0.3, pageBox.y + pageBox.height * 0.72);
  await page.waitForTimeout(400);
  assert((await page.locator('.signature-mark').count()) === 2, 'signature reused');

  step('Upload a signature image');
  await page.locator('button[aria-label="Manage signatures"]').click();
  await page.locator('.signature-modal').waitFor();
  await page.getByRole('tab', { name: 'Upload' }).click();
  const uploadPng = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 520;
    canvas.height = 200;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 520, 200);
    context.strokeStyle = '#20365f';
    context.lineWidth = 7;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(50, 130);
    context.bezierCurveTo(130, 20, 220, 190, 290, 90);
    context.bezierCurveTo(340, 20, 410, 160, 475, 85);
    context.stroke();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'uploaded-signature.png',
    mimeType: 'image/png',
    buffer: Buffer.from(uploadPng, 'base64'),
  });
  await page.locator('.signature-preview').waitFor({ timeout: 10000 });
  await page.getByTitle('Flip horizontally').click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Use this signature' }).click();
  await page.waitForTimeout(400);
  await page.mouse.click(pageBox.x + pageBox.width * 0.35, pageBox.y + pageBox.height * 0.65);
  await page.waitForTimeout(300);
  assert((await page.locator('.signature-mark').count()) === 3, 'uploaded signature placed');

  step('Capture a signature with the camera');
  await page.locator('button[aria-label="Manage signatures"]').click();
  await page.locator('.signature-modal').waitFor();
  await page.getByRole('tab', { name: 'Camera' }).click();
  await page.getByRole('button', { name: 'Capture signature' }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Capture signature' }).click();
  await page.locator('.signature-preview').waitFor({ timeout: 15000 });
  await page.getByTitle('Flip horizontally').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Use this signature' }).click();
  await page.waitForTimeout(400);
  await page.mouse.click(pageBox.x + pageBox.width * 0.7, pageBox.y + pageBox.height * 0.72);
  await page.waitForTimeout(300);
  assert((await page.locator('.signature-mark').count()) === 4, 'camera signature placed');
  await page.locator('button[aria-label="Manage signatures"]').click();
  await page.waitForTimeout(300);
  assert((await page.locator('.signature-list-item').count()) === 3, 'three saved signatures');
  await page.locator('button[aria-label="Close signatures"]').click();

  step('Annotations stay aligned while zooming');
  const pageOne = page.locator('.pdf-page[data-page="1"]');
  const noteBeforeZoom = await normalizedBox(page.locator('.note-card').first(), pageOne);
  await page.locator('button[aria-label="Zoom in"]').click();
  await page.waitForTimeout(900);
  const noteAfterZoom = await normalizedBox(page.locator('.note-card').first(), pageOne);
  assert(Math.abs(noteBeforeZoom.x - noteAfterZoom.x) < 0.01, 'note x stays aligned on zoom');
  assert(Math.abs(noteBeforeZoom.y - noteAfterZoom.y) < 0.01, 'note y stays aligned on zoom');
  await page.locator('button[aria-label="Fit page"]').click();
  await page.waitForTimeout(800);
  await page.locator('.tool-button').filter({ hasText: 'Select' }).click();

  step('Dark reading mode');
  await page.locator('button[aria-label="Switch to dark reading mode"]').click();
  await page.waitForTimeout(700);
  assert((await page.locator('html').getAttribute('data-theme')) === 'dark', 'dark theme active');
  const canvasFilter = await page.locator('.page-canvas').first().evaluate((el) => getComputedStyle(el).filter);
  assert(canvasFilter.includes('invert'), 'PDF page itself is darkened');
  await screenshot('03-dark-reading.png');
  await page.locator('button[aria-label="Switch to light mode"]').click();
  await page.waitForTimeout(400);

  step('Rotate pages clockwise');
  await page.locator('button[aria-label="Rotate page clockwise"]').click();
  await page.waitForTimeout(1100);
  assert((await page.locator('.rotation-label').innerText()).includes('90'), 'rotation applied');
  const rotatedPageBox = await pageOne.boundingBox();
  const firstNormalPage = await page.locator('.pdf-page[data-page="2"]').boundingBox();
  assert(
    rotatedPageBox && firstNormalPage && rotatedPageBox.width > rotatedPageBox.height,
    'page is landscape after rotation',
  );
  assert((await page.locator('.thumbnail-item[data-thumb-page="1"] canvas').count()) === 1, 'thumbnail remains');
  await screenshot('04-rotated.png');

  step('Print');
  const printLog = path.join(outputDir, 'print.log');
  if (fs.existsSync(printLog)) fs.rmSync(printLog);
  await page.locator('button[aria-label="Print"]').click();
  assert(await waitForFile(printLog, 30000), 'print bridge invoked');
  await page.waitForTimeout(800);
  assert((await page.locator('.print-overlay').count()) === 0, 'print progress dismissed');

  step('Save workspace');
  await page.keyboard.press('Control+s');
  const folioPath = path.join(outputDir, 'sample.folio');
  assert(await waitForFile(folioPath), 'workspace saved');
  const workspace = JSON.parse(fs.readFileSync(folioPath, 'utf8'));
  const kinds = workspace.annotations.map((annotation) => annotation.kind);
  assert(kinds.includes('highlight'), 'saved highlight');
  assert(kinds.includes('ink'), 'saved drawing');
  assert(kinds.includes('note'), 'saved note');
  assert(kinds.filter((kind) => kind === 'signature').length === 4, 'saved four signatures');
  assert(workspace.signatures.length === 3, 'saved signature library');
  assert(workspace.view.rotation === 90, 'saved rotation');
  console.log(
    `  workspace: ${workspace.annotations.length} annotations, ${workspace.signatures.length} signatures, ${fs.statSync(folioPath).size} bytes`,
  );

  step('Export annotated PDF');
  await page.keyboard.press('Control+Shift+E');
  const exportPath = path.join(outputDir, 'sample-annotated.pdf');
  assert(await waitForFile(exportPath), 'annotated PDF exported');
  const exported = await PDFDocument.load(fs.readFileSync(exportPath));
  assert(exported.getPageCount() === 4, 'exported PDF has four pages');
  assert(
    exported.getPages().every((exportedPage) => exportedPage.getRotation().angle === 90),
    'exported rotation preserved on every page',
  );
  console.log(`  export: ${fs.statSync(exportPath).size} bytes, 4 pages`);

  step('Restore saved workspace');
  const beforeRestore = await documentId();
  await dropFile(page, folioPath, 'sample.folio');
  await waitForDocumentChange(beforeRestore);
  await waitForPdf(page, 4);
  await page.waitForFunction(
    () => document.querySelectorAll('.signature-mark').length === 4,
    undefined,
    { timeout: 20000 },
  );
  assert((await page.locator('.highlight-mark').count()) >= 1, 'highlight restored');
  assert((await page.locator('.ink-stroke').count()) === 1, 'drawing restored');
  assert((await page.locator('.note-card').count()) === 1, 'note restored');
  assert((await page.locator('.signature-mark').count()) === 4, 'signatures restored');
  assert((await page.locator('.note-card-text').first().innerText()).includes('Edited after moving'), 'note text restored');
  assert((await page.locator('.rotation-label').innerText()).includes('90'), 'rotation restored');
  await screenshot('05-restored.png');

  step('Open through the native file-picker bridge');
  const beforePicker = await documentId();
  await page.locator('.topbar-button').filter({ hasText: 'Open' }).click();
  await waitForDocumentChange(beforePicker);
  await waitForPdf(page, 4);
  await page.waitForTimeout(400);
  assert((await page.title()).startsWith('sample.pdf'), 'file picker opened the PDF');
  assert((await page.locator('.signature-mark').count()) === 0, 'fresh document has no annotations');
  fs.rmSync(folioPath, { force: true });

  step('Warn before opening another document with unsaved changes');
  await page.locator('.pdf-page[data-page="1"]').click({ position: { x: 12, y: 12 } });
  await page.keyboard.press('r');
  await page.waitForTimeout(500);
  await page.locator('.topbar-button').filter({ hasText: 'Open' }).click();
  await page.locator('.confirm-modal').waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  assert((await page.locator('.confirm-modal').count()) === 0, 'open warning dismissed');

  step('Warn before closing and save on close');
  await page.evaluate(() => window.folio.testCloseWindow?.());
  await page.locator('.confirm-modal').waitFor({ timeout: 5000 });
  assert((await page.locator('.confirm-modal').innerText()).includes('Save your changes'), 'close warning');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  assert((await page.locator('.app-root').count()) === 1, 'app stays open after cancel');
  await page.evaluate(() => window.folio.testCloseWindow?.());
  await page.locator('.confirm-modal').waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Save & close' }).click();
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 10000)),
  ]);
  assert(child.exitCode !== null, 'app closed after saving');
  assert(fs.existsSync(folioPath), 'workspace saved on close');
  const closeSaved = JSON.parse(fs.readFileSync(folioPath, 'utf8'));
  assert(closeSaved.view.rotation === 90, 'close saved the current view');

  const pageErrors = app.logs.filter((log) => log.startsWith('[pageerror]'));
  assert(pageErrors.length === 0, `no renderer errors: ${pageErrors.join('; ')}`);
  completed = true;
  console.log('\nAll acceptance checks passed.');
} catch (error) {
  console.error('\nE2E FAILURE:', error);
  console.error('Renderer logs:\n' + app.logs.join('\n'));
  try {
    await page.screenshot({ path: path.join(outputDir, 'failure.png') });
    const logPath = path.join(outputDir, 'main.log');
    if (fs.existsSync(logPath)) console.error('Main log:\n' + fs.readFileSync(logPath, 'utf8'));
  } catch {}
  throw error;
} finally {
  if (!completed) await app.close();
  else {
    try {
      await app.browser.close();
    } catch {}
  }
}
