import { AlertCircle, Loader2 } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  mode: 'close' | 'open';
  busy?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, mode, busy, onSave, onDiscard, onCancel }: ConfirmDialogProps) {
  if (!open) return null;
  const action = mode === 'close' ? 'close' : 'open another document';
  return (
    <div className="modal-backdrop">
      <div className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-icon">
          <AlertCircle size={22} />
        </div>
        <h2 id="confirm-title">Save your changes?</h2>
        <p>
          This document has annotations that haven’t been saved. Save the workspace before you{' '}
          {action}, or discard the changes.
        </p>
        <div className="confirm-actions">
          <button type="button" className="danger-text-button" onClick={onDiscard} disabled={busy}>
            Discard changes
          </button>
          <div className="confirm-actions-right">
            <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={onSave} disabled={busy}>
              {busy && <Loader2 size={15} className="spin" />}
              {busy ? 'Saving…' : mode === 'close' ? 'Save & close' : 'Save & continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
