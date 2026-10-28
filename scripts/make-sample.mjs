import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, PDFName, PDFHexString, PDFNull } from 'pdf-lib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tests', 'fixtures');
fs.mkdirSync(outDir, { recursive: true });

const doc = await PDFDocument.create();
doc.setTitle('The Quiet Craft of Reading');
doc.setAuthor('Folio');
const font = await doc.embedFont(StandardFonts.Helvetica);
const serif = await doc.embedFont(StandardFonts.TimesRoman);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

const cream = rgb(0.973, 0.957, 0.925);
const ink = rgb(0.145, 0.137, 0.118);
const muted = rgb(0.43, 0.41, 0.36);
const rust = rgb(0.69, 0.29, 0.2);

const chapters = [
  {
    kicker: 'CHAPTER ONE',
    title: 'A quieter attention',
    body: [
      'There is a particular kind of quiet that arrives when a page asks',
      'nothing of you but attention. The room does not need to be silent;',
      'the phone can stay in your pocket. Reading begins when the world',
      'narrows to the width of a margin.',
      '',
      'A good reader is not in a hurry. They let a sentence finish its work',
      'before moving to the next. They notice the small hinge of a paragraph.',
      'They are willing to read the same line twice, not because it was',
      'difficult, but because it was good.',
      '',
      'This sample document exists to be marked up. Highlight a line, draw',
      'in the margin, leave a note for later. The page can hold your thinking',
      'without becoming noisy.',
    ],
  },
  {
    kicker: 'CHAPTER TWO',
    title: 'Tools that stay out of the way',
    body: [
      'An annotation is a conversation with a text. It should be easy to',
      'start and easy to revise. A highlight says: this mattered. A line in',
      'the margin says: I was here, thinking. A note says: come back.',
      '',
      'Good tools make these gestures feel direct. There is no mode to',
      'memorize, no dialog between the thought and the mark. The page',
      'receives the mark where you made it, at every zoom level and in',
      'every orientation.',
      '',
      'When the work is done, the marks travel with the document. They',
      'remain legible in an ordinary PDF reader, not trapped inside one',
      'particular application.',
    ],
  },
  {
    kicker: 'CHAPTER THREE',
    title: 'A room with warm light',
    body: [
      'Reading is physical. Paper has a temperature, a weight, a sound at',
      'the corner. A digital reader does not need to imitate paper, but it',
      'can learn from the way paper behaves: calm, still, and generous with',
      'space.',
      '',
      'In daylight, Folio is a warm sheet on a wooden desk. At night, it',
      'becomes a dark room with a lit page: the interface recedes and the',
      'words remain. Neither mode should call attention to itself.',
      '',
      'Comfort is not decoration. It is the absence of friction between',
      'the reader and the thing being read.',
    ],
  },
  {
    kicker: 'CHAPTER FOUR',
    title: 'The mark and the memory',
    body: [
      'We annotate because reading is not passive. A book read well is a',
      'book with a few scars: a folded corner, a pencil line, a question in',
      'the margin. The marks are a record of where our attention went.',
      '',
      'Save the page, keep the marks, and the document becomes a place',
      'you can return to. Export it, and the conversation can continue',
      'elsewhere.',
      '',
      'The best reading tools disappear. What remains is the text, the',
      'quiet, and the small evidence that you were thinking.',
    ],
  },
];

const pageRefs = [];
for (let index = 0; index < chapters.length; index += 1) {
  const chapter = chapters[index];
  const page = doc.addPage([612, 792]);
  pageRefs.push(page.ref);

  page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: cream });
  page.drawRectangle({ x: 54, y: 742, width: 504, height: 1, color: rgb(0.82, 0.79, 0.72) });
  page.drawText('FOLIO / A READING SAMPLE', {
    x: 54,
    y: 756,
    size: 8,
    font,
    color: muted,
    characterSpacing: 1.2,
  });
  page.drawText(chapter.kicker, {
    x: 54,
    y: 680,
    size: 9,
    font: bold,
    color: rust,
    characterSpacing: 2,
  });
  page.drawText(chapter.title, { x: 54, y: 628, size: 30, font: serif, color: ink });
  page.drawRectangle({ x: 54, y: 602, width: 42, height: 2, color: rust });

  let y = 552;
  for (const line of chapter.body) {
    if (line) {
      page.drawText(line, { x: 54, y, size: 13, font: serif, color: ink, lineHeight: 21 });
    }
    y -= 21;
  }

  page.drawText(`${index + 1}`, {
    x: 558,
    y: 54,
    size: 9,
    font,
    color: muted,
  });
  page.drawText('FOLIO', { x: 54, y: 54, size: 8, font: bold, color: muted, characterSpacing: 1.4 });
}

// Build a real PDF outline using low-level objects so the TOC can be tested.
const outlinesRef = doc.context.nextRef();
const items = chapters.map((chapter, index) =>
  doc.context.nextRef(),
);
doc.context.assign(
  outlinesRef,
  doc.context.obj({
    Type: 'Outlines',
    First: items[0],
    Last: items[items.length - 1],
    Count: items.length,
  }),
);
chapters.forEach((chapter, index) => {
  const item = {
    Title: PDFHexString.fromText(chapter.title),
    Parent: outlinesRef,
    Dest: [pageRefs[index], PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull],
  };
  if (index > 0) item.Prev = items[index - 1];
  if (index < items.length - 1) item.Next = items[index + 1];
  doc.context.assign(items[index], doc.context.obj(item));
});
doc.catalog.set(PDFName.of('Outlines'), outlinesRef);

const bytes = await doc.save();
fs.writeFileSync(path.join(outDir, 'sample.pdf'), bytes);
console.log(`Wrote ${path.join(outDir, 'sample.pdf')} (${bytes.length} bytes)`);
