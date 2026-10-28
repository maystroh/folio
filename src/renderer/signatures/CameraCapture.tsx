import { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCcw, VideoOff } from 'lucide-react';

interface CameraCaptureProps {
  onCapture: (dataUrl: string) => void;
}

export function CameraCapture({ onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<'idle' | 'starting' | 'live' | 'error'>('idle');
  const [error, setError] = useState('');

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const startCamera = async () => {
    setStatus('starting');
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access is not available in this environment.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: { ideal: 'environment' },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (!videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setStatus('live');
    } catch (caught) {
      stopStream();
      setStatus('error');
      const raw = caught as { name?: string; message?: string };
      if (raw.name === 'NotAllowedError') {
        setError('Camera access was denied. Allow camera access for Folio in Windows settings, or upload an image instead.');
      } else if (raw.name === 'NotFoundError') {
        setError('No camera was found on this computer. You can upload a signature image instead.');
      } else {
        setError(raw.message || 'The camera could not be started.');
      }
    }
  };

  useEffect(() => {
    void startCamera();
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.93);
    stopStream();
    setStatus('idle');
    onCapture(dataUrl);
  };

  return (
    <div className="camera-capture">
      <div className="camera-stage">
        <video ref={videoRef} className="camera-video" muted playsInline />
        {status === 'starting' && (
          <div className="camera-message">
            <RefreshCcw className="spin" size={22} />
            <span>Opening camera…</span>
          </div>
        )}
        {status === 'error' && (
          <div className="camera-message">
            <VideoOff size={26} />
            <span>{error}</span>
            <button type="button" className="secondary-button" onClick={() => void startCamera()}>
              Try again
            </button>
          </div>
        )}
        {status === 'live' && (
          <div className="camera-guide">
            <span>Hold the signed paper inside the frame</span>
          </div>
        )}
      </div>
      <div className="camera-actions">
        <button
          type="button"
          className="primary-button"
          onClick={capture}
          disabled={status !== 'live'}
        >
          <Camera size={16} />
          Capture signature
        </button>
        <p className="muted-copy">Photos are processed locally and never leave your computer.</p>
      </div>
    </div>
  );
}
