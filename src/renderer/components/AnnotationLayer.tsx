import { useEffect, useRef, useState } from 'react';
import type { PageViewport } from 'pdfjs-dist';
import type { Annotation, InkAnnotation, PdfPoint, PdfRect } from '../annotations/types';
import {
  moveAnnotation,
  pdfPointToScreen,
  pdfRectToScreenBox,
  pdfRectToTransform,
  pointerToPageLocal,
  screenPointToPdf,
} from '../pdf/geometry';
import { useFolio } from '../store';

type ResizeHandle = 'tl' | 'tr' | 'bl' | 'br';

interface Interaction {
  mode: 'move' | 'resize';
  annotation: Annotation;
  startPdf: PdfPoint;
  handle?: ResizeHandle;
  pointerId: number;
  moved: boolean;
}

interface AnnotationLayerProps {
  pageNumber: number;
  viewport: PageViewport;
  pageElement: HTMLElement | null;
  annotations: Annotation[];
  selectedId: string | null;
  tool: 'select' | 'highlight' | 'pen' | 'note' | 'signature';
  draftInk: InkAnnotation | null;
}

function annotationBounds(annotation: Annotation): PdfRect {
  if (annotation.kind === 'highlight') {
    const x = Math.min(...annotation.rects.map((rect) => rect.x));
    const y = Math.min(...annotation.rects.map((rect) => rect.y));
    const right = Math.max(...annotation.rects.map((rect) => rect.x + rect.width));
    const top = Math.max(...annotation.rects.map((rect) => rect.y + rect.height));
    return { x, y, width: right - x, height: top - y };
  }
  if (annotation.kind === 'ink') {
    const padding = annotation.width / 2 + 1;
    const x = Math.min(...annotation.points.map((point) => point.x)) - padding;
    const y = Math.min(...annotation.points.map((point) => point.y)) - padding;
    const right = Math.max(...annotation.points.map((point) => point.x)) + padding;
    const top = Math.max(...annotation.points.map((point) => point.y)) + padding;
    return { x, y, width: right - x, height: top - y };
  }
  return annotation.rect;
}

function inkPath(points: PdfPoint[], viewport: PageViewport): string {
  if (points.length === 0) return '';
  const screenPoints = points.map((point) => pdfPointToScreen(viewport, point));
  if (screenPoints.length === 1) {
    const point = screenPoints[0];
    return `M ${point.x} ${point.y} l 0.1 0.1`;
  }
  return screenPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
}

function resizeSignature(
  original: Extract<Annotation, { kind: 'signature' }>,
  handle: ResizeHandle,
  pointer: PdfPoint,
): Extract<Annotation, { kind: 'signature' }> {
  const rect = original.rect;
  const aspect = rect.width / Math.max(0.001, rect.height);
  const opposite = {
    x: handle.includes('r') ? rect.x : rect.x + rect.width,
    y: handle.includes('t') ? rect.y : rect.y + rect.height,
  };
  const width = Math.max(
    36,
    Math.max(Math.abs(pointer.x - opposite.x), Math.abs(pointer.y - opposite.y) * aspect),
  );
  const height = Math.max(16, width / aspect);
  const x = handle.includes('r') ? opposite.x : opposite.x - width;
  const y = handle.includes('t') ? opposite.y : opposite.y - height;
  return { ...original, rect: { x, y, width, height } };
}

function patchForAnnotation(annotation: Annotation): Partial<Annotation> {
  if (annotation.kind === 'highlight') return { rects: annotation.rects };
  if (annotation.kind === 'ink') return { points: annotation.points };
  return { rect: annotation.rect };
}

