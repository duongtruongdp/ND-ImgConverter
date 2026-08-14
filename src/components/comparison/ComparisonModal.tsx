import { useState, useRef, useEffect, MouseEvent, TouchEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, ArrowRight, Sparkles, Loader2 } from 'lucide-react';
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
  const [isDragging, setIsDragging] = useState(false);
  const [originalSrc, setOriginalSrc] = useState<string | null>(null);
  const [convertedSrc, setConvertedSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Load ảnh full-res qua Rust command
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

  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pos = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(pos);
  };

  const handleMouseDown = () => setIsDragging(true);
  const handleMouseUp = () => setIsDragging(false);
  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) handleMove(e.clientX);
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (e.touches.length > 0) handleMove(e.touches[0].clientX);
  };

  const savingsPercent =
    item.outputSize && item.size
      ? Math.round(((item.size - item.outputSize) / item.size) * 100)
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
      <div className="relative w-full max-w-5xl h-[85vh] bg-[#14171d] border border-zinc-800 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="h-14 px-6 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-zinc-100 truncate max-w-sm">
              {item.name}
            </span>
            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
              <span>{formatBytes(item.size)}</span>
              <ArrowRight className="w-3 h-3 text-zinc-600" />
              <span className="text-emerald-400 font-medium">{formatBytes(item.outputSize)}</span>
              {savingsPercent !== null && savingsPercent > 0 && (
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-mono">
                  -{savingsPercent}%
                </span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Viewer */}
        <div
          ref={containerRef}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchMove={handleTouchMove}
          className="relative flex-1 bg-[#090b0e] overflow-hidden select-none cursor-ew-resize flex items-center justify-center"
        >
          {loading ? (
            <div className="flex flex-col items-center gap-2 text-zinc-400">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <span className="text-xs">Loading full-res comparison...</span>
            </div>
          ) : (
            <>
              {/* Output Image (Lớp nền) */}
              <div className="absolute inset-0 flex items-center justify-center p-4">
                {convertedSrc && (
                  <img
                    src={convertedSrc}
                    alt="Output"
                    className="max-h-full max-w-full object-contain pointer-events-none drop-shadow-md"
                  />
                )}
                <span className="absolute top-4 right-4 text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-md text-emerald-400 border border-emerald-500/20">
                  Output
                </span>
              </div>

              {/* Original Image (Lớp cắt trên) */}
              <div
                className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden pointer-events-none"
                style={{
                  clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)`,
                }}
              >
                {originalSrc && (
                  <img
                    src={originalSrc}
                    alt="Original"
                    className="max-h-full max-w-full object-contain drop-shadow-md"
                  />
                )}
                <span className="absolute top-4 left-4 text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-md text-zinc-300 border border-white/10">
                  Original
                </span>
              </div>

              {/* Divider Handle */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,1)] pointer-events-none flex items-center justify-center z-10"
                style={{ left: `${sliderPosition}%` }}
              >
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xl border-2 border-white/40">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="h-10 px-6 bg-[#101216] border-t border-zinc-800/80 flex items-center justify-center text-[11px] text-zinc-500 shrink-0">
          Click and drag anywhere to compare details • Press ESC to close
        </div>
      </div>
    </div>
  );
};