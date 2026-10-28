import { PanelLeftClose } from 'lucide-react';
import { useFolio } from '../store';
import { ThumbnailPanel } from './ThumbnailPanel';
import { OutlinePanel } from './OutlinePanel';

export function Sidebar() {
  const sidebarTab = useFolio((state) => state.sidebarTab);
  const setSidebarTab = useFolio((state) => state.setSidebarTab);
  const toggleSidebar = useFolio((state) => state.toggleSidebar);
  const pageCount = useFolio((state) => state.pageCount);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-tabs" role="tablist" aria-label="Sidebar view">
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'thumbnails'}
            className={sidebarTab === 'thumbnails' ? 'active' : ''}
            onClick={() => setSidebarTab('thumbnails')}
          >
            Pages
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'outline'}
            className={sidebarTab === 'outline' ? 'active' : ''}
            onClick={() => setSidebarTab('outline')}
          >
            Contents
          </button>
        </div>
        <button
          type="button"
          className="icon-button small"
          onClick={toggleSidebar}
          title="Hide sidebar"
          aria-label="Hide sidebar"
        >
          <PanelLeftClose size={15} />
        </button>
      </div>
      <div className="sidebar-content">
        {sidebarTab === 'thumbnails' ? <ThumbnailPanel /> : <OutlinePanel />}
      </div>
      <div className="sidebar-footer">
        <span>{pageCount} pages</span>
        <span className="sidebar-footer-rule" />
        <span>PDF</span>
      </div>
    </aside>
  );
}
