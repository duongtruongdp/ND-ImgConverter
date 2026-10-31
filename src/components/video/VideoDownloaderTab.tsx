import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { CloudDownload, FolderOpen, Loader2, Search } from 'lucide-react';
import { useMediaDownloadStore } from '../../stores/mediaDownloadStore';

type Variant = { formatId: string; label: string; resolution?: string; height?: number; container?: string; videoCodec?: string; audioAvailable: boolean; audioOnly?: boolean; estimatedFilesize?: number };
type PlaylistItem = { index: number; id: string; title: string; url?: string; duration?: number; thumbnail?: string; estimatedFilesize?: number };
type Metadata = { title: string; duration?: number; thumbnail?: string; uploader?: string; source?: string; poTokenProvider?: string; mediaKind?: string; collectionCount?: number; items?: PlaylistItem[]; variants: Variant[] };
type GalleryItem = { index: number; title: string; url: string; extension?: string; estimatedFilesize?: number };
type GalleryMetadata = { title: string; items: GalleryItem[] };
type Progress = { status: string; percent?: number; detail?: string; downloadedBytes?: number; totalBytes?: number; completedItems?: number; totalItems?: number };
type ErrorState = { kind: string; message: string; details?: string };

const AUTH_BROWSERS = [
  { value: 'none', label: 'Not needed' }, { value: 'chrome', label: 'Chrome' },
  { value: 'chromium', label: 'Chromium' }, { value: 'edge', label: 'Edge' },
  { value: 'firefox', label: 'Firefox' }, { value: 'brave', label: 'Brave' },
];
const formatDuration = (value?: number) => {
  if (value == null || !Number.isFinite(value) || value < 0) return 'Unknown duration';
  const totalSeconds = Math.floor(value); const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60); const seconds = totalSeconds % 60;
  return `${hours > 0 ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};
const formatBytes = (value?: number) => {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB']; let amount = value; let unit = -1;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unit]}`;
};
const parseDownloaderError = (value: unknown): ErrorState => {
  const raw = String(value); try { const parsed = JSON.parse(raw) as ErrorState; if (parsed.message) return parsed; } catch { /* Keep IPC errors concise. */ }
  return { kind: 'Downloader error', message: raw.slice(0, 240) };
};
const isSafeLocalOutput = (value: string) => value.length > 0 && !value.includes('\0') && !/^https?:\/\//i.test(value);

