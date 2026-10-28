import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

function debugLog(message: string) {
  const target = process.env.FOLIO_DEBUG_LOG;
  if (!target) return;
  try {
    fsSync.appendFileSync(target, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Diagnostics must never interfere with startup.
  }
}

process.on('uncaughtException', (error) => debugLog(`uncaughtException: ${error.stack || error.message}`));
process.on('unhandledRejection', (error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  debugLog(`unhandledRejection: ${message}`);
});
debugLog(`main booted pid=${process.pid} args=${process.argv.join(' ')}`);

// Keep development state inside the project. This also makes source checkouts
// usable on locked-down Windows machines where the default profile is readonly.
const devDataOverride = process.env.FOLIO_USER_DATA_DIR;
if (devDataOverride || !app.isPackaged) {
  const userDataDir = devDataOverride || path.join(__dirname, '..', '.folio-dev-data');
  try {
    fsSync.mkdirSync(userDataDir, { recursive: true });
    app.setPath('userData', userDataDir);
    app.setPath('sessionData', userDataDir);
    app.setPath('cache', path.join(userDataDir, 'Cache'));
    debugLog(`userData=${userDataDir}`);
  } catch (error) {
    debugLog(`userData override failed: ${String(error)}`);
  }
}

function testSavePath(folder: string, suggestedName: string): string | null {
  if (!folder) return null;
  try {
    fsSync.mkdirSync(folder, { recursive: true });
    return path.join(folder, suggestedName);
  } catch {
    return null;
  }
}

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow: BrowserWindow | null = null;
let isDirty = false;
let allowClose = false;

function fileFromArgs(args: string[]): string | null {
  for (const arg of [...args].reverse()) {
    if (arg.startsWith('-')) continue;
    if (/\.(pdf|folio)$/i.test(arg)) return arg;
  }
  return null;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    const filePath = fileFromArgs(argv.slice(1));
    if (filePath) mainWindow.webContents.send('app:open-file', filePath);
  });
}

const LIGHT_BAR = { color: '#f7f8fa', symbolColor: '#2c3137' };
const DARK_BAR = { color: '#121312', symbolColor: '#d7d4cd' };

function sendCloseRequest() {
  mainWindow?.webContents.send('app:close-requested');
}

function createWindow() {
  debugLog('creating BrowserWindow');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: true,
    title: 'Folio',
    backgroundColor: '#f4f6f8',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      ...LIGHT_BAR,
      height: 48,
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    debugLog('ready-to-show');
    mainWindow?.show();
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    debugLog(`did-fail-load ${code} ${description}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    debugLog(`render-process-gone ${details.reason}`);
  });
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    debugLog(`renderer-console[${level}] ${message}`);
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!mainWindow) return;
    const hasSelection = params.selectionText.trim().length > 0;
    if (!params.isEditable && !hasSelection) return;

    const template: MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      template.push(
        { role: 'undo', enabled: params.editFlags.canUndo },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' },
      );
    } else {
      template.push(
        { role: 'copy', label: 'Copy', enabled: hasSelection || params.editFlags.canCopy },
        { role: 'selectAll', label: 'Select All' },
      );
    }
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  mainWindow.on('close', (event) => {
    if (!allowClose && isDirty) {
      event.preventDefault();
      sendCloseRequest();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isDev || !url.startsWith('http://localhost:5173')) event.preventDefault();
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function startupFile(): string | null {
  return fileFromArgs(process.argv.slice(1));
}

async function readDocumentFile(filePath: string) {
  if (!/\.folio$/i.test(filePath)) {
    const bytes = await fs.readFile(filePath);
    return {
      kind: 'pdf' as const,
      filePath,
      fileName: path.basename(filePath),
      bytes: new Uint8Array(bytes),
    };
  }

  // A workspace embeds the whole PDF as base64. Parsing it here keeps a
  // multi-second, multi-hundred-megabyte string operation off the UI process.
  const raw = await fs.readFile(filePath, 'utf8');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('This Folio workspace is not valid JSON.');
  }
  if (!parsed || parsed.app !== 'Folio' || parsed.version !== 1) {
    throw new Error('This file is not a supported Folio workspace.');
  }
  if (typeof parsed.pdfBase64 !== 'string' || parsed.pdfBase64.length === 0) {
    throw new Error('This Folio workspace is missing its PDF document.');
  }
  const bytes = Buffer.from(parsed.pdfBase64, 'base64');
  return {
    kind: 'workspace' as const,
    filePath,
    fileName: typeof parsed.fileName === 'string' ? parsed.fileName : 'Untitled.pdf',
    bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    meta: JSON.stringify({
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
      signatures: Array.isArray(parsed.signatures) ? parsed.signatures : [],
      view: parsed.view && typeof parsed.view === 'object' ? parsed.view : {},
    }),
  };
}

const WORKSPACE_CHUNK = 3 * 1024 * 1024;

async function writeWorkspaceFile(target: string, metaJson: string, pdfBytes: Uint8Array) {
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(metaJson) as Record<string, unknown>;
  } catch {
    throw new Error('The workspace metadata could not be written.');
  }
  // JSON.stringify of everything except the PDF, then the base64 payload is
  // streamed in aligned chunks so the main process never builds one giant
  // string for a large book.
  const head = JSON.stringify({
    app: 'Folio',
    version: 1,
    savedAt: typeof meta.savedAt === 'string' ? meta.savedAt : new Date().toISOString(),
    fileName: typeof meta.fileName === 'string' ? meta.fileName : 'Untitled.pdf',
    annotations: Array.isArray(meta.annotations) ? meta.annotations : [],
    signatures: Array.isArray(meta.signatures) ? meta.signatures : [],
    view: meta.view && typeof meta.view === 'object' ? meta.view : {},
  });
  const payload = Buffer.from(pdfBytes.buffer, pdfBytes.byteOffset, pdfBytes.byteLength);
  const handle = await fs.open(target, 'w');
  try {
    await handle.write(`${head.slice(0, -1)},"pdfBase64":"`);
    for (let offset = 0; offset < payload.length; offset += WORKSPACE_CHUNK) {
      const chunk = payload.subarray(offset, Math.min(offset + WORKSPACE_CHUNK, payload.length));
      await handle.write(chunk.toString('base64'));
    }
    await handle.write('"}');
  } finally {
    await handle.close();
  }
}

