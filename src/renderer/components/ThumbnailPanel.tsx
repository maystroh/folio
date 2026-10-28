import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useFolio } from '../store';
import type { PageGeometry } from '../store';
import { pageDisplaySize } from '../pdf/geometry';

interface ThumbnailProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  geometry: PageGeometry;
  rotation: number;
  active: boolean;
  theme: 'light' | 'dark';
  scrollRoot: HTMLElement | null;
  onClick: () => void;
}

function Thumbnail({
  pdf,
  pageNumber,
  geometry,
  rotation,
  active,
  theme,
  scrollRoot,
  onClick,
}: ThumbnailProps) {
  const wrapperRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 5);
  const [rendered, setRendered] = useState(false);
  const displaySize = pageDisplaySize(geometry.width, geometry.height, rotation);

  useEffect(() => {
    if (!scrollRoot || !wrapperRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { root: scrollRoot, rootMargin: '500px 0px', threshold: 0.001 },
    );
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setRendered(false);
    setRendered(false);
    const render = async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
      const scale = Math.min(132 / base.width, 178 / base.height);
      const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      const viewport = page.getViewport({
        scale: scale * pixelRatio,
        rotation: page.rotate + rotation,
      });
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return;
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.aspectRatio = `${base.width} / ${base.height}`;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      task = page.render({ canvasContext: context, viewport });
      await task.promise;
      if (!cancelled) setRendered(true);
    };
    void render().catch((error: unknown) => {
      if ((error as { name?: string })?.name !== 'RenderingCancelledException') setRendered(true);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pageNumber, pdf, rotation, visible]);

  useEffect(() => {
    if (active) wrapperRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  return (
    <button
      type="button"
      ref={wrapperRef}
      className={`thumbnail-item ${active ? 'active' : ''}`}
      onClick={onClick}
      data-thumb-page={pageNumber}
      aria-current={active ? 'page' : undefined}
      title={`Go to page ${pageNumber}`}
    >
      <span
        className={`thumbnail-frame ${theme === 'dark' ? 'dark' : ''}`}
        style={{ aspectRatio: `${displaySize.width} / ${displaySize.height}` }}
      >
        <canvas
          ref={canvasRef}
          className={`thumbnail-canvas ${theme === 'dark' ? 'dark-page-image' : ''} ${
            rendered ? 'ready' : ''
          }`}
        />
        {!rendered && <span className="thumbnail-skeleton" />}
      </span>
      <span className="thumbnail-number">{pageNumber}</span>
    </button>
  );
}

export function ThumbnailPanel() {
  const pdf = useFolio((state) => state.pdf);
  const pageCount = useFolio((state) => state.pageCount);
  const pageGeometries = useFolio((state) => state.pageGeometries);
  const currentPage = useFolio((state) => state.currentPage);
  const rotation = useFolio((state) => state.rotation);
  const theme = useFolio((state) => state.theme);
  const goToPage = useFolio((state) => state.goToPage);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);

  useEffect(() => setScrollRoot(scrollRef.current), []);

  if (!pdf) return null;

  return (
    <div className="thumbnail-scroll" ref={scrollRef}>
      <div className="thumbnail-grid">
        {Array.from({ length: pageCount }, (_, index) => {
          const pageNumber = index + 1;
          return (
            <Thumbnail
              key={pageNumber}
              pdf={pdf}
              pageNumber={pageNumber}
              geometry={pageGeometries[index] ?? { width: 612, height: 792, rotate: 0 }}
              rotation={rotation}
              active={currentPage === pageNumber}
              theme={theme}
              scrollRoot={scrollRoot}
              onClick={() => goToPage(pageNumber)}
            />
          );
        })}
      </div>
    </div>
  );
}
