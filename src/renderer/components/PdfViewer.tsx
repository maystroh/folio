import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFolio } from '../store';
import type { Annotation } from '../annotations/types';
import {
  anchorAt,
  buildPageLayout,
  spaceAfter,
  spaceBefore,
  VIRTUALIZE_ABOVE,
  type PageLayout,
} from '../pdf/layout';
import { PdfPage } from './PdfPage';

const EMPTY_ANNOTATIONS: Annotation[] = [];

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [range, setRange] = useState<{ start: number; end: number }>({ start: 0, end: -1 });

  const layout = useMemo(
    () => buildPageLayout(pageGeometries, pageCount, zoom, rotation),
    [pageCount, pageGeometries, rotation, zoom],
  );
  const layoutRef = useRef<PageLayout>(layout);
  layoutRef.current = layout;

  const previousLayout = useRef(layout);
  const previousZoom = useRef(zoom);
  const previousRotation = useRef(rotation);

  const annotationsByPage = useMemo(() => {
    const grouped = new Map<number, Annotation[]>();
    for (const annotation of annotations) {
      const list = grouped.get(annotation.page);
      if (list) list.push(annotation);
      else grouped.set(annotation.page, [annotation]);
    }
    return grouped;
  }, [annotations]);

  const syncViewportState = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const active = layoutRef.current;
    const top = scroll.scrollTop;
    const overscan = Math.max(1600, scroll.clientHeight * 1.2);
    const next = active.rangeFor(top, scroll.clientHeight, overscan);
    setRange((current) =>
      current.start === next[0] && current.end === next[1]
        ? current
        : { start: next[0], end: next[1] },
    );

    let page = active.pageAt(top + Math.min(scroll.clientHeight * 0.3, 220)) + 1;
    if (top + scroll.clientHeight >= scroll.scrollHeight - 4) page = pageCount;
    setCurrentPage(page);
  }, [pageCount, setCurrentPage]);

  const handleScroll = useCallback(() => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      syncViewportState();
    });
  }, [syncViewportState]);

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

  // Keep the same spot of the same page under the reader while the zoom or the
  // rotation changes. This runs before the window sync below so the scroll
  // position is already corrected when the rendered range is recomputed.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const before = previousLayout.current;
    const zoomChanged = previousZoom.current !== zoom;
    const rotationChanged = previousRotation.current !== rotation;
    previousLayout.current = layout;
    previousZoom.current = zoom;
    previousRotation.current = rotation;
    if (!scroll || (!zoomChanged && !rotationChanged) || before.tops.length === 0) return;
    const anchor = anchorAt(before, scroll.scrollTop);
    if (!anchor) return;
    const index = Math.min(anchor.index, layout.tops.length - 1);
    const target = layout.tops[index] + anchor.fraction * layout.heights[index] - 1;
    scroll.scrollTop = Math.max(0, target);
  }, [layout, rotation, zoom]);

  // Recompute the rendered window whenever the geometry of the stack changes
  // (zoom, rotation, page sizes) or the viewport resizes.
  useLayoutEffect(() => {
    syncViewportState();
  }, [layout, syncViewportState, viewportSize.height, viewportSize.width]);

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
    const active = layoutRef.current;
    if (active.tops.length === 0) return;
    const index = Math.min(Math.max(navigationTarget.page - 1, 0), active.tops.length - 1);
    const top = Math.max(0, active.tops[index] - 12);
    // Page navigation is instant on purpose: an animated scroll through a long
    // book is slower than the reader and it fights repeated key presses.
    scroll.scrollTop = top;
    syncViewportState();
    const timeout = window.setTimeout(
      () => clearNavigationTarget(navigationTarget.nonce),
      60,
    );
    return () => window.clearTimeout(timeout);
  }, [clearNavigationTarget, navigationTarget, syncViewportState]);

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
  }, []);

  if (!pdf) return null;

  const virtualize = pageCount > VIRTUALIZE_ABOVE;
  const start = virtualize ? Math.min(range.start, pageCount - 1) : 0;
  const end = virtualize ? Math.min(Math.max(range.end, start), pageCount - 1) : pageCount - 1;
  const before = virtualize ? spaceBefore(layout, start) : 0;
  const after = virtualize ? spaceAfter(layout, end) : 0;

  const pages = [];
  for (let pageNumber = start + 1; pageNumber <= end + 1; pageNumber += 1) {
    pages.push(
      <PdfPage
        key={pageNumber}
        pageNumber={pageNumber}
        geometry={pageGeometries[pageNumber - 1] ?? { width: 612, height: 792, rotate: 0 }}
        zoom={zoom}
        rotation={rotation}
        tool={tool}
        annotations={annotationsByPage.get(pageNumber) ?? EMPTY_ANNOTATIONS}
        selectedId={selectedId}
        theme={theme}
      />,
    );
  }

  return (
    <div className="viewer-scroll" ref={scrollRef} onScroll={handleScroll}>
      <div className="pages-stack">
        {before > 0 && <div className="page-spacer" style={{ height: before }} />}
        {pages}
        {after > 0 && <div className="page-spacer" style={{ height: after }} />}
      </div>
    </div>
  );
}
