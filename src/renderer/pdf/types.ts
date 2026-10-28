export interface OutlineEntry {
  id: string;
  title: string;
  pageNumber: number;
  depth: number;
  bold: boolean;
  italic: boolean;
  children: OutlineEntry[];
}

export interface PageSize {
  width: number;
  height: number;
}

export interface DocumentBytes {
  bytes: Uint8Array;
  fileName: string;
  filePath: string | null;
}

export interface WorkspaceFile {
  app: 'Folio';
  version: 1;
  savedAt: string;
  fileName: string;
  pdfBase64: string;
  annotations: import('../annotations/types').Annotation[];
  signatures: import('../annotations/types').SignatureAsset[];
  view: {
    page: number;
    zoom: number;
    zoomMode: 'custom' | 'fit-page';
    rotation: number;
    sidebarOpen: boolean;
    sidebarTab: 'thumbnails' | 'outline';
  };
}
