import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useFolio } from '../store';
import { pageDisplaySize } from '../pdf/geometry';

const THUMB_WIDTH = 132;
const THUMB_MAX_HEIGHT = 178;
/** Item chrome: padding 6 + 5, gap 6, page number line 14. */
const ITEM_CHROME = 31;
const ITEM_GAP = 10;
const VIRTUALIZE_ABOVE = 24;

interface ThumbnailProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  rotation: number;
  frameHeight: number;
  active: boolean;
  theme: 'light' | 'dark';
  onClick: () => void;
}

function Thumbnail({
  pdf,
  pageNumber,
  rotation,
  frameHeight,
  active,
  theme,
  onClick,
}: ThumbnailProps) {
  const wrapperRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled || !canvasRef.current) return;
      const base = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
      const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5);
      const scale = (THUMB_WIDTH / base.width) * pixelRatio;
      const viewport = page.getViewport({ scale, rotation: page.rotate + rotation });
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
  }, [pageNumber, pdf, rotation]);

  return (
    <button
      type="button"
      ref={wrapperRef}
      className={`thumbnail-item ${active ? 'active' : ''}`}
      onClick={onClick}
      data-thumb-page={pageNumber}
      aria-current={active ? 'page' : undefined}
      title={`Go to page ${pageNumber}`}
      style={{ height: frameHeight + ITEM_CHROME }}
    >
      <span
        className={`thumbnail-frame ${theme === 'dark' ? 'dark' : ''}`}
        style={{ height: frameHeight }}
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
  const frameRef = useRef<number | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [range, setRange] = useState<{ start: number; end: number }>({ start: 0, end: -1 });

  const layout = useMemo(() => {
    const frameHeights = new Float64Array(pageCount);
    const tops = new Float64Array(pageCount);
    let cursor = 0;
    for (let index = 0; index < pageCount; index += 1) {
      const geometry = pageGeometries[index] ?? { width: 612, height: 792, rotate: 0 };
      const size = pageDisplaySize(geometry.width, geometry.height, rotation);
      const frameHeight = Math.min(THUMB_WIDTH * (size.height / size.width), THUMB_MAX_HEIGHT);
      frameHeights[index] = frameHeight;
      tops[index] = cursor;
      cursor += frameHeight + ITEM_CHROME + ITEM_GAP;
    }
    return { frameHeights, tops, total: cursor };
  }, [pageCount, pageGeometries, rotation]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const syncRange = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (layoutRef.current.tops.length === 0) return;
    const top = scroll.scrollTop;
    const height = scroll.clientHeight;
    const overscan = 700;
    const tops = layoutRef.current.tops;
    let start = 0;
    // Last item whose top is above the overscan start.
    let low = 0;
    let high = tops.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (tops[mid] <= Math.max(0, top - overscan)) {
        start = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    let end = start;
    const limit = top + height + overscan;
    while (end < tops.length - 1 && tops[end + 1] <= limit) end += 1;
    setRange((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  }, []);

  const handleScroll = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      syncRange();
    });
  }, [syncRange]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    syncRange();
  }, [layout, syncRange, viewportHeight]);

  // Keep the active page visible without fighting the user's own scrolling and
  // without a smooth-scroll animation on every page turn.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || pageCount === 0) return;
    const index = currentPage - 1;
    const top = layoutRef.current.tops[index] ?? 0;
    const bottom = top + layoutRef.current.frameHeights[index] + ITEM_CHROME;
    if (top < scroll.scrollTop || bottom > scroll.scrollTop + scroll.clientHeight) {
      scroll.scrollTop = Math.max(0, top - scroll.clientHeight / 2 + 60);
      syncRange();
    }
  }, [currentPage, pageCount, syncRange]);

  if (!pdf) return null;

  const virtualize = pageCount > VIRTUALIZE_ABOVE;
  const start = virtualize ? Math.min(range.start, pageCount - 1) : 0;
  const end = virtualize ? Math.min(Math.max(range.end, start), pageCount - 1) : pageCount - 1;
  const before = virtualize ? layout.tops[start] ?? 0 : 0;
  const after = virtualize
    ? Math.max(
        0,
        layout.total - ((layout.tops[end] ?? 0) + layout.frameHeights[end] + ITEM_CHROME + ITEM_GAP),
      )
    : 0;

  const items = [];
  for (let pageNumber = start + 1; pageNumber <= end + 1; pageNumber += 1) {
    items.push(
      <Thumbnail
        key={pageNumber}
        pdf={pdf}
        pageNumber={pageNumber}
        rotation={rotation}
        frameHeight={layout.frameHeights[pageNumber - 1]}
        active={currentPage === pageNumber}
        theme={theme}
        onClick={() => goToPage(pageNumber)}
      />,
    );
  }

  return (
    <div className="thumbnail-scroll" ref={scrollRef} onScroll={handleScroll}>
      <div className="thumbnail-grid">
        {before > 0 && <div className="thumbnail-spacer" style={{ height: before }} />}
        {items}
        {after > 0 && <div className="thumbnail-spacer" style={{ height: after }} />}
      </div>
    </div>
  );
}
