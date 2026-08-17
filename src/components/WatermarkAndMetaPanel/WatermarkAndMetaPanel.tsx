// src/components/WatermarkAndMetaPanel/WatermarkAndMetaPanel.tsx
import React from 'react';
import { useSettingsStore, WatermarkPosition } from '../../stores/settingsStore';
import { 
  ShieldCheck, 
  Sparkles, 
  Type, 
  Image as ImageIcon, 
  FolderOpen,
  Eye
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';

const POSITIONS: { id: WatermarkPosition; label: string }[] = [
  { id: 'TopLeft', label: 'TL' },
  { id: 'TopCenter', label: 'TC' },
  { id: 'TopRight', label: 'TR' },
  { id: 'CenterLeft', label: 'CL' },
  { id: 'Center', label: 'C' },
  { id: 'CenterRight', label: 'CR' },
  { id: 'BottomLeft', label: 'BL' },
  { id: 'BottomCenter', label: 'BC' },
  { id: 'BottomRight', label: 'BR' },
];

export const WatermarkAndMetaPanel: React.FC = () => {
  const { 
    stripMetadata, 
    setStripMetadata, 
    watermark, 
    setWatermark 
  } = useSettingsStore();

  const handleSelectImage = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'PNG / WebP Image', extensions: ['png', 'webp'] }],
      });
      if (selected && typeof selected === 'string') {
        setWatermark({ ...watermark, imagePath: selected, isText: false });
      }
    } catch (err) {
      console.error('Failed to select watermark image:', err);
    }
  };

  // Calculate the CSS position for the preview frame.
  const getPreviewAlignment = () => {
    switch (watermark.position) {
      case 'TopLeft': return 'items-start justify-start p-2';
      case 'TopCenter': return 'items-start justify-center p-2';
      case 'TopRight': return 'items-start justify-end p-2';
      case 'CenterLeft': return 'items-center justify-start p-2';
      case 'Center': return 'items-center justify-center p-2';
      case 'CenterRight': return 'items-center justify-end p-2';
      case 'BottomLeft': return 'items-end justify-start p-2';
      case 'BottomCenter': return 'items-end justify-center p-2';
      default: return 'items-end justify-end p-2'; // BottomRight
    }
  };

  return (
    <div 
      onClick={(e) => e.stopPropagation()} 
      className="w-[380px] bg-[#12151b] border border-zinc-800 rounded-2xl p-4 shadow-2xl backdrop-blur-2xl text-zinc-300 space-y-4 select-none"
    >
      {/* 1. Strip Metadata Toggle */}
      <div 
        className="flex items-center justify-between pb-3 border-b border-zinc-800/80 cursor-pointer"
        onClick={() => setStripMetadata(!stripMetadata)}
      >
        <div className="flex items-center gap-2.5">
          <ShieldCheck className={`w-4 h-4 ${stripMetadata ? 'text-emerald-400' : 'text-zinc-500'}`} />
          <div>
            <div className="text-xs font-semibold text-zinc-100">Strip EXIF / Metadata</div>
            <div className="text-[10px] text-zinc-500">Remove GPS & camera tags for minimal size</div>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setStripMetadata(!stripMetadata);
          }}
          className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
            stripMetadata ? 'bg-blue-600' : 'bg-zinc-700'
          }`}
        >
          <div
            className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
              stripMetadata ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* 2. Watermark Overlay Toggle */}
      <div 
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setWatermark({ ...watermark, enabled: !watermark.enabled })}
      >
        <div className="flex items-center gap-2.5">
          <Sparkles className={`w-4 h-4 ${watermark.enabled ? 'text-blue-400' : 'text-zinc-500'}`} />
          <div>
            <div className="text-xs font-semibold text-zinc-100">Watermark Overlay</div>
            <div className="text-[10px] text-zinc-500">Stamp text or custom logo</div>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setWatermark({ ...watermark, enabled: !watermark.enabled });
          }}
          className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
            watermark.enabled ? 'bg-blue-600' : 'bg-zinc-700'
          }`}
        >
          <div
            className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
              watermark.enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* 3. Detailed Controls + Interactive Live Preview */}
      {watermark.enabled && (
        <div className="pt-2 space-y-3.5 border-t border-zinc-800/80 animate-in fade-in zoom-in-95 duration-150">
          
          {/* Live Mini Preview Box */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase font-semibold tracking-wider text-zinc-400 flex items-center gap-1">
                <Eye className="w-3 h-3 text-blue-400" /> Live Placement Preview
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">16:9 Canvas</span>
            </div>
            <div className={`w-full h-28 bg-[#090a0d] border border-zinc-700/60 rounded-xl relative flex overflow-hidden ${getPreviewAlignment()}`}>
              {/* Background Mockup Grid */}
              <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#3b82f6_1px,transparent_1px)] [background-size:12px_12px] pointer-events-none" />
              
              {/* Watermark Element */}
              <div 
                style={{ 
                  opacity: watermark.opacity,
                  fontSize: `${Math.max(9, Math.round(watermark.scalePercent * 0.9))}px`
                }}
                className="z-10 font-bold text-white tracking-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] max-w-[85%] truncate select-none border border-white/20 px-1.5 py-0.5 rounded bg-black/30 backdrop-blur-xs"
              >
                {watermark.isText 
                  ? (watermark.textContent || 'Watermark') 
                  : (watermark.imagePath ? '🖼️ [Logo Asset]' : '🖼️ [No Logo]')}
              </div>
            </div>
          </div>

          {/* Mode Switch: Text vs Logo */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-[#181b22] rounded-xl border border-zinc-800">
            <button
              onClick={() => setWatermark({ ...watermark, isText: true })}
              className={`flex items-center justify-center gap-1.5 py-1 text-[11px] font-medium rounded-lg transition-all cursor-pointer ${
                watermark.isText ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Type className="w-3 h-3" /> Text
            </button>
            <button
              onClick={() => setWatermark({ ...watermark, isText: false })}
              className={`flex items-center justify-center gap-1.5 py-1 text-[11px] font-medium rounded-lg transition-all cursor-pointer ${
                !watermark.isText ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <ImageIcon className="w-3 h-3" /> Logo
            </button>
          </div>

          {/* Input Text / File */}
          {watermark.isText ? (
            <input
              type="text"
              value={watermark.textContent}
              onChange={(e) => setWatermark({ ...watermark, textContent: e.target.value })}
              placeholder="e.g. © 2026 ND ImgConverter"
              className="w-full bg-[#161920] border border-zinc-700/80 rounded-xl px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-blue-500 font-sans"
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                readOnly
                value={watermark.imagePath ? watermark.imagePath.split('/').pop() : 'No logo selected...'}
                className="flex-1 bg-[#161920] border border-zinc-700/80 rounded-xl px-2.5 py-1.5 text-xs text-zinc-400 truncate outline-none font-mono"
              />
              <button
                onClick={handleSelectImage}
                className="h-8 px-2.5 bg-[#202530] hover:bg-zinc-700 text-zinc-200 text-xs rounded-xl flex items-center gap-1 border border-zinc-700 transition cursor-pointer"
              >
                <FolderOpen className="w-3 h-3" /> Browse
              </button>
            </div>
          )}

          {/* Position Matrix + Sliders */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            {/* 9-Point Grid */}
            <div className="flex flex-col justify-between">
              <span className="text-[10px] uppercase font-semibold tracking-wider text-zinc-500">Anchor</span>
              <div className="grid grid-cols-3 gap-1 w-24 p-1 bg-[#161920] rounded-xl border border-zinc-800">
                {POSITIONS.map((pos) => (
                  <button
                    key={pos.id}
                    onClick={() => setWatermark({ ...watermark, position: pos.id })}
                    className={`h-6 text-[9px] font-bold rounded-md flex items-center justify-center transition-all cursor-pointer ${
                      watermark.position === pos.id
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-[#1e222b] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scale & Opacity */}
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[10px] text-zinc-400 mb-0.5 font-medium">
                  <span>Scale</span>
                  <span className="text-blue-400 font-mono">{watermark.scalePercent}%</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="35"
                  value={watermark.scalePercent}
                  onChange={(e) => setWatermark({ ...watermark, scalePercent: Number(e.target.value) })}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-[10px] text-zinc-400 mb-0.5 font-medium">
                  <span>Opacity</span>
                  <span className="text-blue-400 font-mono">{Math.round(watermark.opacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={watermark.opacity}
                  onChange={(e) => setWatermark({ ...watermark, opacity: Number(e.target.value) })}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};