import { useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { Film, FolderOpen, Play, Pause, Download, Loader2 } from 'lucide-react';

type VideoInfo = { path: string; duration: number; width: number; height: number; codec: string };

const time = (seconds: number) => new Date(seconds * 1000).toISOString().slice(11, 19);

export const VideoToGifTab = ({ active = true }: { active?: boolean }) => {
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [draggingHandle, setDraggingHandle] = useState<'in' | 'out' | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const loadVideo = async (selected: string) => {
    setError(null); setResult(null);
    try {
      const info = await invoke<VideoInfo>('probe_video', { path: selected });
      setVideo(info); setInPoint(0); setOutPoint(info.duration); setCurrentTime(0); setWidth(Math.min(1280, info.width));
    } catch (e) { setError(String(e)); }
  };

  useEffect(() => {
    if (!active) return;
    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        const candidate = event.payload.paths.find((path) => /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(path));
        if (candidate) void loadVideo(candidate);
      }
    });
    return () => { unlistenPromise.then((unlisten) => unlisten()); };
  }, [active]);

  const chooseVideo = async () => {
    const selected = await open({ multiple: false, filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }] });
    if (!selected || typeof selected !== 'string') return;
    await loadVideo(selected);
  };

  const chooseOutputDirectory = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') setOutputDirectory(selected);
  };

  const exportGif = async () => {
    if (!video || busy || outPoint <= inPoint) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const output = await invoke<string>('export_video_to_gif', { options: { inputPath: video.path, inPoint, outPoint, width, fps, quality, outputDirectory: outputDirectory || null } });
      setResult(output);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  const seekTimeline = (clientX: number, handle?: 'in' | 'out') => {
    if (!video || !timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const value = Math.max(0, Math.min(video.duration, ((clientX - rect.left) / rect.width) * video.duration));
    if (handle === 'in') setInPoint(Math.min(value, outPoint - 0.01));
    else if (handle === 'out') setOutPoint(Math.max(value, inPoint + 0.01));
    else { setCurrentTime(value); if (videoRef.current) videoRef.current.currentTime = value; }
  };

  const togglePlayback = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) void videoRef.current.play();
    else videoRef.current.pause();
  };

  useEffect(() => {
    if (!draggingHandle) return;
    const move = (event: PointerEvent) => seekTimeline(event.clientX, draggingHandle);
    const up = () => setDraggingHandle(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [draggingHandle, video, inPoint, outPoint]);

  return <main className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full">
    <div className="bg-[#12141a] border border-zinc-800/80 rounded-3xl p-6 space-y-6">
      <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold flex items-center gap-2"><Film className="w-4 h-4 text-blue-400" /> Video to GIF</h2><p className="text-xs text-zinc-500 mt-1">Trim H.264, H.265, MP4/MOV/MKV and WebM videos locally.</p></div><button onClick={chooseVideo} className="px-3 py-2 rounded-xl bg-blue-600 text-xs font-medium flex gap-2 items-center"><FolderOpen className="w-3.5 h-3.5" /> Choose video</button></div>
      {!video ? <div onClick={chooseVideo} className="h-48 border border-dashed border-zinc-700 rounded-2xl flex flex-col items-center justify-center text-zinc-500 cursor-pointer"><Play className="w-8 h-8 mb-2" /><span className="text-xs">Choose a video to begin</span></div> : <>
        <div className="relative rounded-2xl overflow-hidden bg-black"><video ref={videoRef} src={convertFileSrc(video.path)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} className="w-full max-h-80 block" /><div className="absolute bottom-3 left-3 right-3 rounded-xl bg-black/75 backdrop-blur-md px-3 py-2"><div ref={timelineRef} onPointerDown={(event) => seekTimeline(event.clientX)} className="relative h-7 cursor-pointer select-none"><div className="absolute top-3 left-0 right-0 h-1.5 rounded-full bg-white/25" /><div className="absolute top-3 h-1.5 rounded-full bg-blue-500/70" style={{ left: `${(inPoint / video.duration) * 100}%`, right: `${100 - (outPoint / video.duration) * 100}%` }} /><div className="absolute top-1 bottom-0 w-0.5 bg-white" style={{ left: `${(currentTime / video.duration) * 100}%` }} /><button aria-label="Set in point" onPointerDown={(event) => { event.stopPropagation(); setDraggingHandle('in'); }} className="absolute top-0 h-7 w-3 -translate-x-1/2 rounded bg-blue-400 border border-white cursor-ew-resize" style={{ left: `${(inPoint / video.duration) * 100}%` }} /><button aria-label="Set out point" onPointerDown={(event) => { event.stopPropagation(); setDraggingHandle('out'); }} className="absolute top-0 h-7 w-3 -translate-x-1/2 rounded bg-emerald-400 border border-white cursor-ew-resize" style={{ left: `${(outPoint / video.duration) * 100}%` }} /></div><div className="flex items-center gap-3 text-xs text-white"><button aria-label={isPlaying ? 'Pause' : 'Play'} onClick={togglePlayback} className="p-1 hover:text-blue-300">{isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}</button><span className="font-mono">{time(currentTime)} / {time(video.duration)}</span><span className="ml-auto text-blue-300">In {time(inPoint)} · Out {time(outPoint)}</span></div></div></div>
        <div className="text-xs text-zinc-400 font-mono">{video.codec} · {video.width}×{video.height} · {time(video.duration)}</div>
        <div className="flex gap-2"><input aria-label="In time" type="number" min="0" max={outPoint - 0.01} step="0.01" value={inPoint.toFixed(2)} onChange={e => setInPoint(Math.min(Number(e.target.value), outPoint - 0.01))} className="w-24 bg-zinc-900 rounded-lg p-2 text-xs" /><input aria-label="Out time" type="number" min={inPoint + 0.01} max={video.duration} step="0.01" value={outPoint.toFixed(2)} onChange={e => setOutPoint(Math.max(Number(e.target.value), inPoint + 0.01))} className="w-24 bg-zinc-900 rounded-lg p-2 text-xs" /><span className="text-[11px] text-zinc-500 self-center">Drag the blue and green handles on the playback bar</span></div>
        <div className="grid grid-cols-4 gap-3"><label className="text-xs text-zinc-400">Width<input type="number" min="16" max="4096" value={width} onChange={e => setWidth(Number(e.target.value))} className="mt-1 w-full bg-zinc-900 rounded-lg p-2 text-zinc-100" /></label><label className="text-xs text-zinc-400">FPS<input type="number" min="1" max="60" value={fps} onChange={e => setFps(Number(e.target.value))} className="mt-1 w-full bg-zinc-900 rounded-lg p-2 text-zinc-100" /></label><label className="text-xs text-zinc-400">Quality ({quality})<input type="range" min="1" max="100" value={quality} onChange={e => setQuality(Number(e.target.value))} className="mt-3 w-full accent-blue-500" /></label><div className="text-xs text-zinc-400 col-span-1"><span>Output folder</span><button type="button" onClick={chooseOutputDirectory} className="mt-1 w-full h-10 bg-[#161920] border border-zinc-800/80 hover:border-zinc-700 rounded-xl px-3 text-left text-xs text-zinc-300 truncate transition">{outputDirectory || 'Same as input'}</button></div></div>
        <button onClick={exportGif} disabled={busy || outPoint <= inPoint} className="px-4 py-2 rounded-xl bg-blue-600 disabled:bg-zinc-700 text-xs font-semibold flex items-center gap-2">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} {busy ? 'Exporting…' : 'Export GIF'}</button>
        {result && <p className="text-xs text-emerald-400">Saved: {result}</p>}{error && <p className="text-xs text-red-400">{error}</p>}
      </>}
    </div>
  </main>;
};
