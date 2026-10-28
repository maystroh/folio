import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const pdfjsPath = pathToFileURL(
  new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
).href;
const pdfjs = await import(pdfjsPath);

const target = process.argv[2];
const bytes = new Uint8Array(fs.readFileSync(target));
const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
console.log('file', target);
console.log('sizeMB', (bytes.byteLength / 1048576).toFixed(2));
console.log('numPages', doc.numPages);

const pick = [1, 2, 3, 5, 10, 20, Math.floor(doc.numPages / 2), doc.numPages].filter(
  (n, i, all) => n >= 1 && n <= doc.numPages && all.indexOf(n) === i,
);
for (const n of pick) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1, rotation: page.rotate });
  const opList = await page.getOperatorList();
  const text = await page.getTextContent();
  console.log(
    `page ${n}: ${Math.round(vp.width)}x${Math.round(vp.height)} rotate=${page.rotate} ops=${opList.fnArray.length} textItems=${text.items.length}`,
  );
}
await doc.destroy();
