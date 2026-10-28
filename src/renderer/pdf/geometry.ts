import type { PageViewport } from 'pdfjs-dist';
import type { Annotation, PdfPoint, PdfRect } from '../annotations/types';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RenderedTransform {
  /** CSS transform matrix placed at page-local origin. */
  matrix: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function pdfPointToScreen(viewport: PageViewport, point: PdfPoint): ScreenPoint {
  const [x, y] = viewport.convertToViewportPoint(point.x, point.y);
  return { x, y };
}

export function screenPointToPdf(viewport: PageViewport, point: ScreenPoint): PdfPoint {
  const [x, y] = viewport.convertToPdfPoint(point.x, point.y);
  return { x, y };
}

export function screenRectToPdf(viewport: PageViewport, rect: ScreenRect): PdfRect {
  const a = viewport.convertToPdfPoint(rect.left, rect.top);
  const b = viewport.convertToPdfPoint(rect.left + rect.width, rect.top + rect.height);
  const x1 = Math.min(a[0], b[0]);
  const y1 = Math.min(a[1], b[1]);
  const x2 = Math.max(a[0], b[0]);
  const y2 = Math.max(a[1], b[1]);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function pdfRectToScreenBox(viewport: PageViewport, rect: PdfRect): ScreenBox {
  const points = [
    viewport.convertToViewportPoint(rect.x, rect.y),
    viewport.convertToViewportPoint(rect.x + rect.width, rect.y),
    viewport.convertToViewportPoint(rect.x, rect.y + rect.height),
    viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height),
  ];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    left,
    top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

/**
 * Maps a PDF-space rectangle onto a CSS element with `transform-origin: 0 0`.
 * The returned element must be sized `width` × `height` and left/top at zero.
 */
export function pdfRectToTransform(viewport: PageViewport, rect: PdfRect): RenderedTransform {
  const topLeft = viewport.convertToViewportPoint(rect.x, rect.y + rect.height);
  const topRight = viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height);
  const bottomLeft = viewport.convertToViewportPoint(rect.x, rect.y);
  const width = Math.max(1, Math.hypot(topRight[0] - topLeft[0], topRight[1] - topLeft[1]));
  const height = Math.max(1, Math.hypot(bottomLeft[0] - topLeft[0], bottomLeft[1] - topLeft[1]));
  const a = (topRight[0] - topLeft[0]) / width;
  const b = (topRight[1] - topLeft[1]) / width;
  const c = (bottomLeft[0] - topLeft[0]) / height;
  const d = (bottomLeft[1] - topLeft[1]) / height;
  return {
    left: 0,
    top: 0,
    width,
    height,
    matrix: `matrix(${a}, ${b}, ${c}, ${d}, ${topLeft[0]}, ${topLeft[1]})`,
  };
}

export function normalizedRect(rect: PdfRect): PdfRect {
  const x = rect.width < 0 ? rect.x + rect.width : rect.x;
  const y = rect.height < 0 ? rect.y + rect.height : rect.y;
  return { x, y, width: Math.abs(rect.width), height: Math.abs(rect.height) };
}

export function moveAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  switch (annotation.kind) {
    case 'highlight':
      return {
        ...annotation,
        rects: annotation.rects.map((rect) => ({ ...rect, x: rect.x + dx, y: rect.y + dy })),
      };
    case 'ink':
      return {
        ...annotation,
        points: annotation.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
      };
    case 'note':
    case 'signature':
      return {
        ...annotation,
        rect: { ...annotation.rect, x: annotation.rect.x + dx, y: annotation.rect.y + dy },
      };
  }
}

export function pointerToPageLocal(
  event: { clientX: number; clientY: number },
  pageElement: HTMLElement,
): ScreenPoint {
  const bounds = pageElement.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function pageDisplaySize(
  baseWidth: number,
  baseHeight: number,
  userRotation: number,
): { width: number; height: number } {
  const normalized = ((userRotation % 360) + 360) % 360;
  return normalized === 90 || normalized === 270
    ? { width: baseHeight, height: baseWidth }
    : { width: baseWidth, height: baseHeight };
}

export function annotationColorHex(hex: string, alpha = 1): string {
  const value = hex.replace('#', '');
  const normalized =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value.padEnd(6, '0').slice(0, 6);
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
