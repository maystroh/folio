export type AnnotationKind = 'highlight' | 'ink' | 'note' | 'signature';

export interface PdfPoint {
  x: number;
  y: number;
}

/** A rectangle in unrotated PDF user-space coordinates, with an origin at the lower-left. */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AnnotationBase {
  id: string;
  page: number;
  createdAt: number;
}

export interface HighlightAnnotation extends AnnotationBase {
  kind: 'highlight';
  rects: PdfRect[];
  color: string;
}

export interface InkAnnotation extends AnnotationBase {
  kind: 'ink';
  points: PdfPoint[];
  color: string;
  width: number;
}

export interface NoteAnnotation extends AnnotationBase {
  kind: 'note';
  rect: PdfRect;
  text: string;
  color: string;
}

export interface SignatureAnnotation extends AnnotationBase {
  kind: 'signature';
  rect: PdfRect;
  signatureId: string;
  image: string;
}

export type Annotation = HighlightAnnotation | InkAnnotation | NoteAnnotation | SignatureAnnotation;

export interface SignatureAsset {
  id: string;
  name: string;
  image: string;
  width: number;
  height: number;
  createdAt: number;
}

export interface HighlightColor {
  name: string;
  value: string;
}

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  { name: 'Sunbeam', value: '#f6d365' },
  { name: 'Mint', value: '#8fd6b4' },
  { name: 'Sky', value: '#8ec5ed' },
  { name: 'Rose', value: '#f2a7ae' },
  { name: 'Lilac', value: '#c3b4ef' },
  { name: 'Tangerine', value: '#f3b27c' },
];

export const INK_COLORS = [
  { name: 'Ink', value: '#252525' },
  { name: 'Coral', value: '#d9584b' },
  { name: 'Ocean', value: '#3268a8' },
  { name: 'Moss', value: '#4f7a54' },
  { name: 'Plum', value: '#7d4a78' },
  { name: 'Sand', value: '#a17b3f' },
];

export type AnnotationTool = 'select' | 'highlight' | 'pen' | 'note' | 'signature';

export function isAnnotationInPage(annotation: Annotation, page: number): boolean {
  return annotation.page === page;
}

export function annotationLabel(kind: AnnotationKind): string {
  switch (kind) {
    case 'highlight':
      return 'Highlight';
    case 'ink':
      return 'Drawing';
    case 'note':
      return 'Note';
    case 'signature':
      return 'Signature';
  }
}
