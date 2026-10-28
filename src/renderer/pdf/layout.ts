/**
 * Layout math for the continuous page scroller.
 *
 * The reader is virtualized: only the pages around the viewport exist in the
 * DOM. Every scroll position, "current page" lookup and jump target is derived
 * from this arithmetic instead of from live DOM measurements, which keeps
 * scrolling free of forced layouts and O(n) work per frame.
 */

/** Vertical space reserved between two pages (CSS: page margin-bottom). */
export const PAGE_GAP = 44;
export const STACK_PAD_TOP = 30;
export const STACK_PAD_BOTTOM = 98;

export interface PageBox {
  width: number;
  height: number;
  rotate: number;
}

export const DEFAULT_PAGE_BOX: PageBox = { width: 612, height: 792, rotate: 0 };

/** Documents below this size are mounted in full; virtualization only pays off above it. */
export const VIRTUALIZE_ABOVE = 16;

export interface PageLayout {
  /** CSS height of every page at the current zoom. */
  heights: Float64Array;
  /** CSS top offset of every page, relative to the top of the scroll content. */
  tops: Float64Array;
  /** Total scrollable height, including paddings. */
  contentHeight: number;
  /** Zero-based index of the page containing `offset`. */
  pageAt: (offset: number) => number;
  /** Inclusive zero-based range of pages that intersect the window plus overscan. */
  rangeFor: (scrollTop: number, viewportHeight: number, overscan: number) => [number, number];
}

function displayHeight(box: PageBox, rotation: number): number {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized === 90 || normalized === 270 ? box.width : box.height;
}

function displayWidth(box: PageBox, rotation: number): number {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized === 90 || normalized === 270 ? box.height : box.width;
}

export function pageCssSize(
  box: PageBox,
  rotation: number,
  zoom: number,
): { width: number; height: number } {
  return { width: displayWidth(box, rotation) * zoom, height: displayHeight(box, rotation) * zoom };
}

export function buildPageLayout(
  geometries: PageBox[],
  pageCount: number,
  zoom: number,
  rotation: number,
): PageLayout {
  const count = Math.max(0, pageCount);
  const heights = new Float64Array(count);
  const tops = new Float64Array(count);
  let cursor = STACK_PAD_TOP;
  for (let index = 0; index < count; index += 1) {
    const box = geometries[index] ?? DEFAULT_PAGE_BOX;
    const height = Math.max(1, displayHeight(box, rotation) * zoom);
    heights[index] = height;
    tops[index] = cursor;
    cursor += height + PAGE_GAP;
  }
  const contentHeight = count === 0 ? STACK_PAD_TOP + STACK_PAD_BOTTOM : cursor + STACK_PAD_BOTTOM;

  const pageAt = (offset: number): number => {
    if (count === 0) return 0;
    // Last page whose top is at or above the offset.
    let low = 0;
    let high = count - 1;
    let found = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (tops[mid] <= offset) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  };

  const rangeFor = (
    scrollTop: number,
    viewportHeight: number,
    overscan: number,
  ): [number, number] => {
    if (count === 0) return [0, -1];
    const from = scrollTop - overscan;
    const to = scrollTop + viewportHeight + overscan;
    const start = pageAt(Math.max(0, from));
    let end = start;
    while (end < count - 1 && tops[end + 1] <= to) end += 1;
    // Guarantee that at least one page is mounted even for absurd viewport math.
    const safeStart = Math.min(start, count - 1);
    return [safeStart, Math.max(safeStart, Math.min(end, count - 1))];
  };

  return { heights, tops, contentHeight, pageAt, rangeFor };
}

/** Space to reserve above the first mounted page. */
export function spaceBefore(layout: PageLayout, start: number): number {
  return Math.max(0, layout.tops[start] - STACK_PAD_TOP);
}

/** Space to reserve below the last mounted page. */
export function spaceAfter(layout: PageLayout, end: number): number {
  const pageBottom = layout.tops[end] + layout.heights[end] + PAGE_GAP;
  const flowBottom = layout.contentHeight - STACK_PAD_BOTTOM;
  return Math.max(0, flowBottom - pageBottom);
}

/**
 * The point of the document that currently sits at the top of the viewport,
 * expressed as a page index plus a fraction of that page. Used to keep the
 * same spot under the reader while zooming or rotating.
 */
export function anchorAt(layout: PageLayout, scrollTop: number): { index: number; fraction: number } | null {
  if (layout.tops.length === 0) return null;
  const index = Math.min(Math.max(0, layout.pageAt(scrollTop + 1)), layout.tops.length - 1);
  const height = layout.heights[index];
  const fraction =
    height > 0 ? Math.min(1, Math.max(0, (scrollTop + 1 - layout.tops[index]) / height)) : 0;
  return { index, fraction };
}
