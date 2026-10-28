import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PDF =
  process.argv[2] ?? 'C:\\Users\\HassanAlhajj\\Desktop\\MyProjects\\BookLibrary\\Inference Engineering.pdf';
const LABEL = process.argv[3] ?? 'run';
const outputDir = path.resolve('tests/output/perf', LABEL);
fs.mkdirSync(outputDir, { recursive: true });
const userData = path.join(outputDir, 'userdata');
const cache = path.join(outputDir, 'cache');
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(cache, { recursive: true });

const port = 9400 + Math.floor(Math.random() * 200);
const env = {
  ...process.env,
  FOLIO_USER_DATA_DIR: userData,
  FOLIO_DEBUG_LOG: path.join(outputDir, 'main.log'),
  FOLIO_TEST_MODE: '1',
  FOLIO_TEST_SAVE_DIR: outputDir,
};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(
  path.resolve('node_modules/electron/dist/electron.exe'),
  [
    '--no-sandbox',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    `--disk-cache-dir=${cache}`,
    '.',
    PDF,
  ],
  { cwd: process.cwd(), env, stdio: ['ignore', 'ignore', 'ignore'] },
);

let version = null;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (res.ok) {
      version = await res.json();
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 300));
}
if (!version) {
  child.kill();
  throw new Error('Folio did not start');
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
let page = context.pages()[0];
if (!page) page = await context.waitForEvent('page');

await page.addInitScript(() => {
  const metrics = { longTasks: [] };
  window.__folioMetrics = metrics;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        metrics.longTasks.push({ start: Math.round(entry.startTime), dur: Math.round(entry.duration) });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  window.__probeFrames = (ms) =>
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

const t0 = Date.now();
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.app-root', { timeout: 30000 });
const domReadyMs = Date.now() - t0;

// Time until every page placeholder is mounted (DOM only) and first canvas painted.
const pageCountMounted = await page
  .waitForFunction(() => document.querySelectorAll('.pdf-page').length, undefined, { timeout: 60000 })
  .then((handle) => handle.jsonValue());
const pagesMountedMs = Date.now() - t0;

const firstCanvasMs = await page
  .waitForFunction(
    () => {
      const c = document.querySelector('.pdf-page .page-canvas');
      return c && c.width > 1 && c.height > 1;
    },
    undefined,
    { timeout: 60000 },
  )
  .then(() => Date.now() - t0);

// Let the open sequence settle (geometry hydration, thumbnails, outline).
await page.waitForTimeout(6000);

const open = await page.evaluate(() => {
  const m = window.__folioMetrics;
  const pages = Array.from(document.querySelectorAll('.pdf-page'));
  const canvases = Array.from(document.querySelectorAll('canvas'));
  const painted = canvases.filter((c) => c.width > 32);
  return {
    domNodes: document.getElementsByTagName('*').length,
    pdfPageElements: pages.length,
    canvasCount: canvases.length,
    paintedCanvasCount: painted.length,
    paintedCanvasPixels: painted.reduce((sum, c) => sum + c.width * c.height, 0),
    thumbnailElements: document.querySelectorAll('.thumbnail-item').length,
    thumbnailPainted: document.querySelectorAll('.thumbnail-canvas.ready').length,
    textLayerSpans: document.querySelectorAll('.text-layer span').length,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    longTasks: m.longTasks.length,
    longTaskTotalMs: m.longTasks.reduce((s, t) => s + t.dur, 0),
    longTasksOver100: m.longTasks.filter((t) => t.dur >= 100).length,
    worstLongTaskMs: m.longTasks.reduce((s, t) => Math.max(s, t.dur), 0),
    longTaskList: m.longTasks.slice(0, 40),
  };
});

// --- scroll probe: continuous wheel-scroll through the document ------------
async function scrollProbe(label, steps, deltaY) {
  await page.evaluate(() => {
    window.__folioMetrics.longTasks.length = 0;
    const scroller = document.querySelector('.viewer-scroll');
    scroller.scrollTop = 0;
  });
  await page.waitForTimeout(400);
  const framesPromise = page.evaluate((ms) => window.__probeFrames(ms), steps * 60 + 400);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(16);
  }
  const deltas = await framesPromise;
  const result = await page.evaluate(() => {
    const m = window.__folioMetrics;
    return {
      longTasks: m.longTasks.length,
      longTaskTotalMs: m.longTasks.reduce((s, t) => s + t.dur, 0),
      worstLongTaskMs: m.longTasks.reduce((s, t) => Math.max(s, t.dur), 0),
      currentPage: document.querySelector('.toolbar') ? null : null,
    };
  });
  const sorted = [...deltas].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const result2 = {
    label,
    frames: deltas.length,
    avgFrameMs: +(deltas.reduce((s, d) => s + d, 0) / deltas.length).toFixed(1),
    p95FrameMs: +p95.toFixed(1),
    worstFrameMs: +Math.max(...deltas).toFixed(1),
    framesOver50: deltas.filter((d) => d > 50).length,
    ...result,
  };
  result2.worstLongTaskMs = Math.round(result2.worstLongTaskMs);
  result2.longTaskTotalMs = Math.round(result2.longTaskTotalMs);
  const pageNow = await page.evaluate(() => {
    const el = document.elementFromPoint(600, 400);
    return el?.closest('.pdf-page')?.getAttribute('data-page') ?? null;
  });
  result2.visiblePageAfter = pageNow;
  return result2;
}

const scroll = await scrollProbe('scroll', 120, 240);

// --- zoom probe -----------------------------------------------------------
await page.evaluate(() => {
  window.__folioMetrics.longTasks.length = 0;
});
await page.evaluate(() => {
  document.querySelector('.viewer-scroll').scrollTop = 0;
});
await page.waitForTimeout(400);
const zoomFramesPromise = page.evaluate(() => window.__probeFrames(2600));
const zoomStart = Date.now();
for (let i = 0; i < 8; i += 1) {
  await page.keyboard.press('Control+=');
  await page.waitForTimeout(140);
}
const zoomDeltas = await zoomFramesPromise;
const zoomMs = Date.now() - zoomStart;
await page.waitForTimeout(1200);
const zoom = await page.evaluate(() => {
  const m = window.__folioMetrics;
  return {
    longTasks: m.longTasks.length,
    longTaskTotalMs: Math.round(m.longTasks.reduce((s, t) => s + t.dur, 0)),
    worstLongTaskMs: Math.round(m.longTasks.reduce((s, t) => Math.max(s, t.dur), 0)),
    paintedCanvasPixels: Array.from(document.querySelectorAll('canvas'))
      .filter((c) => c.width > 32)
      .reduce((sum, c) => sum + c.width * c.height, 0),
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
  };
});
zoom.durationMs = zoomMs;
zoom.framesOver50 = zoomDeltas.filter((d) => d > 50).length;
zoom.avgFrameMs = +(zoomDeltas.reduce((s, d) => s + d, 0) / zoomDeltas.length).toFixed(1);
zoom.worstFrameMs = +Math.max(...zoomDeltas).toFixed(1);

// --- save probe -----------------------------------------------------------
await page.evaluate(() => {
  window.__folioMetrics.longTasks.length = 0;
});
const saveStart = Date.now();
await page.keyboard.press('Control+s');
let saveMs = null;
try {
  await page.waitForSelector('.busy-overlay', { state: 'detached', timeout: 60000 });
  saveMs = Date.now() - saveStart;
} catch {
  saveMs = -1;
}
const saveLongTasks = await page.evaluate(() => {
  const m = window.__folioMetrics;
  return {
    count: m.longTasks.length,
    totalMs: Math.round(m.longTasks.reduce((s, t) => s + t.dur, 0)),
    worstMs: Math.round(m.longTasks.reduce((s, t) => Math.max(s, t.dur), 0)),
  };
});
const folios = fs.readdirSync(outputDir).filter((f) => f.endsWith('.folio'));
const folioSize = folios.length ? fs.statSync(path.join(outputDir, folios[0])).size : 0;

const report = {
  label: LABEL,
  pdf: PDF,
  domReadyMs,
  pagesMountedMs,
  pageCountMounted,
  firstCanvasMs,
  open,
  scroll,
  zoom,
  save: { ms: saveMs, ...saveLongTasks, folioBytes: folioSize },
  logs: [],
};
fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close().catch(() => {});
child.kill();
