import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Smoke test for a generated release package: launches the packaged executable
 * (the same binary the installer copies) and verifies that it reads a large PDF
 * with the virtualized reader.
 */
const version = process.argv[2] ?? '1.1.0';
const pdf =
  process.argv[3] ??
  'C:\\Users\\HassanAlhajj\\Desktop\\MyProjects\\BookLibrary\\Inference Engineering.pdf';
const outputDir = path.resolve('tests/output/release', version);
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
const exe = path.resolve(`release/Folio-${version}-Windows/app/FolioApp.exe`);
if (!fs.existsSync(exe)) throw new Error(`Packaged app not found at ${exe}`);

const port = 9557;
const env = {
  ...process.env,
  FOLIO_USER_DATA_DIR: outputDir,
  FOLIO_TEST_MODE: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const logPath = path.join(outputDir, 'app.log');
const log = fs.openSync(logPath, 'w');
const child = spawn(
  exe,
  [
    // Same fallback the shipped launchers use, needed in restricted environments.
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${outputDir}`,
    pdf,
  ],
  {
    cwd: path.dirname(exe),
    env,
    stdio: ['ignore', log, log],
  },
);

let ready = false;
for (let attempt = 0; attempt < 120; attempt += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (res.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 300));
}
if (!ready) {
  child.kill();
  throw new Error('The packaged app did not start (CDP port never opened).');
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
let page = context.pages()[0];
if (!page) page = await context.waitForEvent('page');
const started = Date.now();
await page.waitForFunction(
  () => {
    const canvas = document.querySelector('.pdf-page .page-canvas');
    return canvas && canvas.width > 1;
  },
  undefined,
  { timeout: 60000 },
);
const firstCanvasMs = Date.now() - started;
await page.waitForTimeout(2500);

const result = await page.evaluate(() => {
  const pages = Array.from(document.querySelectorAll('.pdf-page')).map((el) =>
    Number(el.dataset.page),
  );
  return {
    title: document.title,
    pageElements: pages,
    thumbnailElements: document.querySelectorAll('.thumbnail-item').length,
    totalPagesLabel: document.querySelector('.page-count')?.textContent ?? null,
    zoom: document.querySelector('.zoom-value')?.textContent ?? null,
  };
});

await page.locator('.page-number-input').fill('240');
await page.locator('.page-number-input').press('Enter');
await page.waitForTimeout(1200);
const jump = await page.evaluate(() => {
  const scroll = document.querySelector('.viewer-scroll');
  const painted = Array.from(document.querySelectorAll('.pdf-page'))
    .filter((el) => el.getBoundingClientRect().bottom > 0)
    .map((el) => ({ page: Number(el.dataset.page), canvas: el.querySelector('canvas')?.width > 1 }));
  return {
    currentPage: Number(document.querySelector('.page-number-input').value),
    paintedInView: painted,
    mounted: document.querySelectorAll('.pdf-page').length,
    scrollTop: Math.round(scroll.scrollTop),
  };
});
await page.screenshot({ path: path.join(outputDir, 'packaged-app.png') });

const report = { version, exe, firstCanvasMs, ...result, jump };
fs.writeFileSync(path.join(outputDir, 'smoke.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close().catch(() => {});
child.kill();
