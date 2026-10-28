import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PDF = path.resolve('tests/fixtures/sample.pdf');
const outputDir = path.resolve('tests/output/perf/textlayer');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
const port = 9600 + Math.floor(Math.random() * 90);
const env = { ...process.env, FOLIO_USER_DATA_DIR: outputDir, FOLIO_TEST_MODE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  path.resolve('node_modules/electron/dist/electron.exe'),
  ['--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${outputDir}`, '.', PDF],
  { cwd: process.cwd(), env, stdio: ['ignore', 'ignore', 'ignore'] },
);
for (let i = 0; i < 100; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (res.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 300));
}
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
let page = context.pages()[0];
if (!page) page = await context.waitForEvent('page');
await page.waitForFunction(
  () => document.querySelectorAll('.pdf-page .text-layer span').length > 3,
  undefined,
  { timeout: 60000 },
);
await page.waitForTimeout(1500);

async function selectLinesAndHighlight() {
  await page.keyboard.press('h');
  const info = await page.evaluate(() => {
    const pageEl = document.querySelector('.pdf-page[data-page="1"]');
    const spans = Array.from(pageEl.querySelectorAll('.text-layer span')).filter(
      (span) => (span.textContent ?? '').trim().length > 1,
    );
    const range = document.createRange();
    range.setStart(spans[0].firstChild, 0);
    const last = spans[Math.min(5, spans.length - 1)];
    range.setEnd(last.firstChild, (last.textContent ?? '').length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const rects = Array.from(range.getClientRects()).map((rect) => ({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }));
    pageEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { rects, text: selection.toString().slice(0, 60) };
  });
  await page.waitForTimeout(900);
  const marks = await page.evaluate(() => {
    const pageEl = document.querySelector('.pdf-page[data-page="1"]');
    return Array.from(pageEl.querySelectorAll('.highlight-mark')).map((mark) => {
      const rect = mark.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });
  });
  const zoom = await page.locator('.zoom-value').innerText();
  const box = await page.locator('.pdf-page[data-page="1"]').boundingBox();
  return { zoom, selectionRects: info.rects, text: info.text, marks, box };
}

const fit = await selectLinesAndHighlight();
await page.screenshot({
  path: path.join(outputDir, 'highlight-fit.png'),
  clip: { x: fit.box.x, y: Math.max(0, fit.box.y), width: fit.box.width, height: Math.min(700, fit.box.height) },
});

retry: {
  for (let i = 0; i < 6; i += 1) {
    await page.locator('button[aria-label="Zoom in"]').click();
    await page.waitForTimeout(80);
  }
}
await page.waitForTimeout(900);
const zoomed = await selectLinesAndHighlight();
await page.screenshot({
  path: path.join(outputDir, 'highlight-zoomed.png'),
  clip: {
    x: Math.max(0, zoomed.box.x),
    y: Math.max(0, zoomed.box.y),
    width: zoomed.box.width,
    height: Math.min(700, zoomed.box.height),
  },
});

const report = { fit, zoomed };
fs.writeFileSync(path.join(outputDir, 'textlayer.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close().catch(() => {});
child.kill();
