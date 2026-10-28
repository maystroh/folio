import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import { useFolio } from '../store';
import { PdfPage } from './PdfPage';

export function PdfViewer() {
  const pdf = useFolio((state) => state.pdf);
  const pageCount = useFolio((state) => state.pageCount);
  const pageGeometries = useFolio((state) => state.pageGeometries);
  const zoom = useFolio((state) => state.zoom);
  const zoomMode = useFolio((state) => state.zoomMode);
  const rotation = useFolio((state) => state.rotation);
  const tool = useFolio((state) => state.tool);
  const annotations = useFolio((state) => state.annotations);
  const selectedId = useFolio((state) => state.selectedAnnotationId);
  const theme = useFolio((state) => state.theme);
  const currentPage = useFolio((state) => state.currentPage);
  const navigationTarget = useFolio((state) => state.navigationTarget);
  const setCurrentPage = useFolio((state) => state.setCurrentPage);
  const clearNavigationTarget = useFolio((state) => state.clearNavigationTarget);
  const fitPage = useFolio((state) => state.fitPage);
  const setZoom = useFolio((state) => state.setZoom);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pageElements = useRef(new Map<number, HTMLDivElement>());
  const scrollFrame = useRef<number | null>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [pageCache, setPageCache] = useState<Map<number, PDFPageProxy>>(new Map());

  useEffect(() => {
    setScrollRoot(scrollRef.current);
  }, []);

  const registerPage = useCallback((page: number, element: HTMLDivElement | null) => {
    if (element) pageElements.current.set(page, element);
    else pageElements.current.delete(page);
  }, []);

  const handlePageReady = useCallback((pageNumber: number, page: PDFPageProxy) => {
    setPageCache((current) => {
      if (current.get(pageNumber) === page) return current;
      const next = new Map(current);
      next.set(pageNumber, page);
      return next;
    });
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setViewportSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    setViewportSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || zoomMode !== 'fit-page' || viewportSize.width === 0) return;
    const frame = window.requestAnimationFrame(() => {
      fitPage(viewportSize.width, viewportSize.height);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    currentPage,
    fitPage,
    pageGeometries[currentPage - 1]?.height,
    pageGeometries[currentPage - 1]?.width,
    pdf,
    rotation,
    viewportSize.height,
    viewportSize.width,
    zoomMode,
  ]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !navigationTarget) return;
    const pageElement = pageElements.current.get(navigationTarget.page);
    if (!pageElement) return;
    const targetTop = Math.max(0, pageElement.offsetTop - 12);
    scroll.scrollTo({ top: targetTop, behavior: 'smooth' });
    const timeout = window.setTimeout(() => {
      clearNavigationTarget(navigationTarget.nonce);
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [clearNavigationTarget, navigationTarget]);

  const updateVisiblePage = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll || !pageCount) return;
    const probe = scroll.scrollTop + Math.min(scroll.clientHeight * 0.3, 220);
    let active = 1;
    for (let page = 1; page <= pageCount; page += 1) {
      const element = pageElements.current.get(page);
      if (!element) continue;
      if (element.offsetTop <= probe) active = page;
      else break;
    }
    if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 4) active = pageCount;
    setCurrentPage(active);
  }, [pageCount, setCurrentPage]);

  const handleScroll = () => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      updateVisiblePage();
    });
  };

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const state = useFolio.getState();
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      state.setZoom(state.zoom * factor);
    };
    scroll.addEventListener('wheel', onWheel, { passive: false });
    return () => scroll.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  useEffect(() => {
    updateVisiblePage();
  }, [pageCount, updateVisiblePage, zoom]);

  if (!pdf) return null;

  return (
    <div className="viewer-scroll" ref={scrollRef} onScroll={handleScroll}>
      <div className="pages-stack">
        {Array.from({ length: pageCount }, (_, index) => {
          const pageNumber = index + 1;
          const geometry = pageGeometries[index] ?? { width: 612, height: 792, rotate: 0 };
          const pageAnnotations = annotations.filter((annotation) => annotation.page === pageNumber);
          return (
            <PdfPage
              key={pageNumber}
              pageNumber={pageNumber}
              geometry={geometry}
              pdfPage={pageCache.get(pageNumber) ?? null}
              zoom={zoom}
              rotation={rotation}
              tool={tool}
              annotations={pageAnnotations}
              selectedId={selectedId}
              theme={theme}
              scrollRoot={scrollRoot}
              registerPage={registerPage}
              onPageReady={handlePageReady}
            />
          );
        })}
      </div>
    </div>
  );
}
