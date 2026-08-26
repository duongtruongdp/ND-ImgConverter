import { useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Film, FolderOpen, Play, Download, Loader2 } from 'lucide-react';

type VideoInfo = { path: string; duration: number; width: number; height: number; codec: string };

const time = (seconds: number) => new Date(seconds * 1000).toISOString().slice(11, 19);

export const VideoToGifTab = () => {
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [inPoint, setInPoint] = useState(0);
  const [outPoint, setOutPoint] = useState(0);
  const [width, setWidth] = useState(640);
  const [fps, setFps] = useState(12);
  const [quality, setQuality] = useState(80);
  const [outputDirectory, setOutputDirectory] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chooseVideo = async () => {
    const selected = await open({ multiple: false, filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }] });
    if (!selected || typeof selected !== 'string') return;
    setError(null); setResult(null);
    try {
      const info = await invoke<VideoInfo>('probe_video', { path: selected });
      setVideo(info); setInPoint(0); setOutPoint(info.duration); setWidth(Math.min(1280, info.width));
    } catch (e) { setError(String(e)); }
  };

  const exportGif = async () => {
    if (!video || busy || outPoint <= inPoint) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const output = await invoke<string>('export_video_to_gif', { options: { inputPath: video.path, inPoint, outPoint, width, fps, quality, outputDirectory: outputDirectory || null } });
      setResult(output);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return <main className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full">
    <div className="bg-[#12141a] border border-zinc-800/80 rounded-3xl p-6 space-y-6">
      <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold flex items-center gap-2"><Film className="w-4 h-4 text-blue-400" /> Video to GIF</h2><p className="text-xs text-zinc-500 mt-1">Trim H.264, H.265, MP4/MOV/MKV and WebM videos locally.</p></div><button onClick={chooseVideo} className="px-3 py-2 rounded-xl bg-blue-600 text-xs font-medium flex gap-2 items-center"><FolderOpen className="w-3.5 h-3.5" /> Choose video</button></div>
      {!video ? <div onClick={chooseVideo} className="h-48 border border-dashed border-zinc-700 rounded-2xl flex flex-col items-center justify-center text-zinc-500 cursor-pointer"><Play className="w-8 h-8 mb-2" /><span className="text-xs">Choose a video to begin</span></div> : <>
        <video src={convertFileSrc(video.path)} controls className="w-full max-h-80 rounded-2xl bg-black" />
        <div className="text-xs text-zinc-400 font-mono">{video.codec} · {video.width}×{video.height} · {time(video.duration)}</div>
        <div className="space-y-2"><div className="flex justify-between text-xs"><span>Trim range</span><span className="font-mono text-blue-400">{time(inPoint)} — {time(outPoint)}</span></div><input aria-label="In point" type="range" min="0" max={video.duration} step="0.01" value={inPoint} onChange={e => setInPoint(Math.min(Number(e.target.value), outPoint - 0.01))} className="w-full accent-blue-500" /><input aria-label="Out point" type="range" min="0" max={video.duration} step="0.01" value={outPoint} onChange={e => setOutPoint(Math.max(Number(e.target.value), inPoint + 0.01))} className="w-full accent-emerald-500" /></div>
        <div className="grid grid-cols-4 gap-3"><label className="text-xs text-zinc-400">Width<input type="number" min="16" max="4096" value={width} onChange={e => setWidth(Number(e.target.value))} className="mt-1 w-full bg-zinc-900 rounded-lg p-2 text-zinc-100" /></label><label className="text-xs text-zinc-400">FPS<input type="number" min="1" max="60" value={fps} onChange={e => setFps(Number(e.target.value))} className="mt-1 w-full bg-zinc-900 rounded-lg p-2 text-zinc-100" /></label><label className="text-xs text-zinc-400">Quality ({quality})<input type="range" min="1" max="100" value={quality} onChange={e => setQuality(Number(e.target.value))} className="mt-3 w-full accent-blue-500" /></label><label className="text-xs text-zinc-400 col-span-1">Output folder<input placeholder="Same as input" value={outputDirectory} onChange={e => setOutputDirectory(e.target.value)} className="mt-1 w-full bg-zinc-900 rounded-lg p-2 text-zinc-100" /></label></div>
        <button onClick={exportGif} disabled={busy || outPoint <= inPoint} className="px-4 py-2 rounded-xl bg-blue-600 disabled:bg-zinc-700 text-xs font-semibold flex items-center gap-2">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} {busy ? 'Exporting…' : 'Export GIF'}</button>
        {result && <p className="text-xs text-emerald-400">Saved: {result}</p>}{error && <p className="text-xs text-red-400">{error}</p>}
      </>}
    </div>
  </main>;
};
