import { Check, Move, Pencil, Signature, Trash2, X } from 'lucide-react';
import { HIGHLIGHT_COLORS, INK_COLORS, annotationLabel } from '../annotations/types';
import { useFolio } from '../store';

export function SelectionInspector() {
  const selectedId = useFolio((state) => state.selectedAnnotationId);
  const annotations = useFolio((state) => state.annotations);
  const tool = useFolio((state) => state.tool);
  const updateAnnotation = useFolio((state) => state.updateAnnotation);
  const deleteAnnotation = useFolio((state) => state.deleteAnnotation);
  const selectAnnotation = useFolio((state) => state.selectAnnotation);
  const setNoteEditor = useFolio((state) => state.setNoteEditor);
  const setTool = useFolio((state) => state.setTool);
  const annotation = annotations.find((candidate) => candidate.id === selectedId);

  if (!annotation || tool !== 'select') return null;

  return (
    <div className="selection-inspector" role="toolbar" aria-label="Selected annotation">
      <span className="inspector-kind">
        <span className={`inspector-dot ${annotation.kind}`} />
        {annotationLabel(annotation.kind)}
      </span>
      <span className="inspector-hint">
        <Move size={12} /> Drag to move
      </span>

      {annotation.kind === 'highlight' && (
        <div className="inspector-colors" aria-label="Highlight color">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              type="button"
              key={color.value}
              className={`swatch tiny ${annotation.color === color.value ? 'selected' : ''}`}
              style={{ background: color.value }}
              title={color.name}
              onClick={() => updateAnnotation(annotation.id, { color: color.value })}
            >
              {annotation.color === color.value && <Check size={10} />}
            </button>
          ))}
        </div>
      )}

      {annotation.kind === 'ink' && (
        <div className="inspector-colors" aria-label="Drawing color">
          {INK_COLORS.map((color) => (
            <button
              type="button"
              key={color.value}
              className={`swatch tiny ${annotation.color === color.value ? 'selected' : ''}`}
              style={{ background: color.value }}
              title={color.name}
              onClick={() => updateAnnotation(annotation.id, { color: color.value })}
            >
              {annotation.color === color.value && <Check size={10} />}
            </button>
          ))}
        </div>
      )}

      {annotation.kind === 'note' && (
        <button
          type="button"
          className="inspector-action"
          onClick={() => setNoteEditor(annotation.id)}
        >
          <Pencil size={13} />
          Edit note
        </button>
      )}

      {annotation.kind === 'signature' && (
        <button type="button" className="inspector-action" onClick={() => setTool('signature')}>
          <Signature size={13} />
          Place another
        </button>
      )}

      <span className="inspector-divider" />
      <button
        type="button"
        className="icon-button tiny danger"
        onClick={() => deleteAnnotation(annotation.id)}
        title="Delete annotation (Delete)"
        aria-label="Delete annotation"
      >
        <Trash2 size={14} />
      </button>
      <button
        type="button"
        className="icon-button tiny"
        onClick={() => selectAnnotation(null)}
        title="Deselect"
        aria-label="Deselect"
      >
        <X size={14} />
      </button>
    </div>
  );
}