if (hasSingleInstanceLock) app.whenReady().then(() => {
  debugLog('app ready');
  if (process.platform === 'win32') app.setAppUserModelId('com.folio.reader');
  Menu.setApplicationMenu(null);

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'media');

  ipcMain.handle('dialog:open-document', async () => {
    if (process.env.FOLIO_TEST_OPEN_FILE) {
      return readDocumentFile(process.env.FOLIO_TEST_OPEN_FILE);
    }
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open a PDF in Folio',
      properties: ['openFile'],
      filters: [
        { name: 'PDF documents', extensions: ['pdf'] },
        { name: 'Folio workspaces', extensions: ['folio'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return readDocumentFile(result.filePaths[0]);
  });

  ipcMain.handle('file:read-document', async (_event, filePath: string) => {
    return readDocumentFile(filePath);
  });

  ipcMain.handle('app:startup-file', async () => {
    const filePath = startupFile();
    if (!filePath) return null;
    try {
      return await readDocumentFile(filePath);
    } catch {
      return null;
    }
  });

  ipcMain.handle(
    'workspace:save',
    async (
      _event,
      targetPath: string | null,
      suggestedName: string,
      metaJson: string,
      pdfBytes: Uint8Array,
    ) => {
      let target = targetPath ?? '';
      if (!target) {
        const automatedPath = testSavePath(process.env.FOLIO_TEST_SAVE_DIR ?? '', suggestedName);
        if (automatedPath) {
          target = automatedPath;
        } else {
          if (!mainWindow) return null;
          const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Save Folio workspace',
            defaultPath: suggestedName,
            filters: [{ name: 'Folio workspace', extensions: ['folio'] }],
          });
          if (result.canceled || !result.filePath) return null;
          target = result.filePath;
        }
      }
      await writeWorkspaceFile(target, metaJson, pdfBytes);
      return target;
    },
  );

  ipcMain.handle('dialog:export-pdf', async (_event, suggestedName: string, bytes: Uint8Array) => {
    const automatedPath = testSavePath(process.env.FOLIO_TEST_SAVE_DIR ?? '', suggestedName);
    if (automatedPath) {
      await fs.writeFile(automatedPath, Buffer.from(bytes));
      return automatedPath;
    }
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export annotated PDF',
      defaultPath: suggestedName,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, Buffer.from(bytes));
    return result.filePath;
  });

  ipcMain.handle('dialog:save-image', async (_event, suggestedName: string, dataUrl: string) => {
    const automatedPath = testSavePath(process.env.FOLIO_TEST_SAVE_DIR ?? '', suggestedName);
    if (automatedPath) {
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      await fs.writeFile(automatedPath, Buffer.from(base64, 'base64'));
      return automatedPath;
    }
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save signature image',
      defaultPath: suggestedName,
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    await fs.writeFile(result.filePath, Buffer.from(base64, 'base64'));
    return result.filePath;
  });

  ipcMain.handle('print:document', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false, error: 'The print window is unavailable.' };
    if (process.env.FOLIO_TEST_PRINT === '1') {
      const delay = Number(process.env.FOLIO_TEST_PRINT_DELAY_MS ?? '0');
      if (Number.isFinite(delay) && delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      debugLog('print test invocation succeeded');
      if (process.env.FOLIO_TEST_PRINT_LOG) {
        await fs.writeFile(process.env.FOLIO_TEST_PRINT_LOG, 'print-invoked\n', 'utf8');
      }
      return { success: true };
    }
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      win.webContents.print(
        {
          silent: false,
          printBackground: true,
          margins: { marginType: 'none' },
          pageSize: 'Letter',
        },
        (success, failureReason) => {
          resolve({ success, error: success ? undefined : failureReason });
        },
      );
    });
  });

  ipcMain.on('window:set-theme', (_event, theme: 'light' | 'dark') => {
    if (!mainWindow) return;
    const bar = theme === 'dark' ? DARK_BAR : LIGHT_BAR;
    mainWindow.setTitleBarOverlay({ ...bar, height: 48 });
    mainWindow.setBackgroundColor(theme === 'dark' ? '#101110' : '#f4f6f8');
  });

  ipcMain.on('window:set-title', (_event, title: string) => {
    mainWindow?.setTitle(title);
  });

  ipcMain.on('window:dirty', (_event, dirty: boolean) => {
    isDirty = dirty;
  });

  ipcMain.on('window:force-close', () => {
    allowClose = true;
    mainWindow?.close();
  });

  ipcMain.on('test:request-close', () => {
    if (process.env.FOLIO_TEST_MODE === '1') mainWindow?.close();
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
