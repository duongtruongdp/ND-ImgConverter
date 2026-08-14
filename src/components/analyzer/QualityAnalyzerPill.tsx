import React, { useMemo } from 'react';
import { Sparkles, TrendingDown, Gauge } from 'lucide-react';
import { useFileStore } from '../../stores/fileStore';
import { useSettingsStore } from '../../stores/settingsStore';

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export const QualityAnalyzerPill: React.FC = () => {
  const { files } = useFileStore();
  const { format, quality, setQuality } = useSettingsStore();

  const totalOriginalBytes = useMemo(() => {
    return files.reduce((acc, f) => acc + (f.size || 0), 0);
  }, [files]);

  // Estimate realtime
  const analysis = useMemo(() => {
    if (totalOriginalBytes === 0) {
      return { estBytes: 0, savings: 0, tier: 'Web Balanced', color: 'text-blue-400' };
    }

    const q = Math.max(1, Math.min(100, quality));
    let ratio = 0.5;

    if (format === 'webp') {
      ratio = 0.12 + Math.pow(q / 100, 2.2) * 0.48;
    } else if (format === 'avif') {
      ratio = 0.08 + Math.pow(q / 100, 2.4) * 0.42;
    } else if (format === 'jpeg') {
      ratio = 0.18 + Math.pow(q / 100, 2.0) * 0.62;
    } else if (format === 'png') {
      ratio = 0.85;
    }

    const estBytes = Math.round(totalOriginalBytes * ratio);
    const savings = Math.max(0, Math.round(((totalOriginalBytes - estBytes) / totalOriginalBytes) * 100));

    let tier = 'Web Balanced';
    let color = 'text-blue-400';

    if (q >= 92) {
      tier = 'Studio / Master Quality';
      color = 'text-emerald-400';
    } else if (q >= 80) {
      tier = 'High Fidelity';
      color = 'text-cyan-400';
    } else if (q >= 65) {
      tier = 'Web & Social Balanced';
      color = 'text-blue-400';
    } else {
      tier = 'High Compression';
      color = 'text-amber-400';
    }

    return { estBytes, savings, tier, color };
  }, [totalOriginalBytes, format, quality]);

  if (!['webp', 'jpeg', 'avif'].includes(format)) {
    return null;
  }

  return (
    <div className="h-8 px-3 rounded-xl bg-[#171a21] border border-zinc-800 flex items-center gap-3 shadow-sm group relative">
      <div className="flex items-center gap-2">
        <Gauge className="w-3.5 h-3.5 text-zinc-500" />
        <span className="text-xs text-zinc-400 font-medium">Quality</span>
        <input
          type="range"
          min="1"
          max="100"
          value={quality}
          onChange={(e) => setQuality(Number(e.target.value))}
          className="w-18 accent-blue-500 cursor-pointer h-1.5 bg-zinc-800 rounded-lg"
        />
        <span className="text-xs font-mono font-semibold text-zinc-200 w-7 text-right">
          {quality}%
        </span>
      </div>

      {files.length > 0 && (
        <div className="hidden lg:flex items-center gap-2 pl-2.5 border-l border-zinc-800 text-[11px]">
          <div className="flex items-center gap-1 text-emerald-400 font-medium">
            <TrendingDown className="w-3 h-3" />
            <span className="font-mono">~{formatBytes(analysis.estBytes)}</span>
          </div>

          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            -{analysis.savings}%
          </span>
        </div>
      )}

      {/* Floating Analyzer Card on Hover */}
      <div className="absolute bottom-11 left-0 w-72 bg-[#12151b] border border-zinc-800 rounded-2xl p-3.5 shadow-2xl backdrop-blur-2xl opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all pointer-events-none z-50">
        <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-zinc-800">
          <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-blue-400" /> Quality Analyzer
          </span>
          <span className={`text-[10px] font-medium font-mono ${analysis.color}`}>
            {analysis.tier}
          </span>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex justify-between text-zinc-400">
            <span>Original Total:</span>
            <span className="font-mono text-zinc-200">{formatBytes(totalOriginalBytes)}</span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span>Estimated Output:</span>
            <span className="font-mono text-emerald-400 font-medium">
              ~{formatBytes(analysis.estBytes)}
            </span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span>Estimated Savings:</span>
            <span className="font-mono text-emerald-400 font-medium">
              {analysis.savings}% reduction
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};