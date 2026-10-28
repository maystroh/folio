import { ListTree } from 'lucide-react';
import { useFolio } from '../store';
import type { OutlineEntry } from '../pdf/types';

function OutlineRow({ entry }: { entry: OutlineEntry }) {
  const currentPage = useFolio((state) => state.currentPage);
  const goToPage = useFolio((state) => state.goToPage);
  return (
    <li className="outline-node">
      <button
        type="button"
        className={`outline-row ${entry.pageNumber === currentPage ? 'current' : ''}`}
        style={{ paddingLeft: `${16 + entry.depth * 16}px` }}
        onClick={() => goToPage(entry.pageNumber)}
        title={`Page ${entry.pageNumber}`}
      >
        <span
          className="outline-title"
          style={{
            fontWeight: entry.bold ? 650 : 450,
            fontStyle: entry.italic ? 'italic' : 'normal',
          }}
        >
          {entry.title}
        </span>
        <span className="outline-page">{entry.pageNumber}</span>
      </button>
      {entry.children.length > 0 && (
        <ul className="outline-children">
          {entry.children.map((child) => (
            <OutlineRow key={child.id} entry={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OutlinePanel() {
  const outline = useFolio((state) => state.outline);

  if (outline.length === 0) {
    return (
      <div className="sidebar-empty">
        <ListTree size={24} strokeWidth={1.4} />
        <p>No contents in this document</p>
        <span>Bookmarks added to the PDF will appear here.</span>
      </div>
    );
  }

  return (
    <div className="outline-scroll">
      <ul className="outline-tree">
        {outline.map((entry) => (
          <OutlineRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </div>
  );
}
