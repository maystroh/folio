import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import type { InkAnnotation, PdfPoint, PdfRect } from '../annotations/types';
import { AnnotationLayer } from './AnnotationLayer';
import {
  createAnnotationId,
  useFolio,
  type PageGeometry,
} from '../store';
import {
  clamp,
  pageDisplaySize,
  pointerToPageLocal,
  screenPointToPdf,
  screenRectToPdf,
} from '../pdf/geometry';
import { getPageTextContent, releasePageSoon, renderPixelRatio, retainPage } from '../pdf/pdfjs';

interface PdfPageProps {
  pageNumber: number;
  geometry: PageGeometry;
  zoom: number;
  rotation: number;
  tool: 'select' | 'highlight' | 'pen' | 'note' | 'signature';
  annotations: import('../annotations/types').Annotation[];
  selectedId: string | null;
  theme: 'light' | 'dark';
}

interface RenderTaskLike {
  cancel: () => void;
  promise: Promise<unknown>;
}

/**
 * A zoom change repaints every visible page. Painting immediately on each step
 * of a Ctrl+wheel zoom means several megabytes of pixels per step; waiting for
 * the zoom to settle keeps the gesture at frame rate while the browser scales
 * the existing bitmap.
 */
const RENDER_SETTLE_MS = 110;

function viewportFor(page: PDFPageProxy, zoom: number, rotation: number): PageViewport {
  return page.getViewport({ scale: zoom, rotation: page.rotate + rotation });
}

function PdfPageComponent({
  pageNumber,
  geometry,
  zoom,
  rotation,
  tool,
  annotations,
  selectedId,
  theme,
}: PdfPageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [rendered, setRendered] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const hasBitmap = useRef(false);
  const draftRef = useRef<InkAnnotation | null>(null);
  const [draftInk, setDraftInk] = useState<InkAnnotation | null>(null);
  const drawingPointer = useRef<number | null>(null);
  const size = pageDisplaySize(geometry.width, geometry.height, rotation);

  const pdf = useFolio((state) => state.pdf);
  const setPageGeometry = useFolio((state) => state.setPageGeometry);
  const addAnnotation = useFolio((state) => state.addAnnotation);
  const setNoteEditor = useFolio((state) => state.setNoteEditor);
  const selectAnnotation = useFolio((state) => state.selectAnnotation);
  const showToast = useFolio((state) => state.showToast);

  const displayViewport = useMemo(
    () => (page ? viewportFor(page, zoom, rotation) : null),
    [page, zoom, rotation],
  );

  const cancelDraft = useCallback(() => {
    if (drawingPointer.current !== null && pageRef.current) {
      try {
        pageRef.current.releasePointerCapture(drawingPointer.current);
      } catch {
        // The pointer may already have been released.
      }
    }
    drawingPointer.current = null;
    draftRef.current = null;
    setDraftInk(null);
    document.body.classList.remove('is-dragging-annotation');
  }, []);

  useEffect(() => {
    if (tool !== 'pen') cancelDraft();
  }, [cancelDraft, tool]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelDraft();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelDraft]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    pdf
      .getPage(pageNumber)
      .then((loaded) => {
        if (cancelled) return;
        retainPage(loaded);
        setPage(loaded);
        const viewport = loaded.getViewport({ scale: 1, rotation: loaded.rotate });
        setPageGeometry(pageNumber, {
          width: viewport.width,
          height: viewport.height,
          rotate: loaded.rotate,
        });
      })
      .catch(() => {
        if (!cancelled) setRenderError('This page could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [pageNumber, pdf, setPageGeometry]);

  useEffect(() => {
    if (!page) return;
    retainPage(page);
    return () => {
      // Keep the page around briefly: scrolling back one page should not pay
      // for a full re-parse, but a long book must not accumulate operator lists.
      releasePageSoon(page);
    };
  }, [page]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!page || !canvas) return;
    let cancelled = false;
    let task: RenderTaskLike | null = null;
    let timer = 0;

    // Match the layout immediately so the page never jumps while the crisp
    // bitmap is still being produced.
    const cssViewport = page.getViewport({ scale: zoom, rotation: page.rotate + rotation });
    canvas.style.width = `${cssViewport.width}px`;
    canvas.style.height = `${cssViewport.height}px`;

    const paint = () => {
      if (cancelled || !canvasRef.current) return;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return;
      const pixelRatio = renderPixelRatio(cssViewport.width, cssViewport.height);
      const viewport = page.getViewport({
        scale: zoom * pixelRatio,
        rotation: page.rotate + rotation,
      });
      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));

      // Render into an offscreen bitmap and copy it in one go. Resizing the
      // visible canvas first would blank the page for the whole render, which
      // is exactly the flicker you see when zooming a heavy document.
      const scratch = document.createElement('canvas');
      scratch.width = width;
      scratch.height = height;
      const scratchContext = scratch.getContext('2d', { alpha: false });
      if (!scratchContext) return;
      scratchContext.fillStyle = '#ffffff';
      scratchContext.fillRect(0, 0, width, height);
      try {
        task = page.render({ canvasContext: scratchContext, viewport });
      } catch {
        setRenderError('This page could not be rendered.');
        return;
      }
      task.promise
        .then(() => {
          if (cancelled || !canvasRef.current) return;
          const visible = canvasRef.current.getContext('2d', { alpha: false });
          if (!visible) return;
          if (canvasRef.current.width !== width || canvasRef.current.height !== height) {
            canvasRef.current.width = width;
            canvasRef.current.height = height;
          }
          visible.drawImage(scratch, 0, 0);
          scratch.width = 0;
          scratch.height = 0;
          hasBitmap.current = true;
          setRendered(true);
          setRenderError(null);
        })
        .catch((error: unknown) => {
          scratch.width = 0;
          scratch.height = 0;
          const name = (error as { name?: string })?.name;
          if (name !== 'RenderingCancelledException' && !cancelled) {
            setRenderError('This page could not be rendered.');
          }
        });
    };

    if (hasBitmap.current) {
      timer = window.setTimeout(paint, RENDER_SETTLE_MS);
    } else {
      paint();
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      task?.cancel();
    };
  }, [page, rotation, zoom, geometry.height, geometry.width]);

  // The text layer is built once at the page's natural scale and then scaled
  // with a CSS transform. Rebuilding it for every zoom step is one of the most
  // expensive things a PDF reader can do while the user is scrolling or zooming.
  useEffect(() => {
    const container = textLayerRef.current;
    if (!page || !container) return;
    let cancelled = false;
    let layer: TextLayer | null = null;
    container.replaceChildren();
    const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
    container.style.setProperty('--scale-factor', '1');
    container.style.width = `${baseViewport.width}px`;
    container.style.height = `${baseViewport.height}px`;
    container.style.transform = `scale(${zoom})`;

    getPageTextContent(page)
      .then((textContent) => {
        if (cancelled || !textLayerRef.current) return;
        // Image-only (scanned) pages have nothing to select; skip the layer.
        if (!textContent.items || textContent.items.length === 0) return;
        layer = new TextLayer({
          textContentSource: textContent,
          container: textLayerRef.current,
          viewport: baseViewport,
        });
        return layer.render();
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      layer?.cancel();
      container.replaceChildren();
    };
  }, [page, rotation]);

  useEffect(() => {
    const container = textLayerRef.current;
    if (!container || !page) return;
    container.style.transform = `scale(${zoom})`;
  }, [page, zoom]);

  const buildHighlight = useCallback(() => {
    if (tool !== 'highlight' || !page || !displayViewport || !pageRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const anchor = selection.anchorNode;
    const anchorElement =
      anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
    const textLayer = textLayerRef.current;
    if (!textLayer || !anchorElement || !textLayer.contains(anchorElement)) return;

    const pageBounds = pageRef.current.getBoundingClientRect();
    const range = selection.getRangeAt(0);
    const clientRects = Array.from(range.getClientRects());
    const pdfRects: PdfRect[] = [];
    for (const rect of clientRects) {
      const left = Math.max(rect.left, pageBounds.left);
      const top = Math.max(rect.top, pageBounds.top);
      const right = Math.min(rect.right, pageBounds.right);
      const bottom = Math.min(rect.bottom, pageBounds.bottom);
      if (right - left < 1.5 || bottom - top < 1.5) continue;
      const local = {
        left: left - pageBounds.left,
        top: top - pageBounds.top,
        width: right - left,
        height: bottom - top,
      };
      pdfRects.push(screenRectToPdf(displayViewport, local));
    }
    if (pdfRects.length === 0) return;
    const merged: PdfRect[] = [];
    for (const rect of pdfRects) {
      const duplicate = merged.find((existing) => {
        const overlapX = Math.max(
          0,
          Math.min(existing.x + existing.width, rect.x + rect.width) -
            Math.max(existing.x, rect.x),
        );
        const overlapY = Math.max(
          0,
          Math.min(existing.y + existing.height, rect.y + rect.height) -
            Math.max(existing.y, rect.y),
        );
        return (
          overlapX > Math.min(existing.width, rect.width) * 0.8 &&
          overlapY > Math.min(existing.height, rect.height) * 0.45
        );
      });
      if (duplicate) {
        const left = Math.min(duplicate.x, rect.x);
        const bottom = Math.min(duplicate.y, rect.y);
        const right = Math.max(duplicate.x + duplicate.width, rect.x + rect.width);
        const top = Math.max(duplicate.y + duplicate.height, rect.y + rect.height);
        duplicate.x = left;
        duplicate.y = bottom;
        duplicate.width = right - left;
        duplicate.height = top - bottom;
      } else {
        merged.push({ ...rect });
      }
    }
    addAnnotation({
      id: createAnnotationId('highlight'),
      kind: 'highlight',
      page: pageNumber,
      rects: merged,
      color: useFolio.getState().highlightColor,
      createdAt: Date.now(),
    });
    selection.removeAllRanges();
  }, [addAnnotation, displayViewport, page, pageNumber, tool]);

  const handlePointerDown = async (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const pageElement = pageRef.current;
    if (!pageElement || !displayViewport) return;

    if (tool === 'select') {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-annotation-id]')) selectAnnotation(null);
      return;
    }

    if (tool === 'highlight') return;

    if (tool === 'pen') {
      event.preventDefault();
      const local = pointerToPageLocal(event, pageElement);
      const pdf = screenPointToPdf(displayViewport, local);
      const pdfPoint = { x: pdf.x, y: pdf.y };
      const width = Math.max(0.6, useFolio.getState().inkWidth / displayViewport.scale);
      const draft: InkAnnotation = {
        id: createAnnotationId('ink'),
        kind: 'ink',
        page: pageNumber,
        points: [pdfPoint],
        color: useFolio.getState().inkColor,
        width,
        createdAt: Date.now(),
      };
      draftRef.current = draft;
      setDraftInk(draft);
      drawingPointer.current = event.pointerId;
      pageElement.setPointerCapture(event.pointerId);
      return;
    }

    if (tool === 'note') {
      event.preventDefault();
      const local = pointerToPageLocal(event, pageElement);
      const point = screenPointToPdf(displayViewport, local);
      const width = 178;
      const height = 108;
      const id = createAnnotationId('note');
      addAnnotation({
        id,
        kind: 'note',
        page: pageNumber,
        rect: { x: point.x - 10, y: point.y - height + 16, width, height },
        text: '',
        color: '#f5e29a',
        createdAt: Date.now(),
      });
      setNoteEditor(id);
      useFolio.getState().setTool('select');
      return;
    }

    if (tool === 'signature') {
      event.preventDefault();
      const state = useFolio.getState();
      const signature = state.signatures.find((asset) => asset.id === state.activeSignatureId);
      if (!signature) {
        state.setSignatureDialogOpen(true);
        return;
      }
      const local = pointerToPageLocal(event, pageElement);
      const point = screenPointToPdf(displayViewport, local);
      const aspect = signature.width && signature.height ? signature.width / signature.height : 3;
      const pageWidthInPoints = displayViewport.width / displayViewport.scale;
      const width = clamp(pageWidthInPoints * 0.3, 110, 220);
      const height = width / Math.max(0.4, aspect);
      addAnnotation({
        id: createAnnotationId('signature'),
        kind: 'signature',
        page: pageNumber,
        rect: {
          x: point.x - width / 2,
          y: point.y - height / 2,
          width,
          height,
        },
        signatureId: signature.id,
        image: signature.image,
        createdAt: Date.now(),
      });
      showToast('Signature placed. Click again to reuse it.', 'success');
      return;
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== 'pen' || drawingPointer.current !== event.pointerId || !draftRef.current) return;
    if (!displayViewport || !pageRef.current) return;
    const local = pointerToPageLocal(event, pageRef.current);
    const point = screenPointToPdf(displayViewport, local);
    const pdfPoint = { x: point.x, y: point.y };
    const points = draftRef.current.points;
    const previous = points[points.length - 1];
    if (previous && Math.hypot(previous.x - pdfPoint.x, previous.y - pdfPoint.y) < 0.6) return;
    const next = { ...draftRef.current, points: [...points, pdfPoint] };
    draftRef.current = next;
    setDraftInk(next);
  };

  const finishDrawing = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== 'pen' || drawingPointer.current !== event.pointerId) return;
    const draft = draftRef.current;
    if (pageRef.current?.hasPointerCapture(event.pointerId)) {
      pageRef.current.releasePointerCapture(event.pointerId);
    }
    drawingPointer.current = null;
    draftRef.current = null;
    setDraftInk(null);
    if (draft && draft.points.length > 0) addAnnotation(draft);
  };

  const pageCursorClass =
    tool === 'pen'
      ? 'cursor-pen'
      : tool === 'highlight'
        ? 'cursor-highlight'
        : tool === 'note'
          ? 'cursor-note'
          : tool === 'signature'
            ? 'cursor-signature'
            : 'cursor-select';

  return (
    <div
      ref={pageRef}
      className={`pdf-page ${theme === 'dark' ? 'pdf-page-dark' : ''} ${pageCursorClass}`}
      style={{ width: size.width * zoom, height: size.height * zoom }}
      data-page={pageNumber}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrawing}
      onPointerCancel={finishDrawing}
      onMouseUp={buildHighlight}
      aria-label={`Page ${pageNumber}`}
    >
      <div className="page-surface">
        <canvas
          ref={canvasRef}
          className={`page-canvas ${theme === 'dark' ? 'dark-page-image' : ''}`}
        />
        {!rendered && (
          <div className="page-placeholder">
            <div className="page-skeleton-line wide" />
            <div className="page-skeleton-line" />
            <div className="page-skeleton-line short" />
            {renderError && <span className="page-render-error">{renderError}</span>}
          </div>
        )}
        <div
          ref={textLayerRef}
          className={`text-layer ${tool === 'select' || tool === 'highlight' ? 'interactive' : ''}`}
        />
        {displayViewport && (
          <AnnotationLayer
            pageNumber={pageNumber}
            viewport={displayViewport}
            pageElement={pageRef.current}
            annotations={annotations}
            selectedId={selectedId}
            tool={tool}
            draftInk={draftInk}
          />
        )}
      </div>
      <div className="page-index">{pageNumber}</div>
    </div>
  );
}

/**
 * Scroll updates re-render the viewer on every page boundary. Memoizing the
 * page keeps that cheap: only the pages whose own props changed do any work.
 */
export const PdfPage = memo(PdfPageComponent);
