import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Maximize,
  Minus,
  MousePointer2,
  PenLine,
  Plus,
  RotateCw,
  Signature,
  StickyNote,
} from 'lucide-react';
import { HIGHLIGHT_COLORS, INK_COLORS, type AnnotationTool } from '../annotations/types';
import { useFolio } from '../store';

function useDismissOnOutside(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [close, open, ref]);
}

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  shortcut?: string;
  extra?: React.ReactNode;
}

function ToolButton({ icon, label, active, onClick, shortcut, extra }: ToolButtonProps) {
  return (
    <div className={`tool-item ${active ? 'active' : ''}`}>
      <button
        type="button"
        className="tool-button"
        onClick={onClick}
        title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
        aria-pressed={active}
      >
        {icon}
        <span>{label}</span>
      </button>
      {extra}
    </div>
  );
}

export function Toolbar() {
  const currentPage = useFolio((state) => state.currentPage);
  const pageCount = useFolio((state) => state.pageCount);
  const zoom = useFolio((state) => state.zoom);
  const rotation = useFolio((state) => state.rotation);
  const tool = useFolio((state) => state.tool);
  const highlightColor = useFolio((state) => state.highlightColor);
  const inkColor = useFolio((state) => state.inkColor);
  const inkWidth = useFolio((state) => state.inkWidth);
  const activeSignatureId = useFolio((state) => state.activeSignatureId);
  const signatures = useFolio((state) => state.signatures);
  const goToPage = useFolio((state) => state.goToPage);
  const zoomIn = useFolio((state) => state.zoomIn);
  const zoomOut = useFolio((state) => state.zoomOut);
  const setZoom = useFolio((state) => state.setZoom);
  const fitPage = useFolio((state) => state.fitPage);
  const rotateClockwise = useFolio((state) => state.rotateClockwise);
  const setTool = useFolio((state) => state.setTool);
  const setHighlightColor = useFolio((state) => state.setHighlightColor);
  const setInkColor = useFolio((state) => state.setInkColor);
  const setInkWidth = useFolio((state) => state.setInkWidth);
  const setSignatureDialogOpen = useFolio((state) => state.setSignatureDialogOpen);

  const [pageInput, setPageInput] = useState(String(currentPage));
  const [highlightMenu, setHighlightMenu] = useState(false);
  const [penMenu, setPenMenu] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);
  const penRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPageInput(String(currentPage)), [currentPage]);
  useDismissOnOutside(highlightRef, highlightMenu, () => setHighlightMenu(false));
  useDismissOnOutside(penRef, penMenu, () => setPenMenu(false));

  const commitPage = () => {
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isFinite(parsed)) goToPage(parsed);
    else setPageInput(String(currentPage));
  };

  const chooseTool = (next: AnnotationTool) => {
    if (next === 'signature' && tool === 'signature') {
      setSignatureDialogOpen(true);
      return;
    }
    setTool(next);
  };

  const applyFit = () => {
    const viewer = document.querySelector('.viewer-scroll') as HTMLElement | null;
    if (!viewer) return;
    fitPage(viewer.clientWidth, viewer.clientHeight);
    goToPage(currentPage);
  };

  const activeSignature = signatures.find((signature) => signature.id === activeSignatureId);

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="toolbar-group nav-group">
        <button
          type="button"
          className="icon-button"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          title="Previous page"
          aria-label="Previous page"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="page-number-control">
          <input
            className="page-number-input"
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ''))}
            onBlur={commitPage}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitPage();
                (event.target as HTMLInputElement).blur();
              }
            }}
            aria-label="Current page"
            inputMode="numeric"
          />
          <span className="page-count">/ {pageCount}</span>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= pageCount}
          title="Next page"
          aria-label="Next page"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group zoom-group">
        <button
          type="button"
          className="icon-button"
          onClick={zoomOut}
          disabled={zoom <= 0.25}
          title="Zoom out (Ctrl+-)"
          aria-label="Zoom out"
        >
          <Minus size={17} />
        </button>
        <button
          type="button"
          className="zoom-value"
          onClick={() => setZoom(1)}
          title="Reset to 100%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={zoomIn}
          disabled={zoom >= 4}
          title="Zoom in (Ctrl++)"
          aria-label="Zoom in"
        >
          <Plus size={17} />
        </button>
        <button
          type="button"
          className="icon-button fit-button"
          onClick={applyFit}
          title="Fit page to window (Ctrl+0)"
          aria-label="Fit page"
        >
          <Maximize size={16} />
        </button>
        </div>
      </div>

      <div className="toolbar-center">
        <div className="toolbar-group tools-group">
        <ToolButton
          icon={<MousePointer2 size={17} />}
          label="Select"
          active={tool === 'select'}
          onClick={() => chooseTool('select')}
          shortcut="V"
        />
        <div className="tool-item-with-menu" ref={highlightRef}>
          <ToolButton
            icon={<Highlighter size={17} />}
            label="Highlight"
            active={tool === 'highlight'}
            onClick={() => chooseTool('highlight')}
            shortcut="H"
            extra={
              <button
                type="button"
                className="tool-options-trigger"
                onClick={() => setHighlightMenu((open) => !open)}
                title="Highlight colors"
                aria-label="Highlight colors"
              >
                <span className="color-dot" style={{ background: highlightColor }} />
              </button>
            }
          />
          {highlightMenu && (
            <div className="tool-popover">
              <span className="popover-title">Highlight color</span>
              <div className="swatch-grid">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    type="button"
                    key={color.value}
                    className={`swatch ${highlightColor === color.value ? 'selected' : ''}`}
                    style={{ background: color.value }}
                    title={color.name}
                    onClick={() => {
                      setHighlightColor(color.value);
                      setTool('highlight');
                      setHighlightMenu(false);
                    }}
                  >
                    {highlightColor === color.value && <Check size={13} />}
                  </button>
                ))}
              </div>
              <p className="popover-hint">Select text on the page to highlight it.</p>
            </div>
          )}
        </div>
        <div className="tool-item-with-menu" ref={penRef}>
          <ToolButton
            icon={<PenLine size={17} />}
            label="Draw"
            active={tool === 'pen'}
            onClick={() => chooseTool('pen')}
            shortcut="D"
            extra={
              <button
                type="button"
                className="tool-options-trigger"
                onClick={() => setPenMenu((open) => !open)}
                title="Pen color and size"
                aria-label="Pen color and size"
              >
                <span className="color-dot" style={{ background: inkColor }} />
              </button>
            }
          />
          {penMenu && (
            <div className="tool-popover pen-popover">
              <span className="popover-title">Pen color</span>
              <div className="swatch-grid">
                {INK_COLORS.map((color) => (
                  <button
                    type="button"
                    key={color.value}
                    className={`swatch ${inkColor === color.value ? 'selected' : ''}`}
                    style={{ background: color.value }}
                    title={color.name}
                    onClick={() => {
                      setInkColor(color.value);
                      setTool('pen');
                    }}
                  >
                    {inkColor === color.value && <Check size={13} />}
                  </button>
                ))}
              </div>
              <div className="pen-width-row">
                <span>Pen size</span>
                <input
                  type="range"
                  min="1.2"
                  max="8"
                  step="0.4"
                  value={inkWidth}
                  onChange={(event) => setInkWidth(Number(event.target.value))}
                  aria-label="Pen size"
                />
                <span className="pen-width-value">{inkWidth.toFixed(1)}</span>
              </div>
              <p className="popover-hint">Draw directly on the page. Switch to Select to move it.</p>
            </div>
          )}
        </div>
        <ToolButton
          icon={<StickyNote size={17} />}
          label="Note"
          active={tool === 'note'}
          onClick={() => chooseTool('note')}
          shortcut="N"
        />
        <ToolButton
          icon={<Signature size={17} />}
          label="Sign"
          active={tool === 'signature'}
          onClick={() => chooseTool('signature')}
          shortcut="S"
          extra={
            <span className="signature-tool-extras">
              {activeSignature && (
                <span className="active-signature-dot" title={`Signature: ${activeSignature.name}`}>
                  <Check size={9} />
                </span>
              )}
              <button
                type="button"
                className="tool-options-trigger signature-manage-trigger"
                onClick={() => setSignatureDialogOpen(true)}
                title="Manage signatures"
                aria-label="Manage signatures"
              >
                <ChevronDown size={12} />
              </button>
            </span>
          }
          />
        </div>
      </div>

      <div className="toolbar-right">
        <button
          type="button"
          className="icon-button"
          onClick={rotateClockwise}
          title="Rotate page clockwise (R)"
          aria-label="Rotate page clockwise"
        >
          <RotateCw size={17} />
        </button>
        <span className="rotation-label">{rotation ? `${rotation}°` : ''}</span>
      </div>
    </div>
  );
}
