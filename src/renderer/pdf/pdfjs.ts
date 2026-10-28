import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type { PDFDocumentProxy };

export interface LoadedPdf {
  pdf: PDFDocumentProxy;
  pageCount: number;
  title: string;
}

export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  // PDF.js transfers the supplied buffer to its worker. Keep the caller's copy intact.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const task = pdfjs.getDocument({
    data: copy,
    standardFontDataUrl: './pdf-assets/standard_fonts/',
    cMapUrl: './pdf-assets/cmaps/',
    cMapPacked: true,
    enableXfa: true,
  });

  try {
    const pdf = await task.promise;
    let title = '';
    try {
      const metadata = await pdf.getMetadata();
      const infoTitle = (metadata.info as { Title?: unknown } | undefined)?.Title;
      if (typeof infoTitle === 'string') title = infoTitle.trim();
    } catch {
      // Missing metadata is normal and should never prevent reading.
    }
    return { pdf, pageCount: pdf.numPages, title };
  } catch (error) {
    await task.destroy().catch(() => undefined);
    throw normalizePdfError(error);
  }
}

export function normalizePdfError(error: unknown): Error {
  const raw = error as { name?: string; message?: string } | undefined;
  if (raw?.name === 'PasswordException') {
    return new Error('This PDF is password protected. Folio can only open unlocked PDFs.');
  }
  if (raw?.name === 'InvalidPDFException') {
    return new Error('That file is not a valid PDF, or it may be damaged.');
  }
  if (raw?.name === 'MissingPDFException') {
    return new Error('The PDF file could not be found.');
  }
  return new Error(raw?.message || 'The PDF could not be opened.');
}

export async function renderPageToCanvas(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation: number,
  maxPixelRatio = 2,
): Promise<void> {
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate });
  const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), maxPixelRatio);
  const viewport = page.getViewport({ scale: scale * pixelRatio, rotation: page.rotate + rotation });
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas rendering is unavailable.');

  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  canvas.style.width = `${baseViewport.width * scale}px`;
  canvas.style.height = `${baseViewport.height * scale}px`;

  const renderTask = page.render({ canvasContext: context, viewport });
  await renderTask.promise;
}

export async function renderThumbnail(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  maxWidth: number,
  maxHeight: number,
): Promise<void> {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1, rotation: page.rotate });
  const scale = Math.min(maxWidth / base.width, maxHeight / base.height);
  const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  const viewport = page.getViewport({ scale: scale * pixelRatio, rotation: page.rotate });
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return;
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  canvas.style.aspectRatio = `${base.width} / ${base.height}`;
  await page.render({ canvasContext: context, viewport }).promise;
}
