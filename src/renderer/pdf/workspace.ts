import type { Annotation, SignatureAsset } from '../annotations/types';
import type { WorkspaceFile } from './types';

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function createWorkspace(input: {
  fileName: string;
  bytes: Uint8Array;
  annotations: Annotation[];
  signatures: SignatureAsset[];
  view: WorkspaceFile['view'];
}): WorkspaceFile {
  return {
    app: 'Folio',
    version: 1,
    savedAt: new Date().toISOString(),
    fileName: input.fileName,
    pdfBase64: bytesToBase64(input.bytes),
    annotations: input.annotations,
    signatures: input.signatures,
    view: input.view,
  };
}

export function parseWorkspace(text: string): WorkspaceFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This Folio workspace is not valid JSON.');
  }
  if (!isRecord(parsed) || parsed.app !== 'Folio' || parsed.version !== 1) {
    throw new Error('This file is not a supported Folio workspace.');
  }
  if (typeof parsed.pdfBase64 !== 'string' || parsed.pdfBase64.length === 0) {
    throw new Error('This Folio workspace is missing its PDF document.');
  }
  const annotations = Array.isArray(parsed.annotations)
    ? parsed.annotations.filter(isAnnotation)
    : [];
  const signatures = Array.isArray(parsed.signatures)
    ? parsed.signatures.filter(isSignatureAsset)
    : [];
  const view = isRecord(parsed.view) ? parsed.view : {};
  return {
    app: 'Folio',
    version: 1,
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    fileName: typeof parsed.fileName === 'string' ? parsed.fileName : 'Untitled.pdf',
    pdfBase64: parsed.pdfBase64,
    annotations,
    signatures,
    view: {
      page: numberOr(view.page, 1),
      zoom: numberOr(view.zoom, 1),
      zoomMode: view.zoomMode === 'fit-page' ? 'fit-page' : 'custom',
      rotation: numberOr(view.rotation, 0),
      sidebarOpen: view.sidebarOpen !== false,
      sidebarTab: view.sidebarTab === 'outline' ? 'outline' : 'thumbnails',
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRect(value: unknown): boolean {
  return (
    isRecord(value) &&
    ['x', 'y', 'width', 'height'].every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key] as number),
    )
  );
}

function isAnnotation(value: unknown): value is Annotation {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.page !== 'number') {
    return false;
  }
  if (value.kind === 'highlight') {
    return (
      Array.isArray(value.rects) &&
      value.rects.length > 0 &&
      value.rects.every(isRect) &&
      typeof value.color === 'string'
    );
  }
  if (value.kind === 'ink') {
    return (
      Array.isArray(value.points) &&
      value.points.length > 0 &&
      value.points.every(
        (point) =>
          isRecord(point) &&
          typeof point.x === 'number' &&
          typeof point.y === 'number',
      ) &&
      typeof value.color === 'string' &&
      typeof value.width === 'number'
    );
  }
  if (value.kind === 'note') {
    return isRect(value.rect) && typeof value.text === 'string' && typeof value.color === 'string';
  }
  if (value.kind === 'signature') {
    return (
      isRect(value.rect) &&
      typeof value.signatureId === 'string' &&
      typeof value.image === 'string'
    );
  }
  return false;
}

function isSignatureAsset(value: unknown): value is SignatureAsset {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.image === 'string' &&
    value.image.startsWith('data:image/') &&
    typeof value.width === 'number' &&
    typeof value.height === 'number'
  );
}

export function baseName(fileName: string): string {
  return fileName.replace(/\.(pdf|folio)$/i, '') || 'Document';
}
