import { create } from 'zustand';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  Annotation,
  AnnotationKind,
  AnnotationTool,
  SignatureAsset,
} from './annotations/types';
import type { OutlineEntry, PageSize } from './pdf/types';
import { loadPdf } from './pdf/pdfjs';
import { readOutline } from './pdf/outline';
import { pageDisplaySize, clamp } from './pdf/geometry';

export type Theme = 'light' | 'dark';
export type SidebarTab = 'thumbnails' | 'outline';
export type ZoomMode = 'custom' | 'fit-page';

export interface PageGeometry extends PageSize {
  /** The page's own /Rotate value. */
  rotate: number;
}

export interface LoadDocumentInput {
  bytes: Uint8Array;
  fileName: string;
  filePath: string | null;
  workspacePath?: string | null;
  restore?: {
    annotations: Annotation[];
    signatures: SignatureAsset[];
    view?: {
      page?: number;
      zoom?: number;
      zoomMode?: ZoomMode;
      rotation?: number;
      sidebarOpen?: boolean;
      sidebarTab?: SidebarTab;
    };
  };
}

export interface ToastMessage {
  id: number;
  message: string;
  tone: 'neutral' | 'success' | 'error';
}

interface NavigationTarget {
  page: number;
  nonce: number;
}

interface FolioState {
  pdf: PDFDocumentProxy | null;
  documentId: number;
  documentBytes: Uint8Array | null;
  fileName: string;
  filePath: string | null;
  workspacePath: string | null;
  title: string;
  pageCount: number;
  pageGeometries: PageGeometry[];
  outline: OutlineEntry[];

  loading: boolean;
  loadingLabel: string;
  busy: string | null;
  error: string | null;
  toasts: ToastMessage[];

  annotations: Annotation[];
  signatures: SignatureAsset[];
  selectedAnnotationId: string | null;
  activeSignatureId: string | null;
  tool: AnnotationTool;
  highlightColor: string;
  inkColor: string;
  inkWidth: number;
  noteEditorId: string | null;
  signatureDialogOpen: boolean;

  currentPage: number;
  navigationTarget: NavigationTarget | null;
  zoom: number;
  zoomMode: ZoomMode;
  rotation: number;

  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  theme: Theme;
  isDirty: boolean;

  loadDocument: (input: LoadDocumentInput) => Promise<void>;
  hydratePageGeometries: (token: number) => Promise<void>;
  setPageGeometry: (page: number, geometry: PageGeometry) => void;
  setOutline: (outline: OutlineEntry[]) => void;

  setCurrentPage: (page: number) => void;
  goToPage: (page: number, smooth?: boolean) => void;
  clearNavigationTarget: (nonce: number) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitPage: (containerWidth: number, containerHeight: number) => void;
  rotateClockwise: () => void;
  toggleSidebar: () => void;
  openSidebar: (tab?: SidebarTab) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  setTool: (tool: AnnotationTool) => void;
  setHighlightColor: (color: string) => void;
  setInkColor: (color: string) => void;
  setInkWidth: (width: number) => void;
  selectAnnotation: (id: string | null) => void;
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  deleteAnnotation: (id: string) => void;
  setNoteEditor: (id: string | null) => void;

  setSignatureDialogOpen: (open: boolean) => void;
  addSignatureAsset: (signature: SignatureAsset) => void;
  removeSignatureAsset: (id: string) => void;
  setActiveSignature: (id: string | null) => void;

  markSaved: (workspacePath: string) => void;
  setWorkspacePath: (path: string | null) => void;
  setDirty: (dirty: boolean) => void;

  setLoading: (loading: boolean, label?: string) => void;
  cancelLoading: () => void;
  setBusy: (busy: string | null) => void;
  setError: (error: string | null) => void;
  showToast: (message: string, tone?: ToastMessage['tone']) => void;
  dismissToast: (id: number) => void;
  viewForSave: () => {
    page: number;
    zoom: number;
    zoomMode: ZoomMode;
    rotation: number;
    sidebarOpen: boolean;
    sidebarTab: SidebarTab;
  };
}

