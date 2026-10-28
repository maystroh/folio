import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererPublic = path.join(root, 'src', 'renderer', 'public');
const pdfAssets = path.join(rendererPublic, 'pdf-assets');
fs.mkdirSync(pdfAssets, { recursive: true });

for (const name of ['standard_fonts', 'cmaps']) {
  const source = path.join(root, 'node_modules', 'pdfjs-dist', name);
  const target = path.join(pdfAssets, name);
  if (!fs.existsSync(source)) {
    console.warn(`Missing PDF.js asset folder: ${source}`);
    continue;
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  console.log(`Copied PDF.js ${name}`);
}

