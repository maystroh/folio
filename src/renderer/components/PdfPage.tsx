import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

interface PdfPageProps {
  pageNumber: number;
  geometry: PageGeometry;
  pdfPage: PDFPageProxy | null;
  zoom: number;
  rotation: number;
  tool: 'select' | 'highlight' | 'pen' | 'note' | 'signature';
  annotations: import('../annotations/types').Annotation[];
  selectedId: string | null;
  theme: 'light' | 'dark';
  scrollRoot: HTMLElement | null;
  registerPage: (page: number, element: HTMLDivElement | null) => void;
  onPageReady: (pageNumber: number, loadedPage: PDFPageProxy) => void;
}

function viewportFor(page: PDFPageProxy, zoom: number, rotation: number): PageViewport {
  return page.getViewport({ scale: zoom, rotation: page.rotate + rotation });
}

export function PdfPage({
  pageNumber,
  geometry,
  pdfPage: initialPage,
  zoom,
  rotation,
  tool,
  annotations,
  selectedId,
  theme,
  scrollRoot,
  registerPage,
  onPageReady,
}: PdfPageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(initialPage);
  const [nearViewport, setNearViewport] = useState(pageNumber <= 3);
  const [rendered, setRendered] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const draftRef = useRef<InkAnnotation | null>(null);
  const [draftInk, setDraftInk] = useState<InkAnnotation | null>(null);
  const drawingPointer = useRef<number | null>(null);
  const size = pageDisplaySize(geometry.width, geometry.height, rotation);

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
    registerPage(pageNumber, pageRef.current);
    return () => registerPage(pageNumber, null);
  }, [pageNumber, registerPage]);

  useEffect(() => {
    if (!scrollRoot || !pageRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setNearViewport(true);
          else setNearViewport(false);
        }
      },
      { root: scrollRoot, rootMargin: '1300px 0px 1300px 0px', threshold: 0.001 },
    );
    observer.observe(pageRef.current);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    if (nearViewport) return;
    // Release the bitmap for pages that have been left well behind. Keeping
    // hundreds of high-resolution canvases alive would make large PDFs heavy.
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    setRendered(false);
    textLayerRef.current?.replaceChildren();
  }, [nearViewport]);

  useEffect(() => {
    if (!nearViewport || page) return;
    let cancelled = false;
    const pdf = useFolio.getState().pdf;
    if (!pdf) return;
    pdf
      .getPage(pageNumber)
      .then((loaded) => {
        if (cancelled) return;
        setPage(loaded);
        onPageReady(pageNumber, loaded);
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
  }, [nearViewport, onPageReady, page, pageNumber, setPageGeometry]);

  useEffect(() => {
    if (!page || !canvasRef.current || !nearViewport) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    setRendered(false);
    setRenderError(null);
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;

    const maxDimension = Math.max(geometry.width, geometry.height) * zoom;
    const pixelRatio = Math.min(
      Math.max(window.devicePixelRatio || 1, 1),
      2,
      Math.max(1, 4096 / Math.max(1, maxDimension)),
    );
    const viewport = page.getViewport({
      scale: zoom * pixelRatio,
      rotation: page.rotate + rotation,
    });
    const cssViewport = page.getViewport({ scale: zoom, rotation: page.rotate + rotation });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${cssViewport.width}px`;
    canvas.style.height = `${cssViewport.height}px`;
    context.save();
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();

    renderTask = page.render({ canvasContext: context, viewport });
    renderTask.promise
      .then(() => {
        if (!cancelled) setRendered(true);
      })
      .catch((error: unknown) => {
        const name = (error as { name?: string })?.name;
        if (name !== 'RenderingCancelledException' && !cancelled) {
          setRenderError('This page could not be rendered.');
        }
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [geometry.height, geometry.width, nearViewport, page, rotation, zoom]);

  useEffect(() => {
    if (!page || !textLayerRef.current || !nearViewport) return;
    let cancelled = false;
    let layer: TextLayer | null = null;
    const container = textLayerRef.current;
    container.replaceChildren();
    const viewport = viewportFor(page, zoom, rotation);
    container.style.setProperty('--scale-factor', String(viewport.scale));

    page
      .getTextContent()
      .then((textContent) => {
        if (cancelled || !textLayerRef.current) return;
        layer = new TextLayer({
          textContentSource: textContent,
          container: textLayerRef.current,
          viewport,
        });
        return layer.render();
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      layer?.cancel();
      container.replaceChildren();
    };
  }, [nearViewport, page, rotation, zoom]);

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


