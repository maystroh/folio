import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  createWorkspace,
  parseWorkspace,
} from '../../src/renderer/pdf/workspace';
import type { Annotation, SignatureAsset } from '../../src/renderer/annotations/types';

const annotations: Annotation[] = [
  {
    id: 'highlight-1',
    kind: 'highlight',
    page: 1,
    rects: [{ x: 50, y: 600, width: 120, height: 14 }],
    color: '#f6d365',
    createdAt: 1,
  },
  {
    id: 'ink-1',
    kind: 'ink',
    page: 2,
    points: [
      { x: 80, y: 80 },
      { x: 120, y: 110 },
    ],
    color: '#3268a8',
    width: 2.4,
    createdAt: 2,
  },
  {
    id: 'note-1',
    kind: 'note',
    page: 1,
    rect: { x: 300, y: 300, width: 178, height: 108 },
    text: 'Remember this.',
    color: '#f5e29a',
    createdAt: 3,
  },
];

const signatures: SignatureAsset[] = [
  {
    id: 'sig-1',
    name: 'Signature 1',
    image: 'data:image/png;base64,AAAA',
    width: 300,
    height: 100,
    createdAt: 4,
  },
];

describe('Folio workspace serialization', () => {
  it('round-trips PDF bytes and annotations', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const workspace = createWorkspace({
      fileName: 'sample.pdf',
      bytes,
      annotations,
      signatures,
      view: {
        page: 2,
        zoom: 1.25,
        zoomMode: 'custom',
        rotation: 90,
        sidebarOpen: false,
        sidebarTab: 'outline',
      },
    });
    const parsed = parseWorkspace(JSON.stringify(workspace));
    expect(Array.from(base64ToBytes(parsed.pdfBase64))).toEqual(Array.from(bytes));
    expect(parsed.annotations).toHaveLength(3);
    expect(parsed.annotations[0]).toMatchObject({ kind: 'highlight', color: '#f6d365' });
    expect(parsed.annotations[1]).toMatchObject({ kind: 'ink', page: 2 });
    expect(parsed.signatures).toHaveLength(1);
    expect(parsed.view).toEqual({
      page: 2,
      zoom: 1.25,
      zoomMode: 'custom',
      rotation: 90,
      sidebarOpen: false,
      sidebarTab: 'outline',
    });
  });

  it('encodes binary data without corrupting it', () => {
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
    const recovered = base64ToBytes(bytesToBase64(bytes));
    expect(recovered.byteLength).toBe(bytes.byteLength);
    expect(recovered[0]).toBe(bytes[0]);
    expect(recovered[65_535]).toBe(bytes[65_535]);
    expect(recovered[99_999]).toBe(bytes[99_999]);
  });

  it('rejects non-Folio files with a clear message', () => {
    expect(() => parseWorkspace('{"hello":"world"}')).toThrow(/not a supported Folio workspace/i);
    expect(() => parseWorkspace('not json')).toThrow(/not valid JSON/i);
  });
});
