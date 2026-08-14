import React from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { OutputFormat, ResizeMode } from '../../types/conversion';

export const SettingsPanel: React.FC = () => {
  const {
    format,
    setFormat,
    quality,
    setQuality,
    resizeMode,
    setResizeMode,
  } = useSettingsStore();

  return (
    <div className="flex flex-col gap-5 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
      <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Settings</h4>

      {/* Target Format */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Format</label>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as OutputFormat)}
          className="w-full text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-blue-500"
        >
          <option value="webp">WebP</option>
          <option value="jpeg">JPEG</option>
          <option value="png">PNG</option>
        </select>
      </div>

      {/* Quality Slider (Chỉ hiển thị với JPG/WebP) */}
      {format !== 'png' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Quality</span>
            <span className="text-zinc-500 font-mono">{quality}%</span>
          </div>
          <input
            type="range"
            min="1"
            max="100"
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="w-full accent-blue-500 cursor-pointer"
          />
        </div>
      )}

      {/* Resize Mode */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Resize Mode</label>
        <select
          value={resizeMode}
          onChange={(e) => setResizeMode(e.target.value as ResizeMode)}
          className="w-full text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-blue-500"
        >
          <option value="original">Original Size</option>
          <option value="width">Width (px)</option>
          <option value="percentage">Percentage (%)</option>
        </select>
      </div>
    </div>
  );
};