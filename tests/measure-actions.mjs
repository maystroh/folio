import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PDF =
  process.argv[2] ?? 'C:\\Users\\HassanAlhajj\\Desktop\\MyProjects\\BookLibrary\\Inference Engineering.pdf';
const label = process.argv[3] ?? 'actions';
const outputDir = path.resolve('tests/output/perf', label);
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
const port = 9500 + Math.floor(Math.random() * 90);
const env = {
  ...process.env,
  FOLIO_USER_DATA_DIR: outputDir,
  FOLIO_TEST_MODE: '1',
  FOLIO_TEST_SAVE_DIR: outputDir,
  FOLIO_TEST_PRINT: '1',
  FOLIO_TEST_PRINT_LOG: path.join(outputDir, 'print.log'),
};
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

await page.addInitScript(() => {
  window.__tasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__tasks.push(Math.round(e.duration));
    }).observe({ type: 'longtask', buffered: false });
  } catch {}
  window.__frames = (ms) =>
    new Promise((resolve) => {
      const deltas = [];
      let last = performance.now();
      const end = last + ms;
      const step = (now) => {
        deltas.push(now - last);
        last = now;
        if (now < end) requestAnimationFrame(step);
        else resolve(deltas);
      };
      requestAnimationFrame(step);
    });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const c = document.querySelector('.pdf-page .page-canvas');
  return c && c.width > 1;
}, undefined, { timeout: 60000 });
await page.waitForTimeout(2000);

const result = {};

// Export annotated PDF (no annotations, still does a full parse + rewrite).
await page.evaluate(() => {
  window.__tasks = [];
});
const exportStart = Date.now();
const framesPromise = page.evaluate(() => window.__frames(9000));
await page.keyboard.press('Control+Shift+E');
await page.waitForSelector('.busy-overlay', { state: 'detached', timeout: 180000 });
result.exportMs = Date.now() - exportStart;
const exportFrames = await framesPromise;
result.exportLongTasks = await page.evaluate(() => window.__tasks.slice());
result.exportSlowFrames = exportFrames.filter((d) => d > 50).length;
result.exportFiles = fs.readdirSync(outputDir).filter((f) => f.endsWith('.pdf') && f !== path.basename(PDF));

// Print preparation of the whole book.
await page.evaluate(() => {
  window.__tasks = [];
});
const printStart = Date.now();
const printFramesPromise = page.evaluate(() => window.__frames(20000));
await page.locator('button[aria-label="Print"]').click();
await page.waitForSelector('.print-overlay', { state: 'detached', timeout: 300000 });
result.printMs = Date.now() - printStart;
const printFrames = await printFramesPromise;
result.printLongTasks = await page.evaluate(() => window.__tasks.slice());
result.printSlowFrames = printFrames.filter((d) => d > 50).length;
result.printInvoked = fs.existsSync(path.join(outputDir, 'print.log'));
result.heapMB = await page.evaluate(() =>
  performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
);

fs.writeFileSync(path.join(outputDir, 'actions.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close().catch(() => {});
child.kill();
