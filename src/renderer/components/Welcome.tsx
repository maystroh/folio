import { AlertCircle, FolderOpen, MoveUpRight, Moon, Sun } from 'lucide-react';
import { useFolio } from '../store';
import { LogoMark } from './LogoMark';

interface WelcomeProps {
  onOpen: () => void;
}

export function Welcome({ onOpen }: WelcomeProps) {
  const error = useFolio((state) => state.error);
  const theme = useFolio((state) => state.theme);
  const toggleTheme = useFolio((state) => state.toggleTheme);

  return (
    <div className="welcome">
      <div className="welcome-top">
        <div className="welcome-brand">
          <LogoMark size={18} />
          <span>Folio</span>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={toggleTheme}
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
        </button>
      </div>

      <div className="welcome-main">
        <div className="welcome-copy">
          <span className="eyebrow">A PDF reader for careful reading</span>
          <h1>A quieter place<br />to read.</h1>
          <p>
            Open a PDF, mark what matters, and keep your notes exactly where you left them.
            Everything stays on this computer.
          </p>
          <button type="button" className="primary-button large" onClick={onOpen}>
            <FolderOpen size={18} />
            Open a PDF
          </button>
          <span className="welcome-drop-hint">
            <MoveUpRight size={13} />
            or drag a PDF into this window
          </span>
          {error && (
            <div className="welcome-error" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="welcome-visual" aria-hidden="true">
          <div className="paper-sheet paper-back">
            <div className="paper-rule" />
            <div className="paper-rule short" />
            <div className="paper-rule" />
          </div>
          <div className="paper-sheet paper-front">
            <div className="paper-kicker">CHAPTER ONE</div>
            <div className="paper-title">A quieter attention</div>
            <div className="paper-line wide" />
            <div className="paper-line" />
            <div className="paper-line" />
            <div className="paper-line short" />
            <div className="paper-highlight" />
            <div className="paper-ink" />
            <div className="paper-note">
              <span>come back to this</span>
            </div>
          </div>
          <div className="welcome-orbit orbit-one" />
          <div className="welcome-orbit orbit-two" />
        </div>

        <div className="welcome-shortcuts">
          <div>
            <span className="shortcut-title">Open</span>
            <kbd>Ctrl</kbd><kbd>O</kbd>
          </div>
          <div>
            <span className="shortcut-title">Save</span>
            <kbd>Ctrl</kbd><kbd>S</kbd>
          </div>
          <div>
            <span className="shortcut-title">Fit page</span>
            <kbd>Ctrl</kbd><kbd>0</kbd>
          </div>
          <div>
            <span className="shortcut-title">Dark mode</span>
            <kbd>Ctrl</kbd><kbd>⇧</kbd><kbd>D</kbd>
          </div>
        </div>
      </div>
      <div className="welcome-footer">
        <span>Folio 1.0</span>
        <span>Local-first reading & annotation</span>
      </div>
    </div>
  );
}
