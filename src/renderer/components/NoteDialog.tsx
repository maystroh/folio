import { useEffect, useRef, useState } from 'react';
import { StickyNote, Trash2, X } from 'lucide-react';
import { useFolio } from '../store';

export function NoteDialog() {
  const noteEditorId = useFolio((state) => state.noteEditorId);
  const annotations = useFolio((state) => state.annotations);
  const setNoteEditor = useFolio((state) => state.setNoteEditor);
  const updateAnnotation = useFolio((state) => state.updateAnnotation);
  const deleteAnnotation = useFolio((state) => state.deleteAnnotation);
  const annotation = annotations.find(
    (candidate) => candidate.id === noteEditorId && candidate.kind === 'note',
  );
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!annotation || annotation.kind !== 'note') return;
    setText(annotation.text);
    window.setTimeout(() => textareaRef.current?.focus(), 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteEditorId]);

  if (!annotation || annotation.kind !== 'note') return null;

  const close = () => {
    if (annotation.text.trim() === '' && text.trim() === '') {
      deleteAnnotation(annotation.id);
    }
    setNoteEditor(null);
  };

  const save = () => {
    if (text.trim() === '') {
      deleteAnnotation(annotation.id);
    } else {
      updateAnnotation(annotation.id, { text: text.trim() });
    }
    setNoteEditor(null);
  };

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal note-modal" role="dialog" aria-modal="true" aria-labelledby="note-title">
        <div className="modal-header compact">
          <div className="modal-title-with-icon">
            <span className="modal-icon note-icon">
              <StickyNote size={17} />
            </span>
            <div>
              <h2 id="note-title">Page note</h2>
              <p>Page {annotation.page}</p>
            </div>
          </div>
          <button type="button" className="icon-button" onClick={close} aria-label="Close note">
            <X size={18} />
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className="note-textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Write a thought, a question, or a reminder…"
          rows={7}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              save();
            }
          }}
        />
        <div className="modal-footer">
          <button
            type="button"
            className="danger-text-button"
            onClick={() => {
              deleteAnnotation(annotation.id);
              setNoteEditor(null);
            }}
          >
            <Trash2 size={15} />
            Delete note
          </button>
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={close}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={save}>
              Save note
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
