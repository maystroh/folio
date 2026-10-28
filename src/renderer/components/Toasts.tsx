import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useFolio } from '../store';

export function Toasts() {
  const toasts = useFolio((state) => state.toasts);
  const dismissToast = useFolio((state) => state.dismissToast);

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone}`}>
          <span className="toast-icon">
            {toast.tone === 'success' ? (
              <CheckCircle2 size={17} />
            ) : toast.tone === 'error' ? (
              <AlertCircle size={17} />
            ) : (
              <Info size={17} />
            )}
          </span>
          <span>{toast.message}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss message"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
