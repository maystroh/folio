import { contextBridge, ipcRenderer } from 'electron';

type Unsubscribe = () => void;

export interface DocumentPayload {
  kind: 'pdf' | 'workspace';
  filePath: string | null;
  fileName: string;
  bytes: Uint8Array;
  /** JSON with annotations, signatures and view; present for workspaces. */
  meta?: string;
}

const api = {
  openDocument: (): Promise<DocumentPayload | null> => ipcRenderer.invoke('dialog:open-document'),
  readDocument: (filePath: string): Promise<DocumentPayload> =>
    ipcRenderer.invoke('file:read-document', filePath),
  getStartupFile: (): Promise<DocumentPayload | null> => ipcRenderer.invoke('app:startup-file'),
  saveWorkspace: (
    filePath: string | null,
    suggestedName: string,
    metaJson: string,
    pdfBytes: Uint8Array,
  ): Promise<string | null> =>
    ipcRenderer.invoke('workspace:save', filePath, suggestedName, metaJson, pdfBytes),
  exportPdf: (suggestedName: string, bytes: Uint8Array): Promise<string | null> =>
    ipcRenderer.invoke('dialog:export-pdf', suggestedName, bytes),
  saveImage: (suggestedName: string, dataUrl: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:save-image', suggestedName, dataUrl),
  printDocument: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('print:document'),
  setTheme: (theme: 'light' | 'dark'): void => ipcRenderer.send('window:set-theme', theme),
  setTitle: (title: string): void => ipcRenderer.send('window:set-title', title),
  setDirty: (dirty: boolean): void => ipcRenderer.send('window:dirty', dirty),
  forceClose: (): void => ipcRenderer.send('window:force-close'),
  onCloseRequested: (callback: () => void): Unsubscribe => {
    const listener = () => callback();
    ipcRenderer.on('app:close-requested', listener);
    return () => ipcRenderer.removeListener('app:close-requested', listener);
  },
  onOpenFile: (callback: (filePath: string) => void): Unsubscribe => {
    const listener = (_event: unknown, filePath: string) => callback(filePath);
    ipcRenderer.on('app:open-file', listener);
    return () => ipcRenderer.removeListener('app:open-file', listener);
  },
  ...(process.env.FOLIO_TEST_MODE === '1'
    ? {
        testCloseWindow: (): void => ipcRenderer.send('test:request-close'),
      }
    : {}),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('folio', api);

export type FolioBridge = typeof api;
