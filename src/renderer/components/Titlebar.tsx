import {
  FileDown,
  FolderOpen,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  Save,
  Sun,
} from 'lucide-react';
import { useFolio } from '../store';
import { LogoMark } from './LogoMark';

interface TitlebarProps {
  onOpen: () => void;
  onSave: () => void;
  onExport: () => void;
  onPrint: () => void;
}

export function Titlebar({ onOpen, onSave, onExport, onPrint }: TitlebarProps) {
  const fileName = useFolio((state) => state.fileName);
  const isDirty = useFolio((state) => state.isDirty);
  const sidebarOpen = useFolio((state) => state.sidebarOpen);
  const theme = useFolio((state) => state.theme);
  const toggleSidebar = useFolio((state) => state.toggleSidebar);
  const toggleTheme = useFolio((state) => state.toggleTheme);
  const workspacePath = useFolio((state) => state.workspacePath);
  const hasDocument = Boolean(useFolio((state) => state.pdf));

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <button
          type="button"
          className="icon-button sidebar-toggle"
          onClick={toggleSidebar}
          title={sidebarOpen ? 'Hide sidebar (Ctrl+B)' : 'Show sidebar (Ctrl+B)'}
          aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          disabled={!hasDocument}
        >
          {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        <div className="brand">
          <span className="brand-glow">
            <LogoMark />
          </span>
          <span className="brand-name">Folio</span>
        </div>
        {hasDocument && (
          <>
            <span className="titlebar-separator" />
            <div className="titlebar-document" title={workspacePath ?? fileName}>
              <span className="titlebar-filename">{fileName}</span>
              {isDirty && (
                <span className="dirty-indicator" title="Unsaved changes">
                  Unsaved
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="titlebar-actions">
        <button type="button" className="topbar-button" onClick={onOpen} title="Open a PDF (Ctrl+O)">
          <FolderOpen size={16} />
          <span>Open</span>
        </button>
        <button
          type="button"
          className="topbar-button"
          onClick={onSave}
          disabled={!hasDocument}
          title="Save workspace (Ctrl+S)"
        >
          <Save size={16} />
          <span>Save</span>
        </button>
        <button
          type="button"
          className="topbar-button"
          onClick={onExport}
          disabled={!hasDocument}
          title="Export annotated PDF (Ctrl+Shift+E)"
        >
          <FileDown size={16} />
          <span>Export</span>
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onPrint}
          disabled={!hasDocument}
          title="Print (Ctrl+P)"
          aria-label="Print"
        >
          <Printer size={17} />
        </button>
        <button
          type="button"
          className="icon-button theme-toggle"
          onClick={toggleTheme}
          title={theme === 'light' ? 'Switch to dark reading mode' : 'Switch to light mode'}
          aria-label={theme === 'light' ? 'Switch to dark reading mode' : 'Switch to light mode'}
        >
          {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
        </button>
      </div>
    </header>
  );
}
