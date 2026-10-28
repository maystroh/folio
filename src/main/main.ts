import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
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

const LIGHT_BAR = { color: '#f4f0e8', symbolColor: '#34322d' };
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
    backgroundColor: '#f4f0e8',
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
  const args = process.argv.slice(1);
  for (const arg of args.reverse()) {
    if (arg.startsWith('-')) continue;
    if (/\.(pdf|folio)$/i.test(arg)) return arg;
  }
  return null;
}

async function readDocumentFile(filePath: string) {
  const bytes = await fs.readFile(filePath);
  return {
    filePath,
    fileName: path.basename(filePath),
    bytes: new Uint8Array(bytes),
  };
}

app.whenReady().then(() => {
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

  ipcMain.handle('dialog:save-workspace', async (_event, suggestedName: string, content: string) => {
    const automatedPath = testSavePath(process.env.FOLIO_TEST_SAVE_DIR ?? '', suggestedName);
    if (automatedPath) {
      await fs.writeFile(automatedPath, content, 'utf8');
      return automatedPath;
    }
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Folio workspace',
      defaultPath: suggestedName,
      filters: [{ name: 'Folio workspace', extensions: ['folio'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, content, 'utf8');
    return result.filePath;
  });

  ipcMain.handle('fs:write-workspace', async (_event, filePath: string, content: string) => {
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  });

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
    mainWindow.setBackgroundColor(theme === 'dark' ? '#101110' : '#f4f0e8');
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
