import { useEffect, useRef, useState } from 'react';
import { useFolio } from '../store';
import { baseName, createWorkspace, base64ToBytes, parseWorkspace } from '../pdf/workspace';
import { exportAnnotatedPdf } from '../export/exportPdf';

type PendingAction =
  | { type: 'open-native' }
  | { type: 'open-file'; file: File }
  | { type: 'open-path'; filePath: string }
  | { type: 'close' };

interface NativeDocumentResult {
  filePath: string | null;
  fileName: string;
  bytes: Uint8Array;
}

export function useDocumentIO() {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const pendingRef = useRef<PendingAction | null>(null);
  pendingRef.current = pendingAction;

  const loadNativeResult = async (result: NativeDocumentResult) => {
    const state = useFolio.getState();
    const lower = result.fileName.toLowerCase();
    if (lower.endsWith('.folio')) {
      try {
        const text = new TextDecoder().decode(result.bytes);
        const workspace = parseWorkspace(text);
        const pdfBytes = base64ToBytes(workspace.pdfBase64);
        await state.loadDocument({
          bytes: pdfBytes,
          fileName: workspace.fileName,
          filePath: null,
          workspacePath: result.filePath || null,
          restore: {
            annotations: workspace.annotations,
            signatures: workspace.signatures,
            view: workspace.view,
          },
        });
        if (useFolio.getState().pdf) {
          useFolio.getState().showToast('Workspace restored with its annotations.', 'success');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The workspace could not be opened.';
        useFolio.getState().setError(message);
        useFolio.getState().showToast(message, 'error');
      }
      return;
    }

    await state.loadDocument({
      bytes: result.bytes,
      fileName: result.fileName,
      filePath: result.filePath,
    });
  };

  const openFileObject = async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.pdf') && !lower.endsWith('.folio')) {
      useFolio.getState().showToast('Folio can open PDF documents and .folio workspaces.', 'error');
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      await loadNativeResult({
        filePath: null,
        fileName: file.name,
        bytes: new Uint8Array(buffer),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'That file could not be read.';
      useFolio.getState().showToast(message, 'error');
    }
  };

  const openNativeNow = async () => {
    try {
      const result = await window.folio.openDocument();
      if (result) await loadNativeResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The file picker could not be opened.';
      useFolio.getState().showToast(message, 'error');
    }
  };

  const openPathNow = async (filePath: string) => {
    try {
      const result = await window.folio.readDocument(filePath);
      await loadNativeResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'That file could not be read.';
      useFolio.getState().showToast(message, 'error');
    }
  };

  const executePending = async (action: PendingAction) => {
    if (action.type === 'open-native') {
      await openNativeNow();
    } else if (action.type === 'open-file') {
      await openFileObject(action.file);
    } else if (action.type === 'open-path') {
      await openPathNow(action.filePath);
    } else {
      window.folio.forceClose();
    }
  };

  const requestAction = async (action: PendingAction) => {
    if (!useFolio.getState().isDirty) {
      await executePending(action);
      return;
    }
    setPendingAction(action);
  };

  const requestOpen = () => void requestAction({ type: 'open-native' });
  const requestOpenFile = (file: File) => void requestAction({ type: 'open-file', file });
  const requestOpenPath = (filePath: string) => void requestAction({ type: 'open-path', filePath });
  const requestClose = () => {
    if (!useFolio.getState().isDirty) {
      window.folio.forceClose();
      return;
    }
    void requestAction({ type: 'close' });
  };

  useEffect(() => {
    const unsubscribe = window.folio.onCloseRequested(() => {
      if (!useFolio.getState().isDirty) window.folio.forceClose();
      else setPendingAction({ type: 'close' });
    });
    return unsubscribe;
  }, []);

  const save = async (saveAs = false): Promise<boolean> => {
    const state = useFolio.getState();
    if (!state.pdf || !state.documentBytes) return false;
    state.setBusy('Saving workspace');
    try {
      const workspace = createWorkspace({
        fileName: state.fileName,
        bytes: state.documentBytes,
        annotations: state.annotations,
        signatures: state.signatures,
        view: state.viewForSave(),
      });
      const contents = JSON.stringify(workspace);
      let target = state.workspacePath;
      if (saveAs || !target) {
        target = await window.folio.saveWorkspaceAs(
          `${baseName(state.fileName)}.folio`,
          contents,
        );
        if (!target) {
          state.setBusy(null);
          return false;
        }
      } else {
        target = await window.folio.writeWorkspace(target, contents);
      }
      useFolio.getState().markSaved(target);
      useFolio.getState().showToast(
        target ? `Workspace saved to ${target.split(/[\\/]/).pop()}` : 'Workspace saved.',
        'success',
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The workspace could not be saved.';
      useFolio.getState().showToast(message, 'error');
      return false;
    } finally {
      useFolio.getState().setBusy(null);
    }
  };

  const exportPdf = async (): Promise<boolean> => {
    const state = useFolio.getState();
    if (!state.pdf || !state.documentBytes) return false;
    state.setBusy('Building annotated PDF');
    try {
      const bytes = await exportAnnotatedPdf({
        bytes: state.documentBytes,
        annotations: state.annotations,
        userRotation: state.rotation,
        onProgress: (current, total) => {
          if (current === total || current % 3 === 0) {
            useFolio.getState().setBusy(`Building annotated PDF · page ${current} of ${total}`);
          }
        },
      });
      const target = await window.folio.exportPdf(
        `${baseName(state.fileName)}-annotated.pdf`,
        bytes,
      );
      if (target) {
        useFolio
          .getState()
          .showToast(`Annotated PDF exported to ${target.split(/[\\/]/).pop()}`, 'success');
      }
      return Boolean(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The PDF could not be exported.';
      useFolio.getState().showToast(message, 'error');
      return false;
    } finally {
      useFolio.getState().setBusy(null);
    }
  };

  const confirmSave = async () => {
    const action = pendingRef.current;
    if (!action) return;
    setConfirmBusy(true);
    const saved = await save(false);
    setConfirmBusy(false);
    if (!saved) return;
    setPendingAction(null);
    pendingRef.current = null;
    await executePending(action);
  };

  const confirmDiscard = () => {
    const action = pendingRef.current;
    setPendingAction(null);
    pendingRef.current = null;
    if (action) void executePending(action);
  };

  const cancelConfirm = () => {
    setPendingAction(null);
    pendingRef.current = null;
  };

  const openStartup = async () => {
    try {
      const result = await window.folio.getStartupFile();
      if (result) await loadNativeResult(result);
    } catch {
      // A missing startup document is not an error worth interrupting reading.
    }
  };

  return {
    pendingAction,
    confirmBusy,
    requestOpen,
    requestOpenFile,
    requestOpenPath,
    requestClose,
    save,
    exportPdf,
    confirmSave,
    confirmDiscard,
    cancelConfirm,
    openStartup,
  };
}
