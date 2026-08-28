import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { ArrowRightLeft, ChevronDown, FolderOpen, Loader2, X } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { VIDEO_CODECS, VIDEO_FPS_OPTIONS, VIDEO_OUTPUT_FORMATS } from '../../types/video';

type VideoInfo = { path: string; duration: number; width: number; height: number; codec: string };
type VideoItem = VideoInfo & { status: 'ready' | 'converting' | 'completed' | 'failed'; error?: string };
type MenuKind = 'format' | 'codec' | 'fps';
const videoExtensions = /\.(mp4|mov|mkv|webm|avi|m4v)$/i;
const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export const VideoConverterTab = ({ active = true }: { active?: boolean }) => {
  const settings = useSettingsStore();
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [outputDirectory, setOutputDirectory] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');
  const [openMenu, setOpenMenu] = useState<MenuKind | null>(null);

  const addVideos = async (paths: string[]) => {
    const valid = paths.filter((path) => videoExtensions.test(path));
    const existing = new Set(videos.map((video) => video.path));
    const candidates = valid.filter((path) => !existing.has(path));
    const probed = await Promise.allSettled(candidates.map((path) => invoke<VideoInfo>('probe_video', { path })));
    const loaded = probed.flatMap((result) => result.status === 'fulfilled' ? [{ ...result.value, status: 'ready' as const }] : []);
    setVideos((current) => [...current, ...loaded]);
    const rejected = paths.length - valid.length + probed.filter((result) => result.status === 'rejected').length;
    setMessage(rejected ? `${loaded.length} video(s) added; ${rejected} rejected.` : '');
  };

  useEffect(() => {
    if (!active) return;
    const drop = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') void addVideos(event.payload.paths);
    });
    return () => { drop.then((unlisten) => unlisten()); };
  }, [active, videos]);

  useEffect(() => {
    const progressListener = listen<{ filePath: string; status: string; error?: string; completed: number; total: number }>('video-batch-progress', (event) => {
      const update = event.payload;
      setVideos((current) => current.map((video) => video.path === update.filePath ? { ...video, status: update.status as VideoItem['status'], error: update.error } : video));
      setProgress(`Converting ${Math.min(update.completed + (update.status === 'converting' ? 1 : 0), update.total)} of ${update.total}`);
    });
    return () => { progressListener.then((unlisten) => unlisten()); };
  }, []);

  const choose = async () => {
    const selected = await open({ multiple: true, filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }] });
    if (Array.isArray(selected)) await addVideos(selected);
  };
  const chooseOutputDirectory = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') setOutputDirectory(selected);
  };
  const convert = async () => {
    if (!videos.length || busy) return;
    setBusy(true); setMessage(''); setProgress(`Converting 1 of ${videos.length}`);
    try {
      const outputs = await invoke<string[]>('convert_videos', { batch: { inputPaths: videos.map((video) => video.path), outputFormat: settings.videoOutputFormat, videoCodec: settings.videoCodec, quality: settings.videoQuality, audio: settings.videoAudio, outputDirectory: outputDirectory || null, forceCfr: settings.videoForceCfr, targetFps: settings.videoForceCfr ? Number(settings.videoTargetFps) : null } });
      setMessage(`Completed ${outputs.length} of ${videos.length} video(s).`);
    } catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  };
  const menu = (kind: MenuKind, value: string, label: string, options: Array<{ value: string; label: string }>, setValue: (value: string) => void, disabled = false) => <div className="relative min-w-0"><span className={`text-xs ${disabled ? 'text-zinc-600' : 'text-zinc-400'}`}>{label}</span><button type="button" disabled={disabled} onClick={() => setOpenMenu(openMenu === kind ? null : kind)} className={`theme-surface-control mt-1 h-10 w-full rounded-xl border px-3 text-xs flex items-center justify-between transition focus:outline-none focus:border-blue-500 ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}><span className="uppercase tracking-wide truncate">{options.find((option) => option.value === value)?.label}</span><ChevronDown className="w-3.5 h-3.5 shrink-0 text-zinc-500" /></button>{openMenu === kind && !disabled && <div className="theme-surface-elevated absolute z-20 mt-1 w-full rounded-xl border p-1.5 shadow-2xl">{options.map((option) => <button type="button" key={option.value} onClick={() => { setValue(option.value); setOpenMenu(null); }} className={`theme-option w-full rounded-lg px-3 py-2 text-left text-xs transition ${option.value === value ? 'bg-blue-600 text-white' : ''}`}>{option.label}</button>)}</div>}</div>;

  return <main className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full"><div className="bg-[#12141a] border border-zinc-800/80 rounded-3xl p-6 space-y-6"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold flex items-center gap-2"><ArrowRightLeft className="w-4 h-4 text-blue-400" /> Video Converter</h2><p className="text-xs text-zinc-500 mt-1">Convert H.264/H.265 MP4, MOV, MKV and WebM files locally.</p></div><button onClick={choose} className="px-3 py-2 rounded-xl bg-blue-600 text-xs font-medium flex items-center gap-2"><FolderOpen className="w-3.5 h-3.5" /> Choose videos</button></div>{videos.length ? <><div className="space-y-2">{videos.map((video) => <div key={video.path} className="app-info-surface flex items-center justify-between p-3 rounded-xl text-xs"><div className="min-w-0"><div className="font-medium truncate">{video.path.split('/').pop()}</div><div className="text-[10px] text-zinc-500 font-mono">{video.codec} · {video.width}×{video.height} · {duration(video.duration)} · {video.status}</div>{video.error && <div className="text-[10px] text-red-400 truncate">{video.error}</div>}</div><button type="button" disabled={busy} onClick={() => setVideos((current) => current.filter((item) => item.path !== video.path))} className="p-1 text-zinc-400 hover:text-red-400 disabled:opacity-40"><X className="w-3.5 h-3.5" /></button></div>)}</div><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{menu('format', settings.videoOutputFormat, 'Output format', VIDEO_OUTPUT_FORMATS.map((format) => ({ value: format, label: format })), (value) => settings.setVideoProfile({ videoOutputFormat: value as typeof settings.videoOutputFormat }))}{menu('codec', settings.videoCodec, 'Video codec', VIDEO_CODECS.map((codec) => ({ value: codec.value, label: codec.label })), (value) => settings.setVideoProfile({ videoCodec: value as typeof settings.videoCodec }))}<label className="text-xs text-zinc-400">Quality ({settings.videoQuality})<input type="range" min="1" max="100" value={settings.videoQuality} onChange={(e) => settings.setVideoProfile({ videoQuality: Number(e.target.value) })} className="mt-3 w-full accent-blue-500" /></label><div className="text-xs text-zinc-400"><span>Output folder</span><button type="button" onClick={chooseOutputDirectory} className="theme-surface-control mt-1 w-full h-10 rounded-xl border px-3 text-left text-xs truncate transition">{outputDirectory || 'Same as input'}</button></div></div><div className="flex flex-wrap items-end gap-3 text-xs text-zinc-300"><label className="flex items-center gap-2 h-10"><input type="checkbox" checked={settings.videoForceCfr} onChange={(e) => settings.setVideoProfile({ videoForceCfr: e.target.checked })} /> Convert VFR to CFR</label>{menu('fps', settings.videoTargetFps, 'Target FPS', VIDEO_FPS_OPTIONS.map((fps) => ({ value: fps, label: `${fps} FPS` })), (value) => settings.setVideoProfile({ videoTargetFps: value }), !settings.videoForceCfr)}<label className="flex items-center gap-2 h-10"><input type="checkbox" checked={settings.videoAudio} onChange={(e) => settings.setVideoProfile({ videoAudio: e.target.checked })} /> Preserve audio</label></div><button onClick={convert} disabled={busy} className="px-4 py-2 rounded-xl bg-blue-600 disabled:bg-zinc-700 text-xs font-semibold flex items-center gap-2">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{busy ? 'Converting…' : 'Convert videos'}</button>{progress && <p className="text-xs text-blue-400">{progress}</p>}{message && <p className="text-xs text-zinc-400">{message}</p>}</> : <div onClick={choose} className="h-48 border border-dashed border-zinc-700 rounded-2xl flex items-center justify-center text-xs text-zinc-500 cursor-pointer">Drop videos here or choose files</div>}</div></main>;
};
