/// <reference types="vite/client" />

export interface FolioBridge {
  openDocument: () => Promise<{ filePath: string; fileName: string; bytes: Uint8Array } | null>;
  readDocument: (filePath: string) => Promise<{ filePath: string; fileName: string; bytes: Uint8Array }>;
  getStartupFile: () => Promise<{ filePath: string; fileName: string; bytes: Uint8Array } | null>;
  saveWorkspaceAs: (suggestedName: string, content: string) => Promise<string | null>;
  writeWorkspace: (filePath: string, content: string) => Promise<string>;
  exportPdf: (suggestedName: string, bytes: Uint8Array) => Promise<string | null>;
  saveImage: (suggestedName: string, dataUrl: string) => Promise<string | null>;
  printDocument: () => Promise<{ success: boolean; error?: string }>;
  setTheme: (theme: 'light' | 'dark') => void;
  setTitle: (title: string) => void;
  setDirty: (dirty: boolean) => void;
  forceClose: () => void;
  onCloseRequested: (callback: () => void) => () => void;
  testCloseWindow?: () => void;
  platform: string;
}

declare global {
  interface Window {
    folio: FolioBridge;
  }
}