export const VideoDownloaderTab = ({ active = true }: { active?: boolean }) => {
  const [url, setUrl] = useState(''); const [authBrowser, setAuthBrowser] = useState('none');
  const [includePlaylist, setIncludePlaylist] = useState(false); const [selectedPlaylist, setSelectedPlaylist] = useState<number[]>([]);
  const [metadata, setMetadata] = useState<Metadata | null>(null); const [selectedFormat, setSelectedFormat] = useState('best');
  const [galleryMetadata, setGalleryMetadata] = useState<GalleryMetadata | null>(null); const [selectedGallery, setSelectedGallery] = useState<number[]>([]);
  const [playlistVisibleCount, setPlaylistVisibleCount] = useState(50); const [galleryVisibleCount, setGalleryVisibleCount] = useState(50);
  const [directory, setDirectory] = useState(''); const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null); const [error, setError] = useState<ErrorState | null>(null);
  const [message, setMessage] = useState(''); const [completedPath, setCompletedPath] = useState<string | null>(null);
  const jobs = useMediaDownloadStore((state) => state.jobs);
  const addJob = useMediaDownloadStore((state) => state.add); const updateJob = useMediaDownloadStore((state) => state.update);
  const removeJob = useMediaDownloadStore((state) => state.remove); const clearCompleted = useMediaDownloadStore((state) => state.clearCompleted); const retryJob = useMediaDownloadStore((state) => state.retry);
  const processingJob = useRef(false); const activeJobId = useRef<string | null>(null);

  const analyze = async () => {
    if (!url.trim() || busy) return; setBusy(true); setError(null); setMessage(''); setCompletedPath(null); setProgress(null); setMetadata(null); setGalleryMetadata(null);
    try { const result = await invoke<Metadata>('analyze_video_url', { request: { url, authBrowser: authBrowser === 'none' ? null : authBrowser, includePlaylist } }); setMetadata(result); setSelectedFormat('best'); setSelectedPlaylist(result.mediaKind === 'playlist' ? (result.items || []).map((item) => item.index) : []); setPlaylistVisibleCount(50); }
    catch (e) { setProgress(null); setError(parseDownloaderError(e)); } finally { setBusy(false); }
  };
  const chooseDirectory = async () => { const selected = await open({ directory: true, multiple: false }); if (typeof selected === 'string') setDirectory(selected); };
  const download = () => {
    if (!metadata || !selectedFormat || busy) return;
    if (metadata.mediaKind === 'playlist' && selectedPlaylist.length === 0) { setError({ kind: 'Nothing selected', message: 'Pick at least one item from the collection.' }); return; }
    const selected = metadata.variants.find((variant) => variant.formatId === selectedFormat);
    addJob({ id: crypto.randomUUID(), kind: 'video', url, title: metadata.title, formatId: selectedFormat, audioAvailable: selectedFormat === 'best' || selected?.audioAvailable === true, maxHeight: selected?.height ?? null, container: selected?.container ?? null, authBrowser: authBrowser === 'none' ? null : authBrowser, outputDirectory: directory || null, playlist: metadata.mediaKind === 'playlist', playlistItems: metadata.mediaKind === 'playlist' ? selectedPlaylist.join(',') : null, status: 'queued', progress: 0, createdAt: Date.now() });
    setMessage('Added to download queue'); setError(null);
  };
  const analyzeGallery = async () => {
    if (!url.trim() || busy) return; setBusy(true); setError(null); setMessage(''); setCompletedPath(null); setProgress({ status: 'starting' }); setMetadata(null); setGalleryMetadata(null);
    try { const result = await invoke<GalleryMetadata>('analyze_gallery_url', { request: { url, authBrowser: authBrowser === 'none' ? null : authBrowser } }); setGalleryMetadata(result); setSelectedGallery(result.items.map((item) => item.index)); setGalleryVisibleCount(50); }
    catch (e) { setProgress(null); setError(parseDownloaderError(e)); } finally { setBusy(false); }
  };
  const downloadGallery = () => {
    if (!galleryMetadata || selectedGallery.length === 0 || busy) return;
    addJob({ id: crypto.randomUUID(), kind: 'gallery', url, title: galleryMetadata.title, authBrowser: authBrowser === 'none' ? null : authBrowser, outputDirectory: directory || null, selectedIndices: selectedGallery, status: 'queued', progress: 0, createdAt: Date.now() });
    setMessage('Added images to download queue'); setError(null);
  };
  const openDownloadedFile = async () => { if (!completedPath || !isSafeLocalOutput(completedPath)) return; try { await openPath(completedPath); } catch (e) { setError({ kind: 'Could not open file', message: String(e) }); } };
  const revealDownloadedFile = async () => { if (!completedPath || !isSafeLocalOutput(completedPath)) return; try { await revealItemInDir(completedPath); } catch (e) { setError({ kind: 'Could not show file', message: String(e) }); } };
  const openJobOutput = async (path: string) => { if (!isSafeLocalOutput(path)) return; try { await openPath(path); } catch (e) { setError({ kind: 'Could not open file', message: String(e) }); } };
  const revealJobOutput = async (path: string) => { if (!isSafeLocalOutput(path)) return; try { await revealItemInDir(path); } catch (e) { setError({ kind: 'Could not show file', message: String(e) }); } };
  const cancelJob = async (id: string) => {
    if (activeJobId.current === id) { try { await invoke('cancel_media_download', { jobId: id }); } catch { /* The backend may already have exited. */ } }
    updateJob(id, { status: 'cancelled', error: 'Cancelled by the user.' });
  };

  useEffect(() => {
    if (!active || processingJob.current) return;
    const job = jobs.find((candidate) => candidate.status === 'queued');
    if (!job) return;
    processingJob.current = true; activeJobId.current = job.id; setBusy(true);
    updateJob(job.id, { status: 'analyzing', progress: 0, error: undefined });
    void (async () => {
      try {
        updateJob(job.id, { status: 'downloading' });
        const output = job.kind === 'gallery'
          ? await invoke<string>('download_gallery_url', { jobId: job.id, request: { url: job.url, authBrowser: job.authBrowser, outputDirectory: job.outputDirectory, selectedIndices: job.selectedIndices } })
          : await invoke<string>('download_video_url', { jobId: job.id, request: { url: job.url, formatId: job.formatId || 'best', audioAvailable: job.audioAvailable ?? true, maxHeight: job.maxHeight ?? null, container: job.container ?? null, authBrowser: job.authBrowser, outputDirectory: job.outputDirectory, playlist: job.playlist ?? false, playlistItems: job.playlistItems ?? null } });
        updateJob(job.id, { status: 'completed', progress: 100, outputPath: output, detail: output });
      } catch (reason) {
        const current = useMediaDownloadStore.getState().jobs.find((candidate) => candidate.id === job.id);
        if (current?.status !== 'cancelled') updateJob(job.id, { status: 'failed', error: parseDownloaderError(reason).message });
      } finally {
        activeJobId.current = null; processingJob.current = false; setBusy(false);
      }
    })();
  }, [active, jobs, updateJob]);

  useEffect(() => {
    if (!active) return; const listener = getCurrentWebview().onDragDropEvent((event) => { if (event.payload.type === 'drop') { const dropped = event.payload.paths.find((path) => /^https?:\/\//i.test(path)); if (dropped) setUrl(dropped); } });
    return () => { listener.then((unlisten) => unlisten()); };
  }, [active]);
  useEffect(() => { const subscription = listen<Progress>('download-progress', (event) => { setProgress(event.payload); if (activeJobId.current) updateJob(activeJobId.current, { status: event.payload.status === 'processing' ? 'processing' : 'downloading', progress: event.payload.percent ?? null, downloadedBytes: event.payload.downloadedBytes ?? null, totalBytes: event.payload.totalBytes ?? null, completedItems: event.payload.completedItems ?? null, totalItems: event.payload.totalItems ?? null, detail: event.payload.detail }); }); return () => { subscription.then((unlisten) => unlisten()); }; }, [updateJob]);

  return <main className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full"><div className="theme-surface-elevated border rounded-3xl p-6 space-y-5">
    <div><h2 className="text-sm font-semibold flex items-center gap-2"><CloudDownload className="w-4 h-4 text-blue-400" /> Media Downloader</h2><p className="text-xs text-zinc-500 mt-1">Paste a public media link. yt-dlp handles supported video and audio sites; image galleries use gallery-dl when available.</p></div>
    <div className="flex flex-wrap gap-2"><input value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void analyze(); }} placeholder="Paste a media URL" className="app-input h-10 min-w-0 flex-1 rounded-xl px-3 text-xs" /><button type="button" onClick={analyze} disabled={busy || !url.trim()} className="h-10 px-4 rounded-xl bg-blue-600 text-white text-xs font-semibold flex items-center gap-2 disabled:opacity-40"><Search className="w-3.5 h-3.5" /> {busy && !metadata && !galleryMetadata ? 'Analyzing…' : 'Analyze'}</button><button type="button" onClick={analyzeGallery} disabled={busy || !url.trim()} className="theme-surface-control h-10 rounded-xl border px-3 text-xs disabled:opacity-40">Image / gallery</button></div>
    <label className="flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={includePlaylist} onChange={(event) => setIncludePlaylist(event.target.checked)} /> Check playlist / collection</label>
    <details className="rounded-xl border border-zinc-800/70 px-3 py-2"><summary className="cursor-pointer list-none text-xs text-zinc-400">Sign-in (optional) <span className="ml-2 text-zinc-500">· {AUTH_BROWSERS.find((browser) => browser.value === authBrowser)?.label}</span></summary><div className="mt-2 flex flex-wrap items-center gap-3"><label className="sr-only" htmlFor="download-authentication">Browser session</label><select id="download-authentication" value={authBrowser} onChange={(event) => setAuthBrowser(event.target.value)} className="theme-surface-control h-9 min-w-36 appearance-none rounded-lg border px-3 text-xs">{AUTH_BROWSERS.filter((browser) => browser.value !== 'safari' || /mac/i.test(navigator.platform)).map((browser) => <option key={browser.value} value={browser.value}>{browser.label}</option>)}</select><span className="text-[10px] text-zinc-500">Use your browser session if this site asks you to sign in.</span></div></details>
    {metadata && <><div className="app-info-surface rounded-2xl p-3 flex gap-3">{metadata.thumbnail && <img src={metadata.thumbnail} alt="" className="w-32 h-20 object-cover rounded-lg bg-black" />}<div className="min-w-0"><div className="text-sm font-medium truncate">{metadata.title || 'Untitled media'}</div><div className="text-xs text-zinc-500 mt-1">{metadata.uploader || metadata.source || 'Public media'} · {formatDuration(metadata.duration)}{metadata.mediaKind === 'playlist' ? ` · ${metadata.collectionCount ?? '?'} items` : ''}</div>{metadata.poTokenProvider && <details className="mt-1 text-[10px] text-zinc-500"><summary className="cursor-pointer">Technical details</summary><p className="mt-1">Provider: {metadata.poTokenProvider}</p></details>}</div></div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3"><label className="text-xs text-zinc-400 md:col-span-2">Quality / format<div className="relative mt-1"><select value={selectedFormat} onChange={(event) => setSelectedFormat(event.target.value)} className="theme-surface-control h-10 w-full appearance-none rounded-xl border px-3 text-xs"><option value="best">Best Available</option>{metadata.variants.filter((variant) => variant.formatId !== 'best').map((variant) => <option key={variant.formatId} value={variant.formatId}>{variant.label}</option>)}</select></div></label><div className="text-xs text-zinc-400"><span>Output folder</span><button type="button" onClick={chooseDirectory} className="theme-surface-control mt-1 h-10 w-full rounded-xl border px-3 text-left truncate">{directory || 'Downloads folder'}</button></div></div>
    {metadata.mediaKind === 'playlist' && <div className="space-y-2 rounded-xl border border-zinc-800/80 p-3"><div className="flex items-center gap-2"><span className="text-xs text-zinc-400">Select items</span><span className="text-[10px] text-zinc-500">{selectedPlaylist.length} of {metadata.items?.length || metadata.collectionCount || 0}{metadata.collectionCount && metadata.collectionCount > (metadata.items?.length || 0) ? ' · first 200 shown' : ''}</span><button type="button" onClick={() => setSelectedPlaylist((metadata.items || []).map((item) => item.index))} className="theme-surface-control ml-auto rounded-lg border px-2 py-1 text-[10px]">All shown</button><button type="button" onClick={() => setSelectedPlaylist([])} className="theme-surface-control rounded-lg border px-2 py-1 text-[10px]">Clear</button></div><div className="max-h-56 space-y-1 overflow-auto">{(metadata.items || []).slice(0, playlistVisibleCount).map((item) => <label key={item.index} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-white/5"><input type="checkbox" checked={selectedPlaylist.includes(item.index)} onChange={(event) => setSelectedPlaylist((current) => event.target.checked ? [...current, item.index] : current.filter((index) => index !== item.index))} /><span className="w-8 text-zinc-500">#{item.index}</span><span className="min-w-0 flex-1 truncate">{item.title}</span><span className="text-zinc-500">{formatDuration(item.duration)}</span></label>)}</div>{(metadata.items?.length || 0) > playlistVisibleCount && <button type="button" onClick={() => setPlaylistVisibleCount((count) => Math.min(count + 50, metadata.items?.length || count))} className="theme-surface-control rounded-lg border px-2 py-1 text-[10px]">Show more</button>}</div>}
    <button type="button" onClick={download} disabled={busy || !selectedFormat || (metadata.mediaKind === 'playlist' && selectedPlaylist.length === 0)} className="h-10 px-4 rounded-xl bg-blue-600 text-white text-xs font-semibold flex items-center gap-2 disabled:opacity-40"><CloudDownload className="w-3.5 h-3.5" />{busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Downloading…</> : metadata.mediaKind === 'playlist' ? 'Download selected' : 'Download'}</button>{progress && <p className="text-xs text-blue-400">{progress.percent != null ? `${progress.percent.toFixed(1)}%` : progress.status}{progress.completedItems != null && progress.totalItems != null ? ` · Images ${progress.completedItems}/${progress.totalItems}` : ''}{progress.downloadedBytes != null ? ` · ${formatBytes(progress.downloadedBytes) || '0 B'}${progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ''}` : ''}{progress.detail ? ` · ${progress.detail}` : ''}</p>}{completedPath && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5"><p className="mr-auto text-xs text-emerald-400">{metadata.mediaKind === 'playlist' ? 'Collection downloaded' : message || 'Download complete'}</p><button type="button" onClick={() => void openDownloadedFile()} className="theme-surface-control flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs"><CloudDownload className="h-3.5 w-3.5" /> Open File</button><button type="button" onClick={() => void revealDownloadedFile()} className="theme-surface-control flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs"><FolderOpen className="h-3.5 w-3.5" /> Show in Finder / Explorer</button></div>}{message && !completedPath && <p className="text-xs text-emerald-400">{message}</p>}</>}
    {galleryMetadata && <div className="space-y-3 rounded-2xl border border-zinc-800/80 p-3"><div className="flex flex-wrap items-center gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{galleryMetadata.title}</p><p className="text-xs text-zinc-500">{selectedGallery.length} of {galleryMetadata.items.length} images selected</p></div><button type="button" onClick={() => setSelectedGallery(galleryMetadata.items.map((item) => item.index))} className="theme-surface-control rounded-lg border px-2 py-1.5 text-xs">Select All</button><button type="button" onClick={() => setSelectedGallery([])} className="theme-surface-control rounded-lg border px-2 py-1.5 text-xs">Clear</button></div><div className="max-h-72 space-y-1 overflow-auto">{galleryMetadata.items.slice(0, galleryVisibleCount).map((item) => <label key={item.index} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-white/5"><input type="checkbox" checked={selectedGallery.includes(item.index)} onChange={(event) => setSelectedGallery((current) => event.target.checked ? [...current, item.index] : current.filter((index) => index !== item.index))} /><span className="w-8 text-zinc-500">#{item.index}</span><span className="min-w-0 flex-1 truncate">{item.title}</span><span className="text-zinc-500">{item.extension || 'image'}</span></label>)}</div>{galleryMetadata.items.length > galleryVisibleCount && <button type="button" onClick={() => setGalleryVisibleCount((count) => Math.min(count + 50, galleryMetadata.items.length))} className="theme-surface-control rounded-lg border px-2 py-1 text-[10px]">Show more</button>}<div className="flex flex-wrap items-center gap-2"><button type="button" onClick={chooseDirectory} className="theme-surface-control rounded-lg border px-2.5 py-2 text-xs">{directory || 'Downloads folder'}</button><button type="button" onClick={downloadGallery} disabled={busy || selectedGallery.length === 0} className="h-9 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-40">Download Selected</button></div></div>}
    {completedPath && !metadata && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5"><p className="mr-auto text-xs text-emerald-400">{message || 'Images downloaded'}</p><button type="button" onClick={() => void openDownloadedFile()} className="theme-surface-control flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs"><CloudDownload className="h-3.5 w-3.5" /> Open Folder</button><button type="button" onClick={() => void revealDownloadedFile()} className="theme-surface-control flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs"><FolderOpen className="h-3.5 w-3.5" /> Show in Finder / Explorer</button></div>}
    {jobs.length > 0 && <div className="space-y-2 rounded-2xl border border-zinc-800/80 p-3"><div className="flex items-center gap-2"><p className="text-sm font-medium">Download Queue</p><span className="text-xs text-zinc-500">{jobs.filter((job) => job.status === 'completed').length} done · {jobs.filter((job) => ['queued', 'analyzing', 'downloading', 'processing'].includes(job.status)).length} active</span><button type="button" onClick={clearCompleted} className="theme-surface-control ml-auto rounded-lg border px-2 py-1 text-[10px]">Clear completed</button></div><div className="max-h-64 space-y-1 overflow-auto">{jobs.map((job) => <div key={job.id} className="rounded-xl border border-zinc-800/70 p-2.5"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs font-medium">{job.title}</span><span className={`text-[10px] ${job.status === 'completed' ? 'text-emerald-400' : job.status === 'failed' ? 'text-red-400' : ['cancelled', 'interrupted'].includes(job.status) ? 'text-amber-400' : 'text-blue-300'}`}>{job.status === 'interrupted' ? 'Interrupted — ready to retry' : job.status}</span></div>{!['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status) && <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-blue-400 transition-all" style={{ width: `${Math.max(2, job.progress ?? 0)}%` }} /></div>}{job.error && <p className="mt-1 text-[10px] text-amber-300">{job.error}</p>}<div className="mt-1 flex flex-wrap gap-1"><span className="mr-auto text-[10px] text-zinc-500">{job.kind === 'gallery' ? `${job.selectedIndices?.length || 0} images` : job.playlist ? 'playlist' : 'single media'}</span>{job.status === 'completed' && job.outputPath && <><button type="button" onClick={() => void openJobOutput(job.outputPath!)} className="theme-surface-control rounded-md border px-2 py-1 text-[10px]">Open</button><button type="button" onClick={() => void revealJobOutput(job.outputPath!)} className="theme-surface-control rounded-md border px-2 py-1 text-[10px]">Show in Finder / Explorer</button></>}{['downloading', 'analyzing', 'processing'].includes(job.status) && <button type="button" onClick={() => void cancelJob(job.id)} className="theme-surface-control rounded-md border px-2 py-1 text-[10px]">Cancel</button>}{['failed', 'cancelled', 'interrupted'].includes(job.status) && <button type="button" onClick={() => retryJob(job.id)} className="theme-surface-control rounded-md border px-2 py-1 text-[10px]">Retry</button>}<button type="button" onClick={() => removeJob(job.id)} className="theme-surface-control rounded-md border px-2 py-1 text-[10px]">Remove</button></div></div>)}</div></div>}
    {error && <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs"><p className="font-medium text-red-400">{error.kind}</p><p className="mt-1 text-red-300">{error.message}</p><button type="button" onClick={download} disabled={busy || !metadata || !selectedFormat} className="mt-2 rounded-lg border border-red-500/20 px-2 py-1 text-red-300 hover:text-red-200 disabled:opacity-40">Try again</button>{error.details && <details className="mt-2"><summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">Show details</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px] text-zinc-500">{error.details}</pre></details>}</div>}
  </div></main>;
};
