import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { canvasToSignature } from './imageUtils';

export interface SignaturePadHandle {
  toSignature: () => { dataUrl: string; width: number; height: number } | null;
  isEmpty: () => boolean;
}

interface Stroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

interface SignaturePadProps {
  color: string;
  onChange?: (empty: boolean) => void;
}

export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad({ color, onChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const strokesRef = useRef<Stroke[]>([]);
    const currentStroke = useRef<Stroke | null>(null);
    const [empty, setEmpty] = useState(true);
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);

    useImperativeHandle(ref, () => ({
      toSignature: () => {
        const canvas = canvasRef.current;
        if (!canvas || strokesRef.current.length === 0) return null;
        return canvasToSignature(canvas);
      },
      isEmpty: () => strokesRef.current.length === 0,
    }));

    const redraw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      for (const stroke of strokesRef.current) {
        if (stroke.points.length === 0) continue;
        context.beginPath();
        context.strokeStyle = stroke.color;
        context.lineWidth = stroke.width * dpr;
        const first = stroke.points[0];
        context.moveTo(first.x * dpr, first.y * dpr);
        if (stroke.points.length === 1) {
          context.lineTo(first.x * dpr + 0.1, first.y * dpr + 0.1);
        } else {
          for (let index = 1; index < stroke.points.length; index += 1) {
            const point = stroke.points[index];
            context.lineTo(point.x * dpr, point.y * dpr);
          }
        }
        context.stroke();
      }
    };

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const bounds = canvas.getBoundingClientRect();
      canvas.width = Math.round(bounds.width * dpr);
      canvas.height = Math.round(bounds.height * dpr);
      redraw();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dpr]);

    const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const bounds = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - bounds.left) / dpr,
        y: (event.clientY - bounds.top) / dpr,
      };
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      const stroke: Stroke = {
        points: [pointFromEvent(event)],
        color,
        width: 2.6,
      };
      currentStroke.current = stroke;
      strokesRef.current = [...strokesRef.current, stroke];
      setEmpty(false);
      onChange?.(false);
      redraw();
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!currentStroke.current || !canvasRef.current?.hasPointerCapture(event.pointerId)) return;
      currentStroke.current.points.push(pointFromEvent(event));
      redraw();
    };

    const finishStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (currentStroke.current && canvasRef.current?.hasPointerCapture(event.pointerId)) {
        canvasRef.current.releasePointerCapture(event.pointerId);
      }
      currentStroke.current = null;
    };

    return (
      <div className="signature-pad-wrap">
        <canvas
          ref={canvasRef}
          className="signature-pad"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onPointerLeave={finishStroke}
          aria-label="Draw your signature"
        />
        {empty && <div className="signature-pad-placeholder">Sign here with your mouse or pen</div>}
        <div className="signature-pad-actions">
          <button
            type="button"
            className="icon-button small"
            title="Undo stroke"
            onClick={() => {
              strokesRef.current = strokesRef.current.slice(0, -1);
              setEmpty(strokesRef.current.length === 0);
              onChange?.(strokesRef.current.length === 0);
              redraw();
            }}
            disabled={empty}
          >
            <RotateCcw size={15} />
          </button>
          <button
            type="button"
            className="icon-button small"
            title="Clear signature"
            onClick={() => {
              strokesRef.current = [];
              setEmpty(true);
              onChange?.(true);
              redraw();
            }}
            disabled={empty}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    );
  },
);
