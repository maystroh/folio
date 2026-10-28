import fs from 'node:fs';
import path from 'node:path';
import { launchFolio, dropFile, waitForPdf, dragOnPage } from './harness.mjs';

const outputDir = path.resolve('tests/output/docs-shots');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(path.resolve('docs'), { recursive: true });

const app = await launchFolio({ port: 9397, outputDir });
const { page } = app;
try {
  await page.locator('.welcome').waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.resolve('docs/folio-welcome.png') });

  await dropFile(page, path.resolve('tests/fixtures/sample.pdf'));
  await waitForPdf(page, 4);
  await page.waitForTimeout(500);

  await page.locator('.tool-button').filter({ hasText: 'Highlight' }).click();
  const firstLine = page
    .locator('.pdf-page[data-page="1"] .text-layer span')
    .filter({ hasText: 'There is a particular kind' })
    .first();
  const firstBox = await firstLine.boundingBox();
  await dragOnPage(
    page,
    { x: firstBox.x + 2, y: firstBox.y + firstBox.height / 2 },
    { x: firstBox.x + firstBox.width - 2, y: firstBox.y + firstBox.height / 2 },
    12,
  );
  const secondLine = page
    .locator('.pdf-page[data-page="1"] .text-layer span')
    .filter({ hasText: 'A good reader is not in a hurry' })
    .first();
  const secondBox = await secondLine.boundingBox();
  await dragOnPage(
    page,
    { x: secondBox.x + 2, y: secondBox.y + secondBox.height / 2 },
    { x: secondBox.x + secondBox.width - 2, y: secondBox.y + secondBox.height / 2 },
    12,
  );

  const pageBox = await page.locator('.pdf-page[data-page="1"]').boundingBox();
  await page.locator('.tool-button').filter({ hasText: 'Note' }).click();
  await page.mouse.click(pageBox.x + pageBox.width * 0.66, pageBox.y + pageBox.height * 0.82);
  await page.locator('.note-textarea').fill('A quiet place to come back to.');
  await page.locator('.note-modal').getByRole('button', { name: 'Save note' }).click();
  await page.waitForTimeout(300);

  await page.locator('.tool-button').filter({ hasText: 'Sign' }).click();
  await page.locator('.signature-modal').waitFor();
  const pad = await page.locator('.signature-pad').boundingBox();
  await page.mouse.move(pad.x + 80, pad.y + 120);
  await page.mouse.down();
  for (let index = 0; index <= 30; index += 1) {
    const t = index / 30;
    await page.mouse.move(
      pad.x + 80 + t * 300,
      pad.y + 120 - Math.sin(t * Math.PI * 2.2) * 30 - t * 10,
    );
  }
  await page.mouse.up();
  await page.getByRole('button', { name: 'Use this signature' }).click();
  await page.waitForTimeout(400);
  await page.mouse.click(pageBox.x + pageBox.width * 0.27, pageBox.y + pageBox.height * 0.87);
  await page.waitForTimeout(5200);

  await page.locator('.tool-button').filter({ hasText: 'Select' }).click();
  await page.mouse.click(pageBox.x + 12, pageBox.y + 12);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.resolve('docs/folio-light.png') });

  await page.locator('button[aria-label="Switch to dark reading mode"]').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.resolve('docs/folio-dark.png') });
  console.log('Documentation screenshots written.');
} finally {
  await app.close();
}
