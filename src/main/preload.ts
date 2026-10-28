import { contextBridge, ipcRenderer } from 'electron';

type Unsubscribe = () => void;

const api = {
  openDocument: (): Promise<{ filePath: string; fileName: string; bytes: Uint8Array } | null> =>
    ipcRenderer.invoke('dialog:open-document'),
  readDocument: (filePath: string): Promise<{ filePath: string; fileName: string; bytes: Uint8Array }> =>
    ipcRenderer.invoke('file:read-document', filePath),
  getStartupFile: (): Promise<{ filePath: string; fileName: string; bytes: Uint8Array } | null> =>
    ipcRenderer.invoke('app:startup-file'),
  saveWorkspaceAs: (suggestedName: string, content: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:save-workspace', suggestedName, content),
  writeWorkspace: (filePath: string, content: string): Promise<string> =>
    ipcRenderer.invoke('fs:write-workspace', filePath, content),
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
  ...(process.env.FOLIO_TEST_MODE === '1'
    ? {
        testCloseWindow: (): void => ipcRenderer.send('test:request-close'),
      }
    : {}),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('folio', api);

export type FolioBridge = typeof api;
