import {
  BlendMode,
  degrees,
  LineCapStyle,
  PDFDocument,
  rgb,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type { Annotation, NoteAnnotation, PdfRect } from '../annotations/types';
import { base64ToBytes } from '../pdf/workspace';

export interface ExportOptions {
  bytes: Uint8Array;
  annotations: Annotation[];
  userRotation: number;
  onProgress?: (current: number, total: number) => void;
}

function hexToRgb(hex: string) {
  const value = hex.replace('#', '');
  const normalized =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value.padEnd(6, '0').slice(0, 6);
  return rgb(
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255,
  );
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('A signature image could not be decoded.');
  return base64ToBytes(match[2]);
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Rasterize a note with the user's own system fonts. This keeps the exported
 * note visually identical to the on-screen card and handles every script the
 * operating system can display.
 */
function noteToPng(note: NoteAnnotation): string {
  const scale = 4;
  const width = Math.max(70, Math.round(note.rect.width * scale));
  const height = Math.max(42, Math.round(note.rect.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The note could not be prepared for export.');

  context.fillStyle = note.color || '#f5e29a';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = 'rgba(112, 85, 24, 0.35)';
  context.lineWidth = Math.max(1, 0.8 * scale);
  context.strokeRect(0.5, 0.5, width - 1, height - 1);

  const fold = 14 * scale;
  context.fillStyle = 'rgba(103, 78, 19, 0.24)';
  context.beginPath();
  context.moveTo(width - fold, 0);
  context.lineTo(width, fold);
  context.lineTo(width, 0);
  context.closePath();
  context.fill();

  const padding = 9 * scale;
  const fontSize = 10.5 * scale;
  const lineHeight = 13.2 * scale;
  context.font = `500 ${fontSize}px "Segoe UI", "Microsoft YaHei", "Noto Sans", Arial, sans-serif`;
  context.fillStyle = '#3a2f1a';
  context.textBaseline = 'top';
  const maxWidth = width - padding * 2;
  const lines = wrapCanvasText(context, note.text || 'Note', maxWidth);
  const maxLines = Math.max(1, Math.floor((height - padding * 2) / lineHeight));
  lines.slice(0, maxLines).forEach((line, index) => {
    context.fillText(line, padding, padding + index * lineHeight, maxWidth);
  });

  return canvas.toDataURL('image/png');
}

function drawInk(page: PDFPage, annotation: Extract<Annotation, { kind: 'ink' }>) {
  const color = hexToRgb(annotation.color);
  const points = annotation.points;
  if (points.length === 1) {
    page.drawCircle({
      x: points[0].x,
      y: points[0].y,
      size: Math.max(0.8, annotation.width / 2),
      color,
    });
    return;
  }
  for (let index = 1; index < points.length; index += 1) {
    page.drawLine({
      start: points[index - 1],
      end: points[index],
      thickness: Math.max(0.7, annotation.width),
      color,
      lineCap: LineCapStyle.Round,
    });
  }
}

function rectsForHighlight(annotation: Extract<Annotation, { kind: 'highlight' }>): PdfRect[] {
  return annotation.rects;
}

export async function exportAnnotatedPdf({
  bytes,
  annotations,
  userRotation,
  onProgress,
}: ExportOptions): Promise<Uint8Array> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const raw = error as { message?: string };
    if (/encrypted/i.test(raw.message ?? '')) {
      throw new Error('This PDF is encrypted, so it cannot be exported with annotations.');
    }
    throw new Error('Folio could not prepare this PDF for export.');
  }

  const pages = document.getPages();
  const signatureCache = new Map<string, PDFImage>();
  const noteCache = new Map<string, PDFImage>();

  const ordered = [...annotations].sort((a, b) => {
    const order = { highlight: 0, ink: 1, signature: 2, note: 3 };
    return order[a.kind] - order[b.kind];
  });

  const total = pages.length;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const pageNumber = index + 1;
    const pageAnnotations = ordered.filter((annotation) => annotation.page === pageNumber);
    const baseRotation = page.getRotation().angle;
    if (userRotation !== 0) {
      page.setRotation(degrees((baseRotation + userRotation) % 360));
    }

    if (pageAnnotations.length > 0) {
      for (const annotation of pageAnnotations) {
        if (annotation.kind === 'highlight') {
          for (const rect of rectsForHighlight(annotation)) {
            page.drawRectangle({
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              color: hexToRgb(annotation.color),
              opacity: 0.34,
              blendMode: BlendMode.Multiply,
            });
          }
        } else if (annotation.kind === 'ink') {
          drawInk(page, annotation);
        } else if (annotation.kind === 'signature') {
          let image = signatureCache.get(annotation.image);
          if (!image) {
            image = await document.embedPng(dataUrlToBytes(annotation.image));
            signatureCache.set(annotation.image, image);
          }
          page.drawImage(image, {
            x: annotation.rect.x,
            y: annotation.rect.y,
            width: annotation.rect.width,
            height: annotation.rect.height,
          });
        } else if (annotation.kind === 'note') {
          let image = noteCache.get(annotation.id);
          if (!image) {
            image = await document.embedPng(dataUrlToBytes(noteToPng(annotation)));
            noteCache.set(annotation.id, image);
          }
          page.drawImage(image, {
            x: annotation.rect.x,
            y: annotation.rect.y,
            width: Math.max(70, annotation.rect.width),
            height: Math.max(42, annotation.rect.height),
          });
        }
      }
    }
    onProgress?.(index + 1, total);
    if (index % 12 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  document.setProducer('Folio');
  document.setCreator('Folio — PDF reader and annotation');
  document.setModificationDate(new Date());
  return document.save();
}
