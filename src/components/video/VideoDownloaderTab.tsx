import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { CloudDownload, Loader2, Search } from 'lucide-react';

type Variant = { formatId: string; label: string; resolution?: string; height?: number; container?: string; videoCodec?: string; audioAvailable: boolean; estimatedFilesize?: number };
type Metadata = { title: string; duration?: number; thumbnail?: string; uploader?: string; source?: string; poTokenProvider?: string; variants: Variant[] };
type Progress = { status: string; percent?: number; detail?: string };
type ErrorState = { kind: string; message: string; details?: string };

const AUTH_BROWSERS = [
  { value: 'none', label: 'None' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'chromium', label: 'Chromium' },
  { value: 'edge', label: 'Edge' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'brave', label: 'Brave' },
];

const formatDuration = (value?: number) => value == null ? 'Unknown duration' : new Date(value * 1000).toISOString().slice(11, 19);
const parseDownloaderError = (value: unknown): ErrorState => {
  const raw = String(value);
  try { const parsed = JSON.parse(raw) as ErrorState; if (parsed.message) return parsed; } catch { /* Keep non-JSON IPC errors concise. */ }
  return { kind: 'Downloader error', message: raw.slice(0, 240) };
};

export const VideoDownloaderTab = ({ active = true }: { active?: boolean }) => {
  const [url, setUrl] = useState('');
  const [authBrowser, setAuthBrowser] = useState('none');
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [selectedFormat, setSelectedFormat] = useState('');
  const [directory, setDirectory] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [message, setMessage] = useState('');

  const analyze = async () => {
    if (!url.trim() || busy) return;
    setBusy(true); setError(null); setMessage(''); setMetadata(null);
    try { const result = await invoke<Metadata>('analyze_video_url', { request: { url, authBrowser: authBrowser === 'none' ? null : authBrowser } }); setMetadata(result); setSelectedFormat(result.variants[0]?.formatId ?? ''); }
    catch (e) { setError(parseDownloaderError(e)); } finally { setBusy(false); }
  };

  const chooseDirectory = async () => { const selected = await open({ directory: true, multiple: false }); if (typeof selected === 'string') setDirectory(selected); };

  const download = async () => {
    if (!metadata || !selectedFormat || busy) return;
    setBusy(true); setError(null); setMessage(''); setProgress({ status: 'starting' });
    const selected = metadata.variants.find((variant) => variant.formatId === selectedFormat);
    try { const output = await invoke<string>('download_video_url', { request: { url, formatId: selectedFormat, audioAvailable: selected?.audioAvailable ?? false, maxHeight: selected?.height ?? null, container: selected?.container ?? null, authBrowser: authBrowser === 'none' ? null : authBrowser, outputDirectory: directory || null } }); setMessage(`Saved: ${output}`); }
    catch (e) { setError(parseDownloaderError(e)); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!active) return;
    const listener = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        const dropped = event.payload.paths.find((path) => /^https?:\/\//i.test(path));
        if (dropped) setUrl(dropped);
      }
    });
    return () => { listener.then((unlisten) => unlisten()); };
  }, [active]);

  useEffect(() => { const subscription = listen<Progress>('download-progress', (event) => setProgress(event.payload)); return () => { subscription.then((unlisten) => unlisten()); }; }, []);

  return <main className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full"><div className="theme-surface-elevated border rounded-3xl p-6 space-y-5"><div><h2 className="text-sm font-semibold flex items-center gap-2"><CloudDownload className="w-4 h-4 text-blue-400" /> Video Downloader</h2><p className="text-xs text-zinc-500 mt-1">Download publicly accessible videos by URL using a bundled downloader engine.</p></div><div className="flex gap-2"><input value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void analyze(); }} placeholder="Paste a public video URL" className="app-input h-10 flex-1 rounded-xl px-3 text-xs" /><button type="button" onClick={analyze} disabled={busy || !url.trim()} className="h-10 px-4 rounded-xl bg-blue-600 text-white text-xs font-semibold flex items-center gap-2 disabled:opacity-40"><Search className="w-3.5 h-3.5" /> {busy && !metadata ? 'Analyzing…' : 'Analyze'}</button></div><div className="flex items-center gap-3"><label className="text-xs text-zinc-400" htmlFor="download-authentication">Authentication</label><select id="download-authentication" value={authBrowser} onChange={(event) => setAuthBrowser(event.target.value)} className="theme-surface-control h-9 min-w-36 appearance-none rounded-lg border px-3 text-xs">{AUTH_BROWSERS.filter((browser) => browser.value !== 'safari' || /mac/i.test(navigator.platform)).map((browser) => <option key={browser.value} value={browser.value}>{browser.label}</option>)}</select><span className="text-[10px] text-zinc-500">Uses cookies only from the browser you select.</span></div>{metadata && <><div className="app-info-surface rounded-2xl p-3 flex gap-3">{metadata.thumbnail && <img src={metadata.thumbnail} alt="" className="w-32 h-20 object-cover rounded-lg bg-black" />}<div className="min-w-0"><div className="text-sm font-medium truncate">{metadata.title}</div><div className="text-xs text-zinc-500 mt-1">{metadata.uploader || metadata.source || 'Public video'} · {formatDuration(metadata.duration)}</div><div className="text-[10px] text-zinc-500 mt-1">PO Token provider: {metadata.poTokenProvider || 'not reported'}</div></div></div><div className="grid grid-cols-1 md:grid-cols-3 gap-3"><label className="text-xs text-zinc-400 md:col-span-2">Quality / format<div className="relative mt-1"><select value={selectedFormat} onChange={(event) => setSelectedFormat(event.target.value)} className="theme-surface-control h-10 w-full appearance-none rounded-xl border px-3 text-xs"><option value="" disabled>Select a quality</option>{metadata.variants.map((variant) => <option key={variant.formatId} value={variant.formatId}>{variant.label}</option>)}</select></div></label><div className="text-xs text-zinc-400"><span>Output folder</span><button type="button" onClick={chooseDirectory} className="theme-surface-control mt-1 h-10 w-full rounded-xl border px-3 text-left truncate">{directory || 'Downloads folder'}</button></div></div><button type="button" onClick={download} disabled={busy || !selectedFormat} className="h-10 px-4 rounded-xl bg-blue-600 text-white text-xs font-semibold flex items-center gap-2 disabled:opacity-40"><CloudDownload className="w-3.5 h-3.5" />{busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Downloading…</> : 'Download'}</button>{progress && <p className="text-xs text-blue-400">{progress.percent != null ? `${progress.percent.toFixed(1)}%` : progress.status}{progress.detail ? ` · ${progress.detail}` : ''}</p>}{message && <p className="text-xs text-emerald-400">{message}</p>}</>}{error && <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs"><p className="font-medium text-red-400">{error.kind}</p><p className="mt-1 text-red-300">{error.message}</p>{error.details && <details className="mt-2"><summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">Show details</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px] text-zinc-500">{error.details}</pre></details>}</div>}</div></main>;
};
