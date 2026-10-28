import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export async function launchFolio({ port = 9333, outputDir = 'tests/output/e2e', extraEnv = {}, args = [] } = {}) {
  const resolvedOutput = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutput, { recursive: true });
  const userData = path.join(resolvedOutput, 'userdata');
  const cache = path.join(resolvedOutput, 'cache');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(cache, { recursive: true });

  const electronPath = path.resolve('node_modules/electron/dist/electron.exe');
  const env = { ...process.env, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  env.FOLIO_USER_DATA_DIR = userData;
  env.FOLIO_DEBUG_LOG = path.join(resolvedOutput, 'main.log');
  env.FOLIO_TEST_MODE = '1';
  env.FOLIO_TEST_SAVE_DIR = resolvedOutput;
  env.FOLIO_TEST_PRINT = '1';
  env.FOLIO_TEST_PRINT_LOG = path.join(resolvedOutput, 'print.log');
  env.FOLIO_SAVE_DIR = resolvedOutput;

  const child = spawn(
    electronPath,
    [
      '--no-sandbox',
      '--disable-gpu',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userData}`,
      `--disk-cache-dir=${cache}`,
      ...args,
      '.',
    ],
    {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (data) => stdout.push(String(data)));
  child.stderr.on('data', (data) => stderr.push(String(data)));
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  let version = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (exited) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        version = await response.json();
        break;
      }
    } catch {
      // The port is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!version) {
    child.kill();
    throw new Error(
      `Folio did not start.\nSTDOUT:\n${stdout.join('')}\nSTDERR:\n${stderr.join('')}\nLOG:\n${
        fs.existsSync(env.FOLIO_DEBUG_LOG) ? fs.readFileSync(env.FOLIO_DEBUG_LOG, 'utf8') : '(none)'
      }`,
    );
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  let page = context.pages()[0];
  if (!page) page = await context.waitForEvent('page');

  const logs = [];
  page.on('console', (message) => logs.push(`[console:${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));

  return {
    child,
    browser,
    page,
    outputDir: resolvedOutput,
    logs,
    async close() {
      try {
        await browser.close();
      } catch {
        // The app may already be closed.
      }
      if (!child.killed) child.kill();
    },
  };
}

export async function dropFile(page, filePath, fileName = path.basename(filePath)) {
  await page.locator('.app-root').waitFor({ state: 'attached', timeout: 20000 });
  const base64 = fs.readFileSync(filePath).toString('base64');
  await page.evaluate(
    async ({ data, name }) => {
      const binary = atob(data);
      const array = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) array[i] = binary.charCodeAt(i);
      const file = new File([array], name, { type: 'application/pdf' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const target = document.querySelector('.app-root');
      target.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
      target.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
      target.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    },
    { data: base64, name: fileName },
  );
}

export async function waitForPdf(page, expectedPages = 4) {
  await page.waitForFunction(
    (count) => document.querySelectorAll('.pdf-page').length === count,
    expectedPages,
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () => document.querySelectorAll('.thumbnail-item canvas.ready').length > 0,
    undefined,
    { timeout: 20000 },
  );
  await page.waitForTimeout(700);
}

export function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

export async function dragOnPage(page, from, to, steps = 20) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}
