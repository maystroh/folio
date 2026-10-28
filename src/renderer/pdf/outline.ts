import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { OutlineEntry } from './types';

interface RawOutlineItem {
  title?: string;
  dest?: string | unknown[] | null;
  bold?: boolean;
  italic?: boolean;
  items?: RawOutlineItem[];
}

async function resolveDestinationPage(
  pdf: PDFDocumentProxy,
  dest: RawOutlineItem['dest'],
): Promise<number | null> {
  if (!dest) return null;
  try {
    const resolved = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(resolved) || resolved.length === 0) return null;
    const ref = resolved[0] as { num?: number; gen?: number } | number;
    if (typeof ref === 'number') return ref + 1;
    const index = await pdf.getPageIndex(ref as never);
    return index + 1;
  } catch {
    return null;
  }
}

export async function readOutline(pdf: PDFDocumentProxy): Promise<OutlineEntry[]> {
  let raw: RawOutlineItem[] | null = null;
  try {
    raw = (await pdf.getOutline()) as RawOutlineItem[] | null;
  } catch {
    return [];
  }
  if (!raw || raw.length === 0) return [];

  let sequence = 0;

  const walk = async (
    items: RawOutlineItem[],
    depth: number,
    parentId: string,
  ): Promise<OutlineEntry[]> => {
    const result: OutlineEntry[] = [];
    for (const item of items) {
      const id = `${parentId}-${sequence++}`;
      const children = await walk(item.items ?? [], depth + 1, id);
      const pageNumber = await resolveDestinationPage(pdf, item.dest);
      const fallbackPage = pageNumber ?? children[0]?.pageNumber ?? null;
      if (!fallbackPage) continue;
      result.push({
        id,
        title: (item.title ?? 'Untitled section').trim() || 'Untitled section',
        pageNumber: fallbackPage,
        depth,
        bold: Boolean(item.bold),
        italic: Boolean(item.italic),
        children,
      });
    }
    return result;
  };

  return walk(raw, 0, 'outline');
}