let documentToken = 0;
let toastId = 0;
let topZIndex = 30;

function initialTheme(): Theme {
  const stored = localStorage.getItem('folio-theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return 'light';
}

function pageGeometryDefaults(count: number): PageGeometry[] {
  return Array.from({ length: count }, () => ({ width: 612, height: 792, rotate: 0 }));
}

export const useFolio = create<FolioState>((set, get) => ({
  pdf: null,
  documentId: 0,
  documentBytes: null,
  fileName: '',
  filePath: null,
  workspacePath: null,
  title: 'Folio',
  pageCount: 0,
  pageGeometries: [],
  outline: [],

  loading: false,
  loadingLabel: '',
  busy: null,
  error: null,
  toasts: [],

  annotations: [],
  signatures: [],
  selectedAnnotationId: null,
  activeSignatureId: null,
  tool: 'select',
  highlightColor: '#f6d365',
  inkColor: '#252525',
  inkWidth: 2.4,
  noteEditorId: null,
  signatureDialogOpen: false,

  currentPage: 1,
  navigationTarget: null,
  zoom: 1,
  zoomMode: 'fit-page',
  rotation: 0,

  sidebarOpen: true,
  sidebarTab: 'thumbnails',
  theme: initialTheme(),
  isDirty: false,

  loadDocument: async (input) => {
    const token = ++documentToken;
    set({ loading: true, loadingLabel: 'Opening document', error: null });
    try {
      const loaded = await loadPdf(input.bytes);
      if (token !== documentToken) {
        void loaded.pdf.destroy();
        return;
      }

      const firstPage = await loaded.pdf.getPage(1);
      if (token !== documentToken) {
        void loaded.pdf.destroy();
        return;
      }
      const firstViewport = firstPage.getViewport({ scale: 1, rotation: firstPage.rotate });
      const firstGeometry: PageGeometry = {
        width: firstViewport.width,
        height: firstViewport.height,
        rotate: firstPage.rotate,
      };
      const geometries = pageGeometryDefaults(loaded.pageCount).map((geometry, index) =>
        index === 0 ? firstGeometry : geometry,
      );
      if (token !== documentToken) {
        void loaded.pdf.destroy();
        return;
      }
      const previous = get().pdf;
      const restore = input.restore;
      const restoredPage = Math.min(
        Math.max(restore?.view?.page ?? 1, 1),
        loaded.pageCount,
      );
      const zoomMode = restore?.view?.zoomMode === 'custom' ? 'custom' : 'fit-page';
      const next: Partial<FolioState> = {
        pdf: loaded.pdf,
        documentId: token,
        documentBytes: new Uint8Array(input.bytes),
        fileName: input.fileName,
        filePath: input.filePath,
        workspacePath: input.workspacePath ?? null,
        title: loaded.title || input.fileName,
        pageCount: loaded.pageCount,
        pageGeometries: geometries,
        outline: [] as OutlineEntry[],
        annotations: (restore?.annotations ?? []).filter(
          (annotation) => annotation.page >= 1 && annotation.page <= loaded.pageCount,
        ),
        signatures: restore?.signatures ?? [],
        selectedAnnotationId: null,
        activeSignatureId: null,
        tool: 'select' as AnnotationTool,
        loading: false,
        loadingLabel: '',
        busy: null,
        error: null,
        isDirty: false,
        currentPage: restoredPage,
        navigationTarget: { page: restoredPage, nonce: Date.now() },
        zoom: restore?.view?.zoomMode === 'custom' ? restore.view.zoom ?? 1 : 1,
        zoomMode,
        rotation: restore?.view?.rotation ?? 0,
        sidebarOpen: restore?.view?.sidebarOpen ?? get().sidebarOpen,
        sidebarTab: restore?.view?.sidebarTab ?? get().sidebarTab,
      };
      set(next);
      if (previous && previous !== loaded.pdf) void previous.destroy();

      void get()
        .hydratePageGeometries(token)
        .catch(() => undefined);
      void readOutline(loaded.pdf)
        .then((outline) => {
          if (token === documentToken) set({ outline });
        })
        .catch(() => {
          if (token === documentToken) set({ outline: [] });
        });
    } catch (error) {
      if (token !== documentToken) return;
      const message = error instanceof Error ? error.message : 'The document could not be opened.';
      set({ loading: false, loadingLabel: '', error: message });
      get().showToast(message, 'error');
    }
  },

  hydratePageGeometries: async (token) => {
    const pdf = get().pdf;
    if (!pdf) return;
    const count = pdf.numPages;
    for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
      if (token !== documentToken) return;
      try {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
        const geometry = {
          width: viewport.width,
          height: viewport.height,
          rotate: page.rotate,
        };
        if (token !== documentToken) return;
        set((state) => {
          const existing = state.pageGeometries[pageNumber - 1];
          if (
            existing &&
            Math.abs(existing.width - geometry.width) < 0.1 &&
            Math.abs(existing.height - geometry.height) < 0.1 &&
            existing.rotate === geometry.rotate
          ) {
            return state;
          }
          const pageGeometries = state.pageGeometries.slice();
          pageGeometries[pageNumber - 1] = geometry;
          return { pageGeometries };
        });
      } catch {
        // A single malformed page should not prevent the rest from being usable.
      }
    }
  },

  setPageGeometry: (page, geometry) => {
    set((state) => {
      if (page < 1 || page > state.pageCount) return state;
      const existing = state.pageGeometries[page - 1];
      if (
        existing &&
        Math.abs(existing.width - geometry.width) < 0.1 &&
        Math.abs(existing.height - geometry.height) < 0.1 &&
        existing.rotate === geometry.rotate
      ) {
        return state;
      }
      const pageGeometries = state.pageGeometries.slice();
      pageGeometries[page - 1] = geometry;
      return { pageGeometries };
    });
  },

  setOutline: (outline) => set({ outline }),

  setCurrentPage: (page) => {
    const count = get().pageCount;
    if (count === 0) return;
    const next = Math.min(Math.max(1, page), count);
    if (next !== get().currentPage) set({ currentPage: next });
  },

  goToPage: (page) => {
    const count = get().pageCount;
    if (count === 0) return;
    const next = Math.min(Math.max(1, Math.round(page)), count);
    set((state) => ({
      currentPage: next,
      navigationTarget: { page: next, nonce: (state.navigationTarget?.nonce ?? 0) + 1 },
    }));
  },

  clearNavigationTarget: (nonce) => {
    if (get().navigationTarget?.nonce === nonce) set({ navigationTarget: null });
  },

  setZoom: (zoom) => {
    const next = clamp(Number(zoom.toFixed(3)), 0.25, 4);
    set((state) => ({
      zoom: next,
      zoomMode: 'custom',
      navigationTarget: {
        page: state.currentPage,
        nonce: (state.navigationTarget?.nonce ?? 0) + 1,
      },
    }));
  },

  zoomIn: () => {
    const state = get();
    if (state.zoom >= 4) return;
    state.setZoom(state.zoom * 1.15);
  },

  zoomOut: () => {
    const state = get();
    if (state.zoom <= 0.25) return;
    state.setZoom(state.zoom / 1.15);
  },

  fitPage: (containerWidth, containerHeight) => {
    const state = get();
    if (!state.pageCount) return;
    const geometry = state.pageGeometries[state.currentPage - 1] ?? state.pageGeometries[0];
    if (!geometry) return;
    const display = pageDisplaySize(geometry.width, geometry.height, state.rotation);
    const horizontalPadding = containerWidth < 700 ? 32 : 88;
    const verticalPadding = 46;
    const availableWidth = Math.max(120, containerWidth - horizontalPadding);
    const availableHeight = Math.max(160, containerHeight - verticalPadding);
    const zoom = clamp(
      Math.min(availableWidth / display.width, availableHeight / display.height),
      0.2,
      3,
    );
    set({
      zoom: Number(zoom.toFixed(4)),
      zoomMode: 'fit-page',
    });
  },

  rotateClockwise: () => {
    const state = get();
    set({
      rotation: (state.rotation + 90) % 360,
      navigationTarget: {
        page: state.currentPage,
        nonce: (state.navigationTarget?.nonce ?? 0) + 1,
      },
      isDirty: true,
    });
  },

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  openSidebar: (tab) =>
    set((state) => ({ sidebarOpen: true, sidebarTab: tab ?? state.sidebarTab })),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),

  setTheme: (theme) => {
    localStorage.setItem('folio-theme', theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'light' ? 'dark' : 'light'),

  setTool: (tool) => {
    set({ tool, selectedAnnotationId: tool === 'select' ? get().selectedAnnotationId : null });
    if (tool === 'signature') {
      const active = get().activeSignatureId;
      if (!active) set({ signatureDialogOpen: true });
    }
  },
  setHighlightColor: (highlightColor) => set({ highlightColor }),
  setInkColor: (inkColor) => set({ inkColor }),
  setInkWidth: (inkWidth) => set({ inkWidth }),
  selectAnnotation: (selectedAnnotationId) => set({ selectedAnnotationId }),

  addAnnotation: (annotation) => {
    set((state) => ({
      annotations: [...state.annotations, annotation],
      selectedAnnotationId: annotation.id,
      isDirty: true,
      tool: state.tool === 'note' ? 'select' : state.tool,
    }));
  },

  updateAnnotation: (id, patch) => {
    set((state) => ({
      annotations: state.annotations.map((annotation) =>
        annotation.id === id ? ({ ...annotation, ...patch } as Annotation) : annotation,
      ),
      isDirty: true,
    }));
  },

  deleteAnnotation: (id) => {
    set((state) => ({
      annotations: state.annotations.filter((annotation) => annotation.id !== id),
      selectedAnnotationId:
        state.selectedAnnotationId === id ? null : state.selectedAnnotationId,
      noteEditorId: state.noteEditorId === id ? null : state.noteEditorId,
      isDirty: true,
    }));
  },

  setNoteEditor: (noteEditorId) => set({ noteEditorId }),

  setSignatureDialogOpen: (signatureDialogOpen) => set({ signatureDialogOpen }),

  addSignatureAsset: (signature) => {
    set((state) => ({
      signatures: [...state.signatures, signature],
      activeSignatureId: signature.id,
      isDirty: true,
    }));
  },

  removeSignatureAsset: (id) => {
    set((state) => ({
      signatures: state.signatures.filter((signature) => signature.id !== id),
      activeSignatureId: state.activeSignatureId === id ? null : state.activeSignatureId,
      isDirty: true,
    }));
  },

  setActiveSignature: (activeSignatureId) => set({ activeSignatureId }),

  markSaved: (workspacePath) => {
    set({ workspacePath, isDirty: false });
  },

  setWorkspacePath: (workspacePath) => set({ workspacePath }),
  setDirty: (isDirty) => set({ isDirty }),

  setLoading: (loading, loadingLabel = '') => set({ loading, loadingLabel }),

  cancelLoading: () => {
    documentToken += 1;
    set({ loading: false, loadingLabel: '' });
  },

  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),

  showToast: (message, tone = 'neutral') => {
    const id = ++toastId;
    set((state) => ({ toasts: [...state.toasts.slice(-2), { id, message, tone }] }));
    window.setTimeout(() => {
      const current = get();
      if (current.toasts.some((toast) => toast.id === id)) current.dismissToast(id);
    }, 4600);
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  viewForSave: () => {
    const state = get();
    return {
      page: state.currentPage,
      zoom: state.zoom,
      zoomMode: state.zoomMode,
      rotation: state.rotation,
      sidebarOpen: state.sidebarOpen,
      sidebarTab: state.sidebarTab,
    };
  },
}));

export function createAnnotationId(kind: AnnotationKind): string {
  topZIndex += 1;
  return `${kind}-${Date.now().toString(36)}-${topZIndex.toString(36)}`;
}
