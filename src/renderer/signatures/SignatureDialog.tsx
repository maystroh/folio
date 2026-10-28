import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  FlipHorizontal,
  FlipVertical,
  ImageUp,
  Loader2,
  PenLine,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { SignatureAsset } from '../annotations/types';
import { useFolio } from '../store';
import { CameraCapture } from './CameraCapture';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { prepareSignatureImage, type SignatureProcessingOptions } from './imageUtils';

type Tab = 'draw' | 'upload' | 'camera';

interface SignatureRefinerProps {
  source: string;
  onUse: (result: { dataUrl: string; width: number; height: number }) => void;
  onRetake?: () => void;
  retakeLabel?: string;
  name: string;
  onNameChange: (name: string) => void;
}

function SignatureRefiner({
  source,
  onUse,
  onRetake,
  retakeLabel = 'Retake',
  name,
  onNameChange,
}: SignatureRefinerProps) {
  const [options, setOptions] = useState<SignatureProcessingOptions>({
    cleanBackground: true,
    threshold: 208,
    flipHorizontal: false,
    flipVertical: false,
    trim: true,
  });
  const [prepared, setPrepared] = useState<{ dataUrl: string; width: number; height: number } | null>(
    null,
  );
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setProcessing(true);
    setError('');
    const timer = window.setTimeout(() => {
      prepareSignatureImage(source, options)
        .then((result) => {
          if (!cancelled) setPrepared(result);
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setError(caught instanceof Error ? caught.message : 'The signature could not be prepared.');
            setPrepared(null);
          }
        })
        .finally(() => {
          if (!cancelled) setProcessing(false);
        });
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [options, source]);

  return (
    <div className="signature-refiner">
      <div className="signature-preview-stage">
        {prepared ? (
          <img src={prepared.dataUrl} alt="Prepared signature preview" className="signature-preview" />
        ) : (
          <div className="signature-preview-empty">
            {processing ? <Loader2 className="spin" size={22} /> : <ImageUp size={24} />}
            <span>{processing ? 'Preparing signature…' : 'No signature image'}</span>
          </div>
        )}
        {processing && prepared && (
          <span className="preview-processing">
            <Loader2 className="spin" size={14} /> Updating
          </span>
        )}
      </div>

      <div className="signature-controls">
        <div className="signature-control-row">
          <span className="control-label">Orientation</span>
          <div className="segmented-buttons">
            <button
              type="button"
              className={options.flipHorizontal ? 'active' : ''}
              onClick={() =>
                setOptions((current) => ({ ...current, flipHorizontal: !current.flipHorizontal }))
              }
              title="Flip horizontally"
            >
              <FlipHorizontal size={15} />
              Flip H
            </button>
            <button
              type="button"
              className={options.flipVertical ? 'active' : ''}
              onClick={() =>
                setOptions((current) => ({ ...current, flipVertical: !current.flipVertical }))
              }
              title="Flip vertically"
            >
              <FlipVertical size={15} />
              Flip V
            </button>
          </div>
        </div>
        <div className="signature-control-row">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={options.cleanBackground}
              onChange={(event) =>
                setOptions((current) => ({ ...current, cleanBackground: event.target.checked }))
              }
            />
            <span>Remove paper background</span>
          </label>
        </div>
        {options.cleanBackground && (
          <label className="signature-control-row threshold-row">
            <span className="control-label">Background cutoff</span>
            <input
              type="range"
              min="150"
              max="245"
              value={options.threshold}
              onChange={(event) =>
                setOptions((current) => ({ ...current, threshold: Number(event.target.value) }))
              }
            />
            <span className="range-value">{options.threshold}</span>
          </label>
        )}
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={options.trim}
            onChange={(event) =>
              setOptions((current) => ({ ...current, trim: event.target.checked }))
            }
          />
          <span>Trim empty margins</span>
        </label>

        <div className="signature-name-row">
          <span className="control-label">Name</span>
          <input
            className="text-input"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Signature name"
            maxLength={60}
          />
        </div>

        {error && <p className="form-error">{error}</p>}
        <div className="signature-use-row">
          {onRetake && (
            <button type="button" className="secondary-button" onClick={onRetake}>
              <RotateCcw size={15} />
              {retakeLabel}
            </button>
          )}
          <button
            type="button"
            className="primary-button"
            disabled={!prepared || processing || !name.trim()}
            onClick={() => prepared && onUse(prepared)}
          >
            <Check size={16} />
            Use this signature
          </button>
        </div>
      </div>
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
}

export function SignatureDialog() {
  const signatures = useFolio((state) => state.signatures);
  const activeSignatureId = useFolio((state) => state.activeSignatureId);
  const addSignatureAsset = useFolio((state) => state.addSignatureAsset);
  const removeSignatureAsset = useFolio((state) => state.removeSignatureAsset);
  const setActiveSignature = useFolio((state) => state.setActiveSignature);
  const setTool = useFolio((state) => state.setTool);
  const setDialogOpen = useFolio((state) => state.setSignatureDialogOpen);
  const showToast = useFolio((state) => state.showToast);

  const [tab, setTab] = useState<Tab>('draw');
  const [name, setName] = useState(`Signature ${signatures.length + 1}`);
  const [uploadSource, setUploadSource] = useState<string | null>(null);
  const [cameraSource, setCameraSource] = useState<string | null>(null);
  const [drawColor, setDrawColor] = useState('#1f2328');
  const [hasDrawn, setHasDrawn] = useState(false);
  const [fileError, setFileError] = useState('');
  const padRef = useRef<SignaturePadHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialogOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setDialogOpen]);

  const close = () => setDialogOpen(false);

  const finishSignature = (result: { dataUrl: string; width: number; height: number }) => {
    const now = Date.now();
    const asset: SignatureAsset = {
      id: `sig-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || `Signature ${signatures.length + 1}`,
      image: result.dataUrl,
      width: result.width,
      height: result.height,
      createdAt: now,
    };
    addSignatureAsset(asset);
    setTool('signature');
    setDialogOpen(false);
    showToast('Signature ready. Click a page to place it.', 'success');
  };

  const reuseSignature = (signature: SignatureAsset) => {
    setActiveSignature(signature.id);
    setTool('signature');
    setDialogOpen(false);
    showToast(`“${signature.name}” ready to place. Click a page.`, 'success');
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file.type)) {
      setFileError('Choose a PNG, JPEG, WebP, GIF, or BMP image.');
      return;
    }
    setFileError('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setUploadSource(dataUrl);
      if (!name.trim() || /^Signature \d+$/.test(name)) {
        setName(`Signature ${signatures.length + 1}`);
      }
    } catch (caught) {
      setFileError(caught instanceof Error ? caught.message : 'The image could not be read.');
    }
  };

  const useDrawn = () => {
    const result = padRef.current?.toSignature();
    if (!result) return;
    finishSignature(result);
  };

  const hasSignatures = signatures.length > 0;
  const tabLabel = useMemo(() => {
    if (tab === 'draw') return 'Draw';
    if (tab === 'upload') return 'Upload';
    return 'Camera';
  }, [tab]);

  return (
    <div className="modal-backdrop signature-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <div className="modal signature-modal" role="dialog" aria-modal="true" aria-labelledby="signature-title">
        <div className="modal-header">
          <div>
            <span className="eyebrow">Signatures</span>
            <h2 id="signature-title">Make it yours</h2>
            <p>Draw, import, or photograph a signature. Place it anywhere in the document.</p>
          </div>
          <button type="button" className="icon-button" onClick={close} aria-label="Close signatures">
            <X size={18} />
          </button>
        </div>

        <div className="signature-layout">
          <div className="signature-creator">
            <div className="signature-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'draw'}
                className={tab === 'draw' ? 'active' : ''}
                onClick={() => setTab('draw')}
              >
                <PenLine size={16} /> Draw
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'upload'}
                className={tab === 'upload' ? 'active' : ''}
                onClick={() => setTab('upload')}
              >
                <Upload size={16} /> Upload
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'camera'}
                className={tab === 'camera' ? 'active' : ''}
                onClick={() => setTab('camera')}
              >
                <Camera size={16} /> Camera
              </button>
            </div>

            <div className="signature-tab-body">
              {tab === 'draw' && (
                <div className="draw-signature">
                  <div className="draw-signature-head">
                    <div>
                      <h3>Sign with your mouse or pen</h3>
                      <p>Use smooth, deliberate strokes. The background stays transparent.</p>
                    </div>
                    <div className="pen-color-picker" aria-label="Signature ink color">
                      {['#1f2328', '#274d85'].map((color) => (
                        <button
                          type="button"
                          key={color}
                          className={`swatch small ${drawColor === color ? 'selected' : ''}`}
                          style={{ background: color }}
                          onClick={() => setDrawColor(color)}
                          aria-label={color === '#1f2328' ? 'Black ink' : 'Blue ink'}
                        >
                          {drawColor === color && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                  </div>
                  <SignaturePad
                    ref={padRef}
                    color={drawColor}
                    onChange={(empty) => setHasDrawn(!empty)}
                  />
                  <div className="signature-name-row">
                    <span className="control-label">Name</span>
                    <input
                      className="text-input"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Signature name"
                      maxLength={60}
                    />
                  </div>
                  <div className="signature-use-row">
                    <span className="muted-copy">Tip: press the checkmark to keep this signature.</span>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={useDrawn}
                      disabled={!name.trim() || !hasDrawn}
                    >
                      <Check size={16} />
                      Use this signature
                    </button>
                  </div>
                </div>
              )}

              {tab === 'upload' && (
                <div className="upload-signature">
                  {!uploadSource ? (
                    <>
                      <button
                        type="button"
                        className="upload-dropzone"
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          void handleUpload(event.dataTransfer.files[0]);
                        }}
                      >
                        <Upload size={26} strokeWidth={1.5} />
                        <strong>Drop a signature image here</strong>
                        <span>or click to choose a PNG or JPEG</span>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
                        hidden
                        onChange={(event) => void handleUpload(event.target.files?.[0])}
                      />
                      {fileError && <p className="form-error">{fileError}</p>}
                    </>
                  ) : (
                    <SignatureRefiner
                      source={uploadSource}
                      name={name}
                      onNameChange={setName}
                      onUse={finishSignature}
                      retakeLabel="Choose another"
                      onRetake={() => {
                        setUploadSource(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                    />
                  )}
                </div>
              )}

              {tab === 'camera' && (
                <div className="camera-signature">
                  {!cameraSource ? (
                    <CameraCapture onCapture={(dataUrl) => setCameraSource(dataUrl)} />
                  ) : (
                    <SignatureRefiner
                      source={cameraSource}
                      name={name}
                      onNameChange={setName}
                      onUse={finishSignature}
                      onRetake={() => setCameraSource(null)}
                    />
                  )}
                </div>
              )}
            </div>
            <div className="signature-tab-caption">{tabLabel} signature</div>
          </div>

          <aside className="signature-library">
            <div className="signature-library-head">
              <h3>Your signatures</h3>
              <span>{signatures.length}</span>
            </div>
            {!hasSignatures && (
              <div className="signature-library-empty">
                <Plus size={20} />
                <p>No saved signatures yet</p>
                <span>Create one to reuse it throughout the document.</span>
              </div>
            )}
            <div className="signature-list">
              {signatures.map((signature) => (
                <div
                  key={signature.id}
                  className={`signature-list-item ${activeSignatureId === signature.id ? 'active' : ''}`}
                >
                  <button
                    type="button"
                    className="signature-thumb"
                    onClick={() => reuseSignature(signature)}
                    title={`Use ${signature.name}`}
                  >
                    <img src={signature.image} alt="" />
                  </button>
                  <div className="signature-list-meta">
                    <span>{signature.name}</span>
                    <button type="button" className="text-button" onClick={() => reuseSignature(signature)}>
                      Use
                    </button>
                  </div>
                  <button
                    type="button"
                    className="icon-button small signature-delete"
                    onClick={() => removeSignatureAsset(signature.id)}
                    title="Remove saved signature"
                    aria-label={`Remove ${signature.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <p className="signature-library-hint">
              Saved signatures stay inside this Folio workspace and its exported annotations.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
