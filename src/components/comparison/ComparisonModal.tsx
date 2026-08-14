import { useState, useRef, useEffect, MouseEvent, WheelEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { 
  X, 
  ArrowRight, 
  Sparkles, 
  Loader2, 
  ZoomIn, 
  ZoomOut, 
  MapPinOff,
  Palette
} from 'lucide-react';
import { ImageItem } from '../../types/conversion';

interface ComparisonModalProps {
  item: ImageItem | null;
  onClose: () => void;
}

const formatBytes = (bytes?: number) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export const ComparisonModal = ({ item, onClose }: ComparisonModalProps) => {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [zoomLevel, setZoomLevel] = useState(1); // 1 = Fit, 2 = 200%, etc.

  const [originalSrc, setOriginalSrc] = useState<string | null>(null);
  const [convertedSrc, setConvertedSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '0') resetZoom();
      if (e.key === '1') setZoomLevel(1);
      if (e.key === '2') setZoomLevel(2);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!item || !item.outputPath) return;
    setLoading(true);

    Promise.all([
      invoke<string>('read_image_as_data_url', { path: item.path }),
      invoke<string>('read_image_as_data_url', { path: item.outputPath }),
    ])
      .then(([orig, conv]) => {
        setOriginalSrc(orig);
        setConvertedSrc(conv);
      })
      .catch((err) => console.error('Error loading comparison images:', err))
      .finally(() => setLoading(false));
  }, [item]);

  if (!item || !item.outputPath) return null;

  const handleSliderMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pos = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(pos);
  };

  // Zoom logic
  const handleZoom = (delta: number) => {
    setZoomLevel((prev) => Math.max(0.5, Math.min(5, Number((prev + delta).toFixed(2)))));
  };

  const resetZoom = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  // Wheel to Zoom
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    handleZoom(delta);
  };

  // Pan handlers
  const handleMouseDown = (e: MouseEvent) => {
    // Nếu click gần slider thì ưu tiên kéo slider
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickXPercent = ((e.clientX - rect.left) / rect.width) * 100;
    
    if (Math.abs(clickXPercent - sliderPosition) < 3 || e.altKey) {
      setIsDraggingSlider(true);
      handleSliderMove(e.clientX);
    } else if (zoomLevel > 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    } else {
      setIsDraggingSlider(true);
      handleSliderMove(e.clientX);
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDraggingSlider) {
      handleSliderMove(e.clientX);
    } else if (isPanning && zoomLevel > 1) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDraggingSlider(false);
    setIsPanning(false);
  };

  const savingsPercent =
    item.outputSize && item.size
      ? Math.round(((item.size - item.outputSize) / item.size) * 100)
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-5">
      <div className="relative w-full max-w-6xl h-[90vh] bg-[#11141a] border border-zinc-800 rounded-3xl flex flex-col overflow-hidden shadow-2xl">
        
        {/* Header Bar */}
        <div className="h-14 px-6 border-b border-zinc-800/80 flex items-center justify-between shrink-0 bg-[#141720]/80">
          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold text-zinc-100 max-w-xs truncate">
              {item.name}
            </span>

            {/* Quick Metrics Badge */}
            <div className="flex items-center gap-2.5 bg-[#0e1015] px-3 py-1 rounded-xl border border-zinc-800 text-[11px]">
              <span className="text-zinc-400">{formatBytes(item.size)}</span>
              <ArrowRight className="w-3 h-3 text-zinc-600" />
              <span className="text-emerald-400 font-semibold">{formatBytes(item.outputSize)}</span>
              {savingsPercent !== null && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  -{savingsPercent}%
                </span>
              )}
            </div>

            {/* Metadata Tags */}
            <div className="hidden md:flex items-center gap-2 text-[10px] text-zinc-400">
              <span className="flex items-center gap-1 bg-zinc-800/50 px-2 py-0.5 rounded-lg border border-zinc-700/40">
                <Palette className="w-3 h-3 text-blue-400" /> sRGB D65
              </span>
              <span className="flex items-center gap-1 bg-zinc-800/50 px-2 py-0.5 rounded-lg border border-zinc-700/40">
                <MapPinOff className="w-3 h-3 text-amber-400" /> GPS Stripped
              </span>
            </div>
          </div>

          {/* Zoom Controls & Close */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-[#171a22] p-1 rounded-xl border border-zinc-800">
              <button
                onClick={() => handleZoom(-0.25)}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={resetZoom}
                className="px-2 py-0.5 text-[11px] font-mono font-medium text-zinc-300 hover:text-white rounded-lg hover:bg-zinc-800 transition cursor-pointer"
                title="Reset to Fit (1:1)"
              >
                {Math.round(zoomLevel * 100)}%
              </button>
              <button
                onClick={() => handleZoom(0.25)}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setZoomLevel(2)}
                className={`px-2 py-0.5 text-[10px] font-medium rounded-lg transition cursor-pointer ${
                  zoomLevel === 2 ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`}
                title="200% Actual Pixel Inspection"
              >
                200%
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Viewport Canvas */}
        <div
          ref={containerRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className={`relative flex-1 bg-[#090b0f] overflow-hidden select-none flex items-center justify-center ${
            zoomLevel > 1 ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-ew-resize'
          }`}
        >
          {loading ? (
            <div className="flex flex-col items-center gap-3 text-zinc-400">
              <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
              <span className="text-xs font-medium">Rendering pixel-perfect inspection...</span>
            </div>
          ) : (
            <div
              className="relative w-full h-full flex items-center justify-center transition-transform duration-75 ease-out"
              style={{
                transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
                transformOrigin: 'center center',
              }}
            >
              {/* Output Layer */}
              <div className="absolute inset-0 flex items-center justify-center p-6">
                {convertedSrc && (
                  <img
                    src={convertedSrc}
                    alt="Output"
                    className="max-h-full max-w-full object-contain pointer-events-none drop-shadow-2xl"
                  />
                )}
              </div>

              {/* Original Layer with Clip-path */}
              <div
                className="absolute inset-0 flex items-center justify-center p-6 overflow-hidden pointer-events-none"
                style={{
                  clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)`,
                }}
              >
                {originalSrc && (
                  <img
                    src={originalSrc}
                    alt="Original"
                    className="max-h-full max-w-full object-contain drop-shadow-2xl"
                  />
                )}
              </div>
            </div>
          )}

          {/* Floating Indicators */}
          <span className="absolute top-4 left-4 text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-md text-zinc-300 border border-white/10 shadow-lg pointer-events-none">
            Original • {item.width}×{item.height}
          </span>
          <span className="absolute top-4 right-4 text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-md text-emerald-400 border border-emerald-500/20 shadow-lg pointer-events-none">
            Converted Output
          </span>

          {/* Precision Split Divider */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,1)] pointer-events-none flex items-center justify-center z-10"
            style={{ left: `${sliderPosition}%` }}
          >
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-2xl border-2 border-white/40">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
          </div>
        </div>

        {/* Footer Info & Shortcuts Guide */}
        <div className="h-10 px-6 bg-[#101319] border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-500 shrink-0">
          <div className="flex items-center gap-4">
            <span>Drag slider to compare</span>
            <span>•</span>
            <span>Scroll wheel to zoom</span>
            <span>•</span>
            <span>Drag canvas to pan (when zoomed)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-zinc-400">1: Fit</span>
            <span className="font-mono text-zinc-400">2: 200%</span>
            <span className="font-mono text-zinc-400">ESC: Close</span>
          </div>
        </div>
      </div>
    </div>
  );
};