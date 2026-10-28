import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Loader2 } from 'lucide-react';
import { Titlebar } from './components/Titlebar';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { PdfViewer } from './components/PdfViewer';
import { Welcome } from './components/Welcome';
import { ConfirmDialog } from './components/ConfirmDialog';
import { NoteDialog } from './components/NoteDialog';
import { SignatureDialog } from './signatures/SignatureDialog';
import { SelectionInspector } from './components/SelectionInspector';
import { Toasts } from './components/Toasts';
import { PrintDeck } from './components/PrintDeck';
import { useDocumentIO } from './hooks/useDocumentIO';
import { useFolio } from './store';
import type { Annotation } from './annotations/types';

interface PrintJob {
  pdf: PDFDocumentProxy;
  pageCount: number;
  rotation: number;
  annotations: Annotation[];
}

interface PrintProgress {
  rendered: number;
  total: number;
  phase: 'preparing' | 'dialog';
}

export default function App() {
  const pdf = useFolio((state) => state.pdf);
  const documentId = useFolio((state) => state.documentId);
  const fileName = useFolio((state) => state.fileName);
  const isDirty = useFolio((state) => state.isDirty);
  const theme = useFolio((state) => state.theme);
  const sidebarOpen = useFolio((state) => state.sidebarOpen);
  const loading = useFolio((state) => state.loading);
  const loadingLabel = useFolio((state) => state.loadingLabel);
  const busy = useFolio((state) => state.busy);
  const signatureDialogOpen = useFolio((state) => state.signatureDialogOpen);
  const noteEditorId = useFolio((state) => state.noteEditorId);
  const showToast = useFolio((state) => state.showToast);

  const io = useDocumentIO();
  const ioRef = useRef(io);
  ioRef.current = io;
  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);
  const startupOpened = useRef(false);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [printProgress, setPrintProgress] = useState<PrintProgress | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.folio.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    const nextTitle = pdf ? `${isDirty ? '● ' : ''}${fileName} — Folio` : 'Folio';
    document.title = nextTitle;
    window.folio.setTitle(nextTitle);
    window.folio.setDirty(isDirty);
  }, [fileName, isDirty, pdf]);

  useEffect(() => {
    if (startupOpened.current) return;
    startupOpened.current = true;
    void io.openStartup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return window.folio.onOpenFile((filePath) => ioRef.current.requestOpenPath(filePath));
  }, []);

  const startPrint = useCallback(() => {
    const state = useFolio.getState();
    if (!state.pdf || printJob) return;
    setPrintProgress({ rendered: 0, total: state.pageCount, phase: 'preparing' });
    setPrintJob({
      pdf: state.pdf,
      pageCount: state.pageCount,
      rotation: state.rotation,
      annotations: state.annotations,
    });
  }, [printJob]);

  const handlePrintProgress = useCallback((rendered: number, total: number) => {
    setPrintProgress((current) => (current ? { ...current, rendered, total } : current));
  }, []);

  const cancelPrint = useCallback(() => {
    setPrintJob(null);
    setPrintProgress(null);
    showToast('Print preparation canceled.');
  }, [showToast]);

  const handlePrintReady = useCallback(async () => {
    setPrintProgress((current) => (current ? { ...current, phase: 'dialog' } : current));
    try {
      const result = await window.folio.printDocument();
      if (!result.success && !/cancel/i.test(result.error ?? '')) {
        showToast(result.error || 'The document could not be printed.', 'error');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Printing failed.', 'error');
    } finally {
      setPrintJob(null);
      setPrintProgress(null);
    }
  }, [showToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const state = useFolio.getState();

      if (event.key === 'Escape') {
        event.preventDefault();
        if (io.pendingAction) {
          io.cancelConfirm();
          return;
        }
        if (state.signatureDialogOpen) {
          state.setSignatureDialogOpen(false);
          return;
        }
        if (state.noteEditorId) {
          state.setNoteEditor(null);
          return;
        }
        if (printJob) {
          cancelPrint();
          return;
        }
        if (state.loading) {
          state.cancelLoading();
          showToast('Opening canceled.');
          return;
        }
        if (dragActive) {
          dragCounter.current = 0;
          setDragActive(false);
          return;
        }
        window.getSelection()?.removeAllRanges();
        if (state.pdf) {
          if (state.tool !== 'select') state.setTool('select');
          else if (state.selectedAnnotationId) state.selectAnnotation(null);
        }
        return;
      }

      const mod = event.ctrlKey || event.metaKey;
      if (mod) {
        const key = event.key.toLowerCase();
        if (key === 'o') {
          event.preventDefault();
          io.requestOpen();
        } else if (key === 's') {
          event.preventDefault();
          void io.save(event.shiftKey);
        } else if (key === 'e' && event.shiftKey) {
          event.preventDefault();
          void io.exportPdf();
        } else if (key === 'p') {
          event.preventDefault();
          startPrint();
        } else if (key === 'b') {
          event.preventDefault();
          state.toggleSidebar();
        } else if (key === '0') {
          event.preventDefault();
          const viewer = document.querySelector('.viewer-scroll') as HTMLElement | null;
          if (viewer) {
            state.fitPage(viewer.clientWidth, viewer.clientHeight);
            state.goToPage(state.currentPage);
          }
        } else if (key === '+' || key === '=') {
          event.preventDefault();
          state.zoomIn();
        } else if (key === '-') {
          event.preventDefault();
          state.zoomOut();
        } else if (key === 'd' && event.shiftKey) {
          event.preventDefault();
          state.toggleTheme();
        }
        return;
      }

      if (state.signatureDialogOpen || state.noteEditorId || io.pendingAction) {
        return;
      }

      if (!state.pdf) return;
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          state.goToPage(state.currentPage - 1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          state.goToPage(state.currentPage + 1);
          break;
        case 'PageUp':
          event.preventDefault();
          state.goToPage(state.currentPage - 1);
          break;
        case 'PageDown':
          event.preventDefault();
          state.goToPage(state.currentPage + 1);
          break;
        case 'Delete':
        case 'Backspace':
          if (state.selectedAnnotationId) {
            event.preventDefault();
            state.deleteAnnotation(state.selectedAnnotationId);
          }
          break;
        default:
          break;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === 'v') state.setTool('select');
        else if (key === 'h') state.setTool('highlight');
        else if (key === 'd') state.setTool('pen');
        else if (key === 'n') state.setTool('note');
        else if (key === 's') state.setTool('signature');
        else if (key === 'r') state.rotateClockwise();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelPrint, dragActive, io, printJob, showToast, startPrint]);

  const handleDragEnter = (event: React.DragEvent) => {
    event.preventDefault();
    if (!event.dataTransfer.types.includes('Files')) return;
    dragCounter.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragActive(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    if (files.length > 1) {
      showToast('Drop one PDF at a time.', 'error');
      return;
    }
    const file = files[0];
    if (!/\.(pdf|folio)$/i.test(file.name)) {
      showToast('Folio can open PDF documents and .folio workspaces.', 'error');
      return;
    }
    io.requestOpenFile(file);
  };

  return (
    <div
      className="app-root"
      data-document-id={documentId}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {!pdf ? (
        <Welcome onOpen={io.requestOpen} />
      ) : (
        <>
          <Titlebar
            onOpen={io.requestOpen}
            onSave={() => void io.save(false)}
            onExport={() => void io.exportPdf()}
            onPrint={startPrint}
          />
          <div className={`workspace ${sidebarOpen ? 'sidebar-visible' : 'sidebar-hidden'}`}>
            {sidebarOpen && <Sidebar />}
            <main className="main-pane">
              <Toolbar />
              <div className="reader-area">
                <PdfViewer key={documentId} />
                <SelectionInspector />
              </div>
            </main>
          </div>
        </>
      )}

      {dragActive && (
        <div className="drop-overlay">
          <div className="drop-card">
            <div className="drop-icon">
              <span className="drop-page" />
              <span className="drop-arrow">↓</span>
            </div>
            <h2>Drop to open in Folio</h2>
            <p>PDF documents and Folio workspaces</p>
          </div>
        </div>
      )}

      {(loading || busy) && (
        <div className={`busy-overlay ${loading ? 'full' : ''}`} role="status" aria-live="polite">
          <div className="busy-card">
            <Loader2 className="spin" size={22} />
            <div>
              <strong>{loading ? loadingLabel || 'Opening document' : busy}</strong>
              <span>{loading ? 'Preparing pages…' : 'This will only take a moment.'}</span>
            </div>
            {loading && (
              <button
                type="button"
                className="secondary-button busy-cancel"
                onClick={() => {
                  useFolio.getState().cancelLoading();
                  showToast('Opening canceled.');
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {printProgress && (
        <div className="busy-overlay print-overlay" role="status">
          <div className="busy-card">
            <Loader2 className="spin" size={22} />
            <div>
              <strong>
                {printProgress.phase === 'dialog'
                  ? 'Opening the print dialog'
                  : 'Preparing pages for print'}
              </strong>
              <span>
                {printProgress.phase === 'dialog'
                  ? 'Choose your printer in the Windows dialog.'
                  : `Page ${Math.min(printProgress.rendered + 1, printProgress.total)} of ${
                      printProgress.total
                    } · Press Esc to cancel`}
              </span>
            </div>
            <button type="button" className="secondary-button busy-cancel" onClick={cancelPrint}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(io.pendingAction)}
        mode={io.pendingAction?.type === 'close' ? 'close' : 'open'}
        busy={io.confirmBusy}
        onSave={() => void io.confirmSave()}
        onDiscard={io.confirmDiscard}
        onCancel={io.cancelConfirm}
      />
      {signatureDialogOpen && <SignatureDialog />}
      {noteEditorId && <NoteDialog />}
      <Toasts />

      {printJob && (
        <PrintDeck
          pdf={printJob.pdf}
          pageCount={printJob.pageCount}
          rotation={printJob.rotation}
          annotations={printJob.annotations}
          onReady={() => void handlePrintReady()}
          onProgress={handlePrintProgress}
        />
      )}
    </div>
  );
}
