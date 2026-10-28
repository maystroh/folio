import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy };

/**
 * A page's text content only changes when the document changes, so it is worth
 * keeping the extracted layout around while a page scrolls in and out of the
 * rendered window. Weak so the worker data can be collected with the page.
 */
type PageTextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>;
const textContentCache = new WeakMap<PDFPageProxy, Promise<PageTextContent>>();

export function getPageTextContent(page: PDFPageProxy): Promise<PageTextContent> {
  const cached = textContentCache.get(page);
  if (cached) return cached;
  const pending = page.getTextContent();
  textContentCache.set(page, pending);
  pending.catch(() => textContentCache.delete(page));
  return pending;
}

/**
 * Pages are released shortly after they leave the rendered window. PDF.js keeps
 * page proxies for the lifetime of the document, and every rendered page holds
 * its operator list and decoded images; for a thousand-page, image-heavy book
 * that is the difference between a few hundred megabytes and a few gigabytes.
 */
const cleanupTimers = new WeakMap<PDFPageProxy, number>();

export function retainPage(page: PDFPageProxy): void {
  const timer = cleanupTimers.get(page);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    cleanupTimers.delete(page);
  }
}

export function releasePageSoon(page: PDFPageProxy, delay = 1200): void {
  releasePageNow(page);
  const timer = window.setTimeout(() => {
    cleanupTimers.delete(page);
    try {
      page.cleanup();
    } catch {
      // A page that is still rendering simply keeps its resources.
    }
  }, delay);
  cleanupTimers.set(page, timer);
}

function releasePageNow(page: PDFPageProxy): void {
  const timer = cleanupTimers.get(page);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    cleanupTimers.delete(page);
  }
}

/**
 * Keeps a page bitmap under a fixed memory budget instead of letting a page
 * rendered at high zoom allocate tens of megabytes. The browser scales the
 * bitmap up, which is visually indistinguishable for text at print scale.
 */
export function renderPixelRatio(cssWidth: number, cssHeight: number, maxArea = 9_000_000): number {
  const device = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  const width = Math.max(1, cssWidth);
  const height = Math.max(1, cssHeight);
  let ratio = device;
  const area = width * height * ratio * ratio;
  if (area > maxArea) ratio = device * Math.sqrt(maxArea / area);
  const dimensionCap = 4096 / Math.max(width, height);
  return Math.max(0.5, Math.min(ratio, dimensionCap));
}

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