export function AnnotationLayer({
  pageNumber,
  viewport,
  pageElement,
  annotations,
  selectedId,
  tool,
  draftInk,
}: AnnotationLayerProps) {
  const selectAnnotation = useFolio((state) => state.selectAnnotation);
  const updateAnnotation = useFolio((state) => state.updateAnnotation);
  const setNoteEditor = useFolio((state) => state.setNoteEditor);
  const [preview, setPreview] = useState<Annotation | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const previewRef = useRef<Annotation | null>(null);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const interaction = interactionRef.current;
      if (!interaction || event.pointerId !== interaction.pointerId || !pageElement) return;
      const local = pointerToPageLocal(event, pageElement);
      const currentPdf = screenPointToPdf(viewport, local);
      const dx = currentPdf.x - interaction.startPdf.x;
      const dy = currentPdf.y - interaction.startPdf.y;
      if (!interaction.moved && Math.hypot(dx, dy) * viewport.scale > 2.5) {
        interaction.moved = true;
        document.body.classList.add('is-dragging-annotation');
      }
      let next: Annotation;
      if (interaction.mode === 'resize' && interaction.annotation.kind === 'signature') {
        next = resizeSignature(interaction.annotation, interaction.handle ?? 'br', currentPdf);
      } else {
        next = moveAnnotation(interaction.annotation, dx, dy);
      }
      previewRef.current = next;
      setPreview(next);
    }

    function finishInteraction() {
      const interaction = interactionRef.current;
      interactionRef.current = null;
      document.body.classList.remove('is-dragging-annotation');
      if (interaction?.moved && previewRef.current) {
        updateAnnotation(interaction.annotation.id, patchForAnnotation(previewRef.current));
      }
      previewRef.current = null;
      setPreview(null);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finishInteraction);
    window.addEventListener('pointercancel', finishInteraction);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishInteraction);
      window.removeEventListener('pointercancel', finishInteraction);
      document.body.classList.remove('is-dragging-annotation');
    };
  }, [pageElement, updateAnnotation, viewport]);

  const beginMove = (event: React.PointerEvent, annotation: Annotation) => {
    if (tool !== 'select' || !pageElement) return;
    event.preventDefault();
    event.stopPropagation();
    selectAnnotation(annotation.id);
    const startPdf = screenPointToPdf(viewport, pointerToPageLocal(event, pageElement));
    interactionRef.current = {
      mode: 'move',
      annotation,
      startPdf,
      pointerId: event.pointerId,
      moved: false,
    };
    previewRef.current = annotation;
  };

  const beginResize = (
    event: React.PointerEvent,
    annotation: Extract<Annotation, { kind: 'signature' }>,
    handle: ResizeHandle,
  ) => {
    if (tool !== 'select' || !pageElement) return;
    event.preventDefault();
    event.stopPropagation();
    selectAnnotation(annotation.id);
    const startPdf = screenPointToPdf(viewport, pointerToPageLocal(event, pageElement));
    interactionRef.current = {
      mode: 'resize',
      annotation,
      startPdf,
      handle,
      pointerId: event.pointerId,
      moved: false,
    };
    previewRef.current = annotation;
  };

  const rendered = annotations.map((annotation) => {
    const active =
      preview && preview.id === annotation.id ? preview : annotation;
    const selectable = tool === 'select';
    const isSelected = selectable && selectedId === annotation.id;

    if (active.kind === 'highlight') {
      return active.rects.map((rect, index) => {
        const box = pdfRectToScreenBox(viewport, rect);
        return (
          <div
            key={`${active.id}-${index}`}
            data-annotation-id={active.id}
            className={`highlight-mark ${selectable ? 'selectable' : ''} ${
              isSelected ? 'selected' : ''
            }`}
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              ['--highlight-color' as string]: active.color,
            }}
            onPointerDown={(event) => beginMove(event, active)}
            title="Highlight"
          />
        );
      });
    }

    if (active.kind === 'ink') {
      const path = inkPath(active.points, viewport);
      return (
        <svg
          key={active.id}
          className={`ink-layer ${selectable ? 'selectable' : ''}`}
          width="100%"
          height="100%"
          aria-hidden="true"
        >
          <path
            d={path}
            fill="none"
            stroke={active.color}
            strokeWidth={Math.max(0.75, active.width * viewport.scale)}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={isSelected ? 'ink-stroke selected' : 'ink-stroke'}
            data-annotation-id={active.id}
          />
          {selectable && (
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(16, active.width * viewport.scale + 12)}
              strokeLinecap="round"
              className="ink-hit-area"
              onPointerDown={(event) => beginMove(event, active)}
            />
          )}
        </svg>
      );
    }

    if (active.kind === 'note') {
      const transform = pdfRectToTransform(viewport, active.rect);
      return (
        <div
          key={active.id}
          data-annotation-id={active.id}
          className={`note-card ${selectable ? 'selectable' : ''} ${
            isSelected ? 'selected' : ''
          }`}
          style={{
            width: transform.width,
            height: transform.height,
            transform: transform.matrix,
            ['--note-color' as string]: active.color,
          }}
          onPointerDown={(event) => beginMove(event, active)}
          onDoubleClick={(event) => {
            if (tool === 'select') {
              event.stopPropagation();
              setNoteEditor(active.id);
            }
          }}
          title="Double-click to edit note"
        >
          <div className="note-card-fold" />
          <div className="note-card-text">{active.text || 'Empty note'}</div>
        </div>
      );
    }

    const transform = pdfRectToTransform(viewport, active.rect);
    return (
      <div
        key={active.id}
        data-annotation-id={active.id}
        className={`signature-mark ${selectable ? 'selectable' : ''} ${
          isSelected ? 'selected' : ''
        }`}
        style={{
          width: transform.width,
          height: transform.height,
          transform: transform.matrix,
        }}
        onPointerDown={(event) => beginMove(event, active)}
        title="Signature"
      >
        <img src={active.image} alt="Signature" draggable={false} />
      </div>
    );
  });

  const selectedAnnotationBase = annotations.find((annotation) => annotation.id === selectedId) ?? null;
  const selectedAnnotation =
    preview && selectedId === preview.id ? preview : selectedAnnotationBase;
  const showSelection = tool === 'select' && selectedAnnotation;
  const selectedBox = selectedAnnotation
    ? pdfRectToScreenBox(viewport, annotationBounds(selectedAnnotation))
    : null;
  const signature = selectedAnnotation?.kind === 'signature' ? selectedAnnotation : null;

  return (
    <div
      className={`annotation-layer ${tool !== 'select' ? 'tool-active' : ''}`}
      data-page={pageNumber}
    >
      {draftInk && (
        <svg className="ink-layer draft" width="100%" height="100%" aria-hidden="true">
          <path
            d={inkPath(draftInk.points, viewport)}
            fill="none"
            stroke={draftInk.color}
            strokeWidth={Math.max(0.75, draftInk.width * viewport.scale)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {rendered}
      {showSelection && selectedBox && (
        <div
          className="selection-box"
          style={{
            left: selectedBox.left - 3,
            top: selectedBox.top - 3,
            width: selectedBox.width + 6,
            height: selectedBox.height + 6,
          }}
        >
          {signature &&
            (
              [
                ['tl', signature.rect.x, signature.rect.y + signature.rect.height],
                ['tr', signature.rect.x + signature.rect.width, signature.rect.y + signature.rect.height],
                ['bl', signature.rect.x, signature.rect.y],
                ['br', signature.rect.x + signature.rect.width, signature.rect.y],
              ] as [ResizeHandle, number, number][]
            ).map(([handle, x, y]) => {
              const screen = pdfPointToScreen(viewport, { x, y });
              return (
                <button
                  type="button"
                  key={handle}
                  className={`resize-handle ${handle}`}
                  style={{ left: screen.x - selectedBox.left + 3, top: screen.y - selectedBox.top + 3 }}
                  onPointerDown={(event) => beginResize(event, signature, handle)}
                  aria-label="Resize signature"
                />
              );
            })}
        </div>
      )}
    </div>
  );
}
