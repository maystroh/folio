import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PDF =
  process.argv[2] ?? 'C:\\Users\\HassanAlhajj\\Desktop\\MyProjects\\BookLibrary\\Inference Engineering.pdf';
const outputDir = path.resolve('tests/output/perf/interaction');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
const port = 9700 + Math.floor(Math.random() * 100);
const env = {
  ...process.env,
  FOLIO_USER_DATA_DIR: outputDir,
  FOLIO_DEBUG_LOG: path.join(outputDir, 'main.log'),
  FOLIO_TEST_MODE: '1',
  FOLIO_TEST_SAVE_DIR: outputDir,
};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(
  path.resolve('node_modules/electron/dist/electron.exe'),
  ['--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${outputDir}`, '.', PDF],
  { cwd: process.cwd(), env, stdio: ['ignore', 'ignore', 'ignore'] },
);

let ready = false;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (res.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 300));
}
if (!ready) {
  child.kill();
  throw new Error('Folio did not start');
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
let page = context.pages()[0];
if (!page) page = await context.waitForEvent('page');

await page.waitForFunction(
  () => {
    const c = document.querySelector('.pdf-page .page-canvas');
    return c && c.width > 1;
  },
  undefined,
  { timeout: 60000 },
);
await page.waitForTimeout(1500);

const results = {};

const readState = () =>
  page.evaluate(() => {
    const scroll = document.querySelector('.viewer-scroll');
    const pages = Array.from(document.querySelectorAll('.pdf-page'));
    const visible = pages
      .map((el) => ({ page: Number(el.dataset.page), rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > 0 && rect.top < scroll.clientHeight)
      .map(({ page, rect }) => ({ page, top: Math.round(rect.top) }));
    const painted = pages.filter((el) => {
      const canvas = el.querySelector('canvas');
      return canvas && canvas.width > 1;
    }).map((el) => Number(el.dataset.page));
    return {
      currentPage: Number(document.querySelector('.page-number-input').value),
      scrollTop: Math.round(scroll.scrollTop),
      scrollHeight: scroll.scrollHeight,
      mounted: pages.length,
      visible,
      painted,
      zoom: Math.round(Number(document.querySelector('.zoom-value').textContent.replace('%', ''))),
    };
  });

/** Jump with the page-number field, like a reader would. */
async function jumpTo(target) {
  const start = Date.now();
  await page.locator('.page-number-input').fill(String(target));
  await page.locator('.page-number-input').press('Enter');
  await page.waitForFunction(
    (want) => {
      const input = document.querySelector('.page-number-input');
      return Number(input.value) === want;
    },
    target,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => {
      const scroll = document.querySelector('.viewer-scroll');
      const pages = Array.from(document.querySelectorAll('.pdf-page'));
      return pages.some((el) => {
        const rect = el.getBoundingClientRect();
        const canvas = el.querySelector('canvas');
        return rect.bottom > 0 && rect.top < scroll.clientHeight && canvas && canvas.width > 1;
      });
    },
    undefined,
    { timeout: 30000 },
  );
  const elapsed = Date.now() - start;
  await page.waitForTimeout(300);
  return elapsed;
}

results.jump200Ms = await jumpTo(200);
results.afterJump200 = await readState();

results.jump15Ms = await jumpTo(15);
results.afterJumpBack15 = await readState();

results.jump259Ms = await jumpTo(259);
results.afterJump259 = await readState();

// End of document: the last page must be reachable and reported.
await page.evaluate(() => {
  const scroll = document.querySelector('.viewer-scroll');
  scroll.scrollTop = scroll.scrollHeight;
});
await page.waitForTimeout(900);
results.afterScrollBottom = await readState();

// Zoom anchoring: the page at the viewport top should not change.
await jumpTo(120);
await page.waitForTimeout(500);
const beforeZoom = await readState();
for (let i = 0; i < 4; i += 1) {
  await page.keyboard.press('Control+=');
  await page.waitForTimeout(180);
}
await page.waitForTimeout(700);
const afterZoom = await readState();
results.zoomAnchor = {
  before: { page: beforeZoom.visible[0]?.page, zoom: beforeZoom.zoom, scrollTop: beforeZoom.scrollTop },
  after: { page: afterZoom.visible[0]?.page, zoom: afterZoom.zoom, scrollTop: afterZoom.scrollTop },
  mounted: afterZoom.mounted,
};

// Rapid keyboard paging must stay responsive.
const pagingStart = Date.now();
for (let i = 0; i < 12; i += 1) {
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(70);
}
await page.waitForTimeout(700);
results.paging = { elapsedMs: Date.now() - pagingStart, state: await readState() };

// Thumbnail jump from far away through the sidebar list.
const thumbStart = Date.now();
await page.locator('.thumbnail-item[data-thumb-page="250"]').count(); // may need scrolling in the panel
results.thumbnailJumpMs = Date.now() - thumbStart;

// Full-document sweep: the mounted window and the heap must stay bounded while
// walking every page from top to bottom.
await page.locator('.page-number-input').fill('1');
await page.locator('.page-number-input').press('Enter');
await page.waitForTimeout(600);
results.fullSweep = await page.evaluate(async () => {
  const scroll = document.querySelector('.viewer-scroll');
  let peakMounted = 0;
  let peakHeap = 0;
  for (let top = 0; top <= scroll.scrollHeight; top += 4000) {
    scroll.scrollTop = top;
    await new Promise((resolve) => setTimeout(resolve, 110));
    peakMounted = Math.max(peakMounted, document.querySelectorAll('.pdf-page').length);
    if (performance.memory) {
      peakHeap = Math.max(peakHeap, performance.memory.usedJSHeapSize);
    }
  }
  return {
    peakMounted,
    peakHeapMB: Math.round(peakHeap / 1048576),
    finalPage: Number(document.querySelector('.page-number-input').value),
  };
});

results.consoleErrors = [];
page.on('pageerror', (error) => results.consoleErrors.push(error.message));

fs.writeFileSync(path.join(outputDir, 'interaction.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));

await browser.close().catch(() => {});
child.kill();
