import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { Annotation } from '../annotations/types';
import { AnnotationLayer } from './AnnotationLayer';

const CONTENT_WIDTH_PX = 7.5 * 96;
const CONTENT_HEIGHT_PX = 10 * 96;

interface PrintPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  rotation: number;
  annotations: Annotation[];
  active: boolean;
  onRendered: (pageNumber: number) => void;
}

function PrintPage({
  pdf,
  pageNumber,
  rotation,
  annotations,
  active,
  onRendered,
}: PrintPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [error, setError] = useState(false);
  const reported = useRef(false);

  useEffect(() => {
    if (!active || page) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      pdf
        .getPage(pageNumber)
        .then((loaded) => {
          if (!cancelled) setPage(loaded);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    }, 20);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, page, pageNumber, pdf]);

  const { scale, viewport } = useMemo(() => {
    if (!page) {
      return { scale: 1, viewport: null };
    }
    const base = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
    const nextScale = Math.min(
      CONTENT_WIDTH_PX / base.width,
      CONTENT_HEIGHT_PX / base.height,
      2.2,
    );
    return {
      scale: nextScale,
      viewport: page.getViewport({ scale: nextScale, rotation: page.rotate + rotation }),
    };
  }, [page, rotation]);

  useEffect(() => {
    if (!page || !viewport || !canvasRef.current || !active) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      onRendered(pageNumber);
      return;
    }
    // Print content is 7.5 x 10 inches. 1.5x gives about 144 DPI, which is
    // crisper than screen output without turning every page into a huge bitmap.
    const pixelRatio = 1.5;
    const renderViewport = page.getViewport({
      scale: scale * pixelRatio,
      rotation: page.rotate + rotation,
    });
    canvas.width = Math.max(1, Math.floor(renderViewport.width));
    canvas.height = Math.max(1, Math.floor(renderViewport.height));
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    task = page.render({ canvasContext: context, viewport: renderViewport });
    task.promise
      .then(() => {
        if (cancelled || reported.current) return;
        reported.current = true;
        onRendered(pageNumber);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const name = (caught as { name?: string })?.name;
        if (name === 'RenderingCancelledException') return;
        if (!reported.current) {
          reported.current = true;
          onRendered(pageNumber);
        }
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [active, onRendered, page, pageNumber, rotation, scale, viewport]);

  return (
    <div className="print-sheet">
      <div
        className="print-page"
        style={{
          width: viewport?.width ?? 612,
          height: viewport?.height ?? 792,
          background: '#ffffff',
        }}
      >
        <canvas ref={canvasRef} className="print-canvas" />
        {viewport && (
          <AnnotationLayer
            pageNumber={pageNumber}
            viewport={viewport}
            pageElement={null}
            annotations={annotations.filter((annotation) => annotation.page === pageNumber)}
            selectedId={null}
            tool="select"
            draftInk={null}
          />
        )}
        {(!page || !viewport) && !error && <div className="print-placeholder" />}
        {error && <div className="print-error">Page {pageNumber} could not be prepared for printing.</div>}
      </div>
    </div>
  );
}

interface PrintDeckProps {
  pdf: PDFDocumentProxy;
  pageCount: number;
  rotation: number;
  annotations: Annotation[];
  onReady: () => void;
  onProgress: (rendered: number, total: number) => void;
}

export function PrintDeck({
  pdf,
  pageCount,
  rotation,
  annotations,
  onReady,
  onProgress,
}: PrintDeckProps) {
  const [renderedCount, setRenderedCount] = useState(0);
  const [activeLimit, setActiveLimit] = useState(3);
  const readySent = useRef(false);
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  const handleRendered = useCallback((pageNumber: number) => {
    setRenderedCount((count) => count + 1);
    setActiveLimit((limit) => Math.max(limit, pageNumber + 1));
  }, []);

  useEffect(() => {
    progressRef.current(renderedCount, pageCount);
    if (renderedCount >= pageCount && !readySent.current) {
      readySent.current = true;
      const timer = window.setTimeout(() => readyRef.current(), 300);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [pageCount, renderedCount]);

  return (
    <div className="print-deck" aria-hidden="true">
      {Array.from({ length: pageCount }, (_, index) => (
        <PrintPage
          key={index + 1}
          pdf={pdf}
          pageNumber={index + 1}
          rotation={rotation}
          annotations={annotations}
          active={index + 1 <= activeLimit}
          onRendered={handleRendered}
        />
      ))}
    </div>
  );
}
