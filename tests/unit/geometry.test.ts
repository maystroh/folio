import { describe, expect, it } from 'vitest';
import type { PageViewport } from 'pdfjs-dist';
import {
  pageDisplaySize,
  pdfRectToScreenBox,
  pdfRectToTransform,
  screenPointToPdf,
  screenRectToPdf,
} from '../../src/renderer/pdf/geometry';
import type { PdfRect } from '../../src/renderer/annotations/types';

class FakeViewport {
  scale = 1;
  rotation = 0;
  width = 0;
  height = 0;
  constructor(public pageWidth: number, public pageHeight: number, rotation = 0, scale = 1) {
    this.scale = scale;
    this.rotation = rotation;
    if (rotation === 90 || rotation === 270) {
      this.width = pageHeight * scale;
      this.height = pageWidth * scale;
    } else {
      this.width = pageWidth * scale;
      this.height = pageHeight * scale;
    }
  }

  convertToViewportPoint(x: number, y: number): [number, number] {
    if (this.rotation === 90) return [y * this.scale, x * this.scale];
    if (this.rotation === 270) {
      return [(this.pageHeight - y) * this.scale, (this.pageWidth - x) * this.scale];
    }
    return [x * this.scale, (this.pageHeight - y) * this.scale];
  }

  convertToPdfPoint(x: number, y: number): [number, number] {
    if (this.rotation === 90) return [y / this.scale, x / this.scale];
    if (this.rotation === 270) {
      return [this.pageWidth - x / this.scale, this.pageHeight - y / this.scale];
    }
    return [x / this.scale, this.pageHeight - y / this.scale];
  }
}

const viewport0 = new FakeViewport(612, 792) as unknown as PageViewport;
const viewport90 = new FakeViewport(612, 792, 90) as unknown as PageViewport;

describe('PDF coordinate geometry', () => {
  it('maps a screen rectangle to unrotated PDF coordinates', () => {
    const rect = screenRectToPdf(viewport0, { left: 54, top: 100, width: 100, height: 20 });
    expect(rect.x).toBeCloseTo(54);
    expect(rect.y).toBeCloseTo(672);
    expect(rect.width).toBeCloseTo(100);
    expect(rect.height).toBeCloseTo(20);
  });

  it('maps a screen rectangle through a 90 degree viewport rotation', () => {
    const rect = screenRectToPdf(viewport90, { left: 54, top: 700, width: 100, height: 20 });
    expect(rect.x).toBeCloseTo(700);
    expect(rect.y).toBeCloseTo(54);
    expect(rect.width).toBeCloseTo(20);
    expect(rect.height).toBeCloseTo(100);
  });

  it('round-trips PDF rectangles to screen boxes', () => {
    const source: PdfRect = { x: 100, y: 200, width: 150, height: 40 };
    const box = pdfRectToScreenBox(viewport0, source);
    const roundTripped = screenRectToPdf(viewport0, box);
    expect(roundTripped.x).toBeCloseTo(source.x);
    expect(roundTripped.y).toBeCloseTo(source.y);
    expect(roundTripped.width).toBeCloseTo(source.width);
    expect(roundTripped.height).toBeCloseTo(source.height);
  });

  it('creates a rotation-aware affine transform for notes and signatures', () => {
    const transform = pdfRectToTransform(viewport90, {
      x: 100,
      y: 200,
      width: 150,
      height: 40,
    });
    expect(transform.width).toBeCloseTo(150);
    expect(transform.height).toBeCloseTo(40);
    const matrix = transform.matrix.match(/matrix\(([^)]+)\)/)?.[1].split(',').map(Number);
    expect(matrix).toBeTruthy();
    expect(matrix?.[0]).toBeCloseTo(0);
    expect(matrix?.[1]).toBeCloseTo(1);
    expect(matrix?.[2]).toBeCloseTo(-1);
    expect(matrix?.[3]).toBeCloseTo(0);
  });

  it('converts a screen point through rotation', () => {
    const point = screenPointToPdf(viewport90, { x: 54, y: 700 });
    expect(point.x).toBeCloseTo(700);
    expect(point.y).toBeCloseTo(54);
  });

  it('swaps display dimensions for a quarter turn', () => {
    expect(pageDisplaySize(612, 792, 0)).toEqual({ width: 612, height: 792 });
    expect(pageDisplaySize(612, 792, 90)).toEqual({ width: 792, height: 612 });
    expect(pageDisplaySize(612, 792, 180)).toEqual({ width: 612, height: 792 });
    expect(pageDisplaySize(612, 792, 270)).toEqual({ width: 792, height: 612 });
  });
});
