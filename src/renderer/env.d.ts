/// <reference types="vite/client" />

export interface FolioDocumentPayload {
  kind: 'pdf' | 'workspace';
  filePath: string | null;
  fileName: string;
  bytes: Uint8Array;
  /** JSON with annotations, signatures and view; present for workspaces. */
  meta?: string;
}

export interface FolioBridge {
  openDocument: () => Promise<FolioDocumentPayload | null>;
  readDocument: (filePath: string) => Promise<FolioDocumentPayload>;
  getStartupFile: () => Promise<FolioDocumentPayload | null>;
  saveWorkspace: (
    filePath: string | null,
    suggestedName: string,
    metaJson: string,
    pdfBytes: Uint8Array,
  ) => Promise<string | null>;
  exportPdf: (suggestedName: string, bytes: Uint8Array) => Promise<string | null>;
  saveImage: (suggestedName: string, dataUrl: string) => Promise<string | null>;
  printDocument: () => Promise<{ success: boolean; error?: string }>;
  setTheme: (theme: 'light' | 'dark') => void;
  setTitle: (title: string) => void;
  setDirty: (dirty: boolean) => void;
  forceClose: () => void;
  onCloseRequested: (callback: () => void) => () => void;
  onOpenFile: (callback: (filePath: string) => void) => () => void;
  testCloseWindow?: () => void;
  platform: string;
}

declare global {
  interface Window {
    folio: FolioBridge;
  }
}
