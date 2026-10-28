import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { launchFolio, waitForPdf, assert } from './harness.mjs';
const output = 'tests/output/single-instance';
const app = await launchFolio({ port: 9410, outputDir: output });
const sample = path.resolve('tests/fixtures/sample.pdf');
const userData = path.join(app.outputDir, 'userdata');
try {
  await app.page.locator('.welcome').waitFor();
  const env = { ...process.env, FOLIO_USER_DATA_DIR: userData, FOLIO_TEST_MODE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = path.resolve('node_modules/electron/dist/electron.exe');
  const second = spawn(electron, [
    '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`, '.', sample
  ], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let secondOutput = '';
  second.stdout.on('data', (d) => { secondOutput += d; });
  second.stderr.on('data', (d) => { secondOutput += d; });
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 6000);
    second.on('exit', (code) => { clearTimeout(timer); resolve(true); console.log('second instance exit', code); });
  });
  await waitForPdf(app.page, 4);
  const title = await app.page.locator('.titlebar-filename').innerText();
  console.log('first window file:', title, 'secondExited:', exited);
  assert(exited, 'The second instance should exit after handing the file to the first instance');
  assert(title.includes('sample.pdf'), 'The running window should open the second instance file');
  await app.page.screenshot({ path: path.join(app.outputDir, 'second-instance-opened.png') });
} finally { await app.close(); }
