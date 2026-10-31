import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  Film,
  FolderOpen,
  Loader2,
  Maximize2,
  Minus,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import { useVideoGifStore, type GifQueueItem, type GifQueueStatus } from '../../stores/videoGifStore';
import {
  clampTime,
  fitTimeline,
  frameStep,
  isValidSelection,
  panTimeline as panTimelineForRange,
  percentForTime,
  snapToFrame,
  timeFromPointer,
  zoomTimeline,
  type TimelineRange,
} from './timeline';

type VideoInfo = {
  path: string;
  duration: number;
  width: number;
  height: number;
  codec: string;
  fps?: number;
  frameRateMode?: 'cfr' | 'vfr' | 'unknown' | string;
};

type Handle = 'in' | 'out' | 'playhead';
type RenderSummary = { successful: number; failed: number; cancelled: number; folders: string[] };

const videoExtensions = /\.(mp4|mov|mkv|webm|avi|m4v)$/i;
const formatTime = (value: number, withMilliseconds = false) => {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const fraction = withMilliseconds ? `.${String(Math.floor((safe % 1) * 1000)).padStart(3, '0')}` : '';
  return `${hours > 0 ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${fraction}`;
};
const fileName = (path: string) => path.split(/[\\/]/).pop() || path;
const sourceStem = (path: string) => fileName(path).replace(/\.[^.]+$/, '') || 'video';
const statusLabel: Record<GifQueueStatus, string> = { queued: 'Ready', rendering: 'Rendering', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' };
const statusClass: Record<GifQueueStatus, string> = { queued: 'text-zinc-400', rendering: 'text-blue-300', completed: 'text-emerald-400', failed: 'text-red-400', cancelled: 'text-amber-400' };
const isTextControl = (target: EventTarget | null) => Boolean((target as HTMLElement | null)?.closest('input, textarea, select, button, [contenteditable="true"]'));
const selectionViewport = (item: GifQueueItem, duration: number): TimelineRange => {
  const selectionDuration = Math.max(item.outPoint - item.inPoint, 0.001);
  const padding = Math.max(selectionDuration * 0.75, duration / 40);
  const span = Math.min(duration, Math.max(selectionDuration + padding * 2, duration / 20));
  const center = (item.inPoint + item.outPoint) / 2;
  const start = Math.max(0, Math.min(duration - span, center - span / 2));
  return { start, end: start + span };
};
const parseTimecode = (value: string) => {
  const text = value.trim();
  if (!text) return Number.NaN;
  if (!text.includes(':')) return Number(text);
  const parts = text.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
};
const parentDirectory = (path: string) => path.replace(/[\\/][^\\/]*$/, '') || path;

const tickStepFor = (range: TimelineRange, fps?: number) => {
  const span = Math.max(0.001, range.end - range.start);
  const frame = frameStep(fps);
  if (span <= 1.2 && frame > 0) return Math.max(frame, Math.ceil((span / frame) / 10) * frame);
  return [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((step) => span / step <= 10) || 900;
};
const buildTicks = (range: TimelineRange, fps?: number) => {
  const step = tickStepFor(range, fps);
  const first = Math.ceil(range.start / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= range.end + step / 2 && ticks.length < 32; value += step) ticks.push(Number(value.toFixed(6)));
  return ticks;
};

type TimelineTrackProps = {
  video: VideoInfo;
  visibleRange: TimelineRange;
  currentTime: number;
  inPoint: number;
  outPoint: number;
  ticks: number[];
  timelineRef: React.RefObject<HTMLDivElement | null>;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerStop: () => void;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  onMarkerPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, handle: 'in' | 'out') => void;
  onOverviewClick: (clientX: number, element: HTMLDivElement) => void;
};

const TimelineTrack = memo(({ video, visibleRange, currentTime, inPoint, outPoint, ticks, timelineRef, onPointerDown, onPointerMove, onPointerStop, onWheel, onMarkerPointerDown, onOverviewClick }: TimelineTrackProps) => (
  <>
    <div ref={timelineRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerStop} onPointerCancel={onPointerStop} onWheel={onWheel} className="relative h-24 cursor-crosshair select-none touch-none overflow-hidden rounded-lg" aria-label="Video timeline editor">
      <div className="absolute inset-x-0 top-0 h-6 border-b border-slate-500/20 text-[9px] font-mono text-slate-400">{ticks.map((tick) => <span key={tick} className="absolute top-0.5 -translate-x-1/2 whitespace-nowrap" style={{ left: `${percentForTime(tick, visibleRange)}%` }}>{formatTime(tick, tickStepFor(visibleRange, video.fps) < 1)}</span>)}</div>
      <div className="video-gif-track absolute inset-x-0 top-7 h-14 rounded-lg"><div className="absolute inset-y-0 rounded-md bg-blue-500/20" style={{ left: `${percentForTime(inPoint, visibleRange)}%`, right: `${100 - percentForTime(outPoint, visibleRange)}%` }} /><div className="video-gif-playhead absolute inset-y-0 w-px" style={{ left: `${percentForTime(currentTime, visibleRange)}%` }} /><button type="button" data-timeline-handle aria-label="Set Mark In" title={`Mark In ${formatTime(inPoint, true)}`} onPointerDown={(event) => onMarkerPointerDown(event, 'in')} className="absolute -top-1 bottom-[-6px] z-20 w-6 -translate-x-1/2 cursor-ew-resize" style={{ left: `${percentForTime(inPoint, visibleRange)}%` }}><span className="absolute left-1/2 top-0 h-7 w-1.5 -translate-x-1/2 rounded-full bg-blue-400 shadow-[0_0_0_2px_rgba(15,23,42,0.8)]" /><span className="absolute left-1/2 top-0 h-2.5 w-4 -translate-x-1/2 rounded-t bg-blue-400" /></button><button type="button" data-timeline-handle aria-label="Set Mark Out" title={`Mark Out ${formatTime(outPoint, true)}`} onPointerDown={(event) => onMarkerPointerDown(event, 'out')} className="absolute -top-1 bottom-[-6px] z-20 w-6 -translate-x-1/2 cursor-ew-resize" style={{ left: `${percentForTime(outPoint, visibleRange)}%` }}><span className="absolute left-1/2 top-0 h-7 w-1.5 -translate-x-1/2 rounded-full bg-emerald-400 shadow-[0_0_0_2px_rgba(15,23,42,0.8)]" /><span className="absolute left-1/2 top-0 h-2.5 w-4 -translate-x-1/2 rounded-t bg-emerald-400" /></button></div>
    </div>
    <div className="video-gif-overview-rail mt-1 h-2 cursor-pointer rounded-full" role="slider" aria-label="Timeline overview" aria-valuemin={0} aria-valuemax={video.duration} aria-valuenow={currentTime} onClick={(event) => onOverviewClick(event.clientX, event.currentTarget)}><div className="video-gif-overview-viewport h-full rounded-full" style={{ marginLeft: `${(visibleRange.start / video.duration) * 100}%`, width: `${((visibleRange.end - visibleRange.start) / video.duration) * 100}%` }} /></div>
  </>
));

const TimeField = ({ label, value, accent, onChange, onCommit }: { label: string; value: number; accent: string; onChange: (value: number) => void; onCommit: () => void }) => {
  const [draft, setDraft] = useState(formatTime(value, true));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(formatTime(value, true)); }, [editing, value]);
  return <label className="min-w-0 flex-1">
    <span className={`block text-[9px] font-semibold uppercase tracking-[0.12em] ${accent}`}>{label}</span>
    <input
      aria-label={label}
      type="text"
      inputMode="decimal"
      value={editing ? draft : formatTime(value, true)}
      onFocus={() => { setEditing(true); setDraft(formatTime(value, true)); }}
      onChange={(event) => { const next = event.target.value; setDraft(next); const parsed = parseTimecode(next); if (Number.isFinite(parsed)) onChange(parsed); }}
      onBlur={() => { const parsed = parseTimecode(draft); if (Number.isFinite(parsed)) onChange(parsed); setEditing(false); onCommit(); }}
      className="theme-surface-control mt-1 h-8 w-full rounded-lg border px-2 font-mono text-xs outline-none focus:border-blue-500"
    />
  </label>;
};

export const VideoToGifTab = ({ active = true }: { active?: boolean }) => {
  const queue = useVideoGifStore((state) => state.queue);
  const addQueueItem = useVideoGifStore((state) => state.add);
  const updateQueueItem = useVideoGifStore((state) => state.update);
  const removeQueueItem = useVideoGifStore((state) => state.remove);
  const duplicateQueueItem = useVideoGifStore((state) => state.duplicate);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [inPoint, setInPoint] = useState(0);
  const [outPoint, setOutPoint] = useState(0);
  const [width, setWidth] = useState(640);
  const [fps, setFps] = useState(12);
  const [quality, setQuality] = useState(80);
  const [outputDirectory, setOutputDirectory] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visibleRange, setVisibleRange] = useState<TimelineRange>({ start: 0, end: 0 });
  const [draggingHandle, setDraggingHandle] = useState<Handle | null>(null);
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renderingAll, setRenderingAll] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderTick, setRenderTick] = useState(Date.now());
  const [renderSession, setRenderSession] = useState<{ currentId: string | null; startedAt: number; completed: number; total: number }>({ currentId: null, startedAt: 0, completed: 0, total: 0 });
  const [renderSummary, setRenderSummary] = useState<RenderSummary | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const cancelRequested = useRef(false);

  const seek = useCallback((value: number) => {
    if (!video) return;
    const next = clampTime(value, video.duration);
    setCurrentTime(next);
    if (videoRef.current) videoRef.current.currentTime = next;
  }, [video]);

  const loadVideo = useCallback(async (path: string, selection?: GifQueueItem) => {
    setError(null); setMessage(''); setRenderSummary(null);
    try {
      const info = await invoke<VideoInfo>('probe_video', { path });
      const nextIn = selection ? clampTime(selection.inPoint, info.duration) : 0;
      const nextOut = selection ? clampTime(selection.outPoint, info.duration) : info.duration;
      setVideo(info); setInPoint(nextIn); setOutPoint(Math.max(nextIn, nextOut)); setCurrentTime(nextIn);
      setVisibleRange(selection ? selectionViewport(selection, info.duration) : fitTimeline(info.duration));
      setWidth(selection?.width ?? Math.min(1280, info.width)); setFps(selection?.fps ?? 12); setQuality(selection?.quality ?? 80); setOutputDirectory(selection?.outputDirectory ?? '');
      window.setTimeout(() => { if (videoRef.current) videoRef.current.currentTime = nextIn; }, 0);
    } catch (loadError) { setVideo(null); setError(String(loadError)); }
  }, []);

  useEffect(() => {
    if (!active) return;
    const listener = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        const candidate = event.payload.paths.find((path) => videoExtensions.test(path));
        if (candidate) void loadVideo(candidate); else setError('Please drop a supported video file.');
      }
    });
    return () => { listener.then((unlisten) => unlisten()); };
  }, [active, loadVideo]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setRenderTick(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (!active) return;
    let unlisten: (() => void) | undefined;
    void listen<number>('video-gif-progress', (event) => {
      const progress = Math.max(0, Math.min(1, Number(event.payload) || 0));
      setRenderProgress(progress);
      if (renderSession.currentId) updateQueueItem(renderSession.currentId, { progress, elapsedMs: renderSession.startedAt ? Date.now() - renderSession.startedAt : undefined });
    }).then((stop) => { unlisten = stop; });
    return () => { unlisten?.(); };
  }, [active, renderSession.currentId, renderSession.startedAt, updateQueueItem]);

  const chooseVideo = async () => {
    const selected = await open({ multiple: false, filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }] });
    if (typeof selected === 'string') { setSelectedQueueId(null); await loadVideo(selected); }
  };
  const chooseOutputDirectory = async () => { const selected = await open({ directory: true, multiple: false }); if (typeof selected === 'string') setOutputDirectory(selected); };

  const applyQueueItem = async (item: GifQueueItem) => {
    setSelectedQueueId(item.id);
    if (!video || video.path !== item.sourcePath) { await loadVideo(item.sourcePath, item); return; }
    setInPoint(clampTime(item.inPoint, video.duration)); setOutPoint(clampTime(item.outPoint, video.duration)); setWidth(item.width); setFps(item.fps); setQuality(item.quality); setOutputDirectory(item.outputDirectory); setVisibleRange(selectionViewport(item, video.duration)); seek(item.inPoint);
  };

  const updateFromPointer = useCallback((clientX: number, handle: Handle) => {
    if (!video || !timelineRef.current) return;
    const value = timeFromPointer(clientX, timelineRef.current.getBoundingClientRect(), visibleRange, video.duration);
    const next = snapToFrame(value, video.frameRateMode === 'vfr' ? undefined : video.fps, video.duration);
    const step = frameStep(video.frameRateMode === 'vfr' ? undefined : video.fps);
    if (handle === 'in') setInPoint(Math.min(next, outPoint - step)); else if (handle === 'out') setOutPoint(Math.max(next, inPoint + step)); else seek(next);
  }, [inPoint, outPoint, seek, video, visibleRange]);
  const handleTimelinePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => { if (event.button !== 0 || (event.target as HTMLElement).closest('[data-timeline-handle]')) return; event.currentTarget.setPointerCapture?.(event.pointerId); setDraggingHandle('playhead'); updateFromPointer(event.clientX, 'playhead'); }, [updateFromPointer]);
  const handleTimelinePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => { if (draggingHandle) updateFromPointer(event.clientX, draggingHandle); }, [draggingHandle, updateFromPointer]);
  const handleTimelinePointerStop = useCallback(() => setDraggingHandle(null), []);
  const handleMarkerPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, handle: 'in' | 'out') => { event.stopPropagation(); setDraggingHandle(handle); }, []);
  const handleZoom = useCallback((factor: number, anchor = currentTime) => { if (video) setVisibleRange((range) => zoomTimeline(range, video.duration, factor, anchor)); }, [currentTime, video]);
  const panTimeline = useCallback((deltaPixels: number) => {
    if (!video || !timelineRef.current || visibleRange.end <= visibleRange.start) return;
    setVisibleRange(panTimelineForRange(visibleRange, video.duration, deltaPixels, timelineRef.current.clientWidth));
  }, [video, visibleRange]);
  const handleTimelineWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => { if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) { event.preventDefault(); panTimeline(event.deltaX || event.deltaY); } }, [panTimeline]);
  const handleOverviewClick = useCallback((clientX: number, element: HTMLDivElement) => {
    if (!video) return;
    const rect = element.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * video.duration;
    const span = visibleRange.end - visibleRange.start;
    const start = Math.max(0, Math.min(video.duration - span, next - span / 2));
    setVisibleRange({ start, end: start + span });
  }, [video, visibleRange]);
  const togglePlayback = useCallback(() => { if (!videoRef.current) return; if (videoRef.current.paused) void videoRef.current.play(); else videoRef.current.pause(); }, []);
  const setInAtPlayhead = useCallback(() => { if (!video) return; const next = snapToFrame(currentTime, video.frameRateMode === 'vfr' ? undefined : video.fps, video.duration); setInPoint(Math.min(next, outPoint - frameStep(video.frameRateMode === 'vfr' ? undefined : video.fps))); }, [currentTime, outPoint, video]);
  const setOutAtPlayhead = useCallback(() => { if (!video) return; const next = snapToFrame(currentTime, video.frameRateMode === 'vfr' ? undefined : video.fps, video.duration); setOutPoint(Math.max(next, inPoint + frameStep(video.frameRateMode === 'vfr' ? undefined : video.fps))); }, [currentTime, inPoint, video]);
  const commitTimeFields = useCallback(() => { if (!video) return; setInPoint(snapToFrame(clampTime(inPoint, video.duration), video.frameRateMode === 'vfr' ? undefined : video.fps, video.duration)); setOutPoint(snapToFrame(clampTime(outPoint, video.duration), video.frameRateMode === 'vfr' ? undefined : video.fps, video.duration)); }, [inPoint, outPoint, video]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextControl(event.target) || !video) return;
      if (event.key === '1' && event.shiftKey) { event.preventDefault(); setVisibleRange(fitTimeline(video.duration)); }
      else if (event.key === '1') { event.preventDefault(); handleZoom(2); }
      else if (event.key === '2') { event.preventDefault(); handleZoom(0.5); }
      else if (event.key.toLowerCase() === 'i') { event.preventDefault(); setInAtPlayhead(); }
      else if (event.key.toLowerCase() === 'o') { event.preventDefault(); setOutAtPlayhead(); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const direction = event.key === 'ArrowLeft' ? -1 : 1; const step = frameStep(video.frameRateMode === 'vfr' ? undefined : video.fps) * (event.shiftKey ? 10 : 1); seek(currentTime + direction * step); }
      else if (event.key === ' ') { event.preventDefault(); togglePlayback(); }
      else if (event.key === 'Home') { event.preventDefault(); seek(inPoint); }
      else if (event.key === 'End') { event.preventDefault(); seek(outPoint); }
      else if (event.key === 'Enter' && !selectedQueueId) { event.preventDefault(); addToQueue(); }
    };
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
  });
  useEffect(() => {
    if (!draggingHandle) return;
    const move = (event: PointerEvent) => updateFromPointer(event.clientX, draggingHandle); const stop = () => setDraggingHandle(null);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
  }, [draggingHandle, visibleRange, video, inPoint, outPoint, currentTime, seek]);

  const validSelection = Boolean(video && isValidSelection(inPoint, outPoint, video.duration));
  const nextName = () => { const stem = sourceStem(video?.path ?? 'video'); let index = queue.length + 1; while (queue.some((item) => item.name === `${stem}_${String(index).padStart(3, '0')}.gif`)) index += 1; return `${stem}_${String(index).padStart(3, '0')}.gif`; };
  const snapshot = (name: string): GifQueueItem | null => !video || !validSelection ? null : ({ id: crypto.randomUUID(), sourcePath: video.path, sourceName: fileName(video.path), name, inPoint, outPoint, width, fps, quality, outputDirectory, status: 'queued' });
  const addToQueue = () => {
    if (!video) return;
    if (!validSelection) { setError('Choose an In/Out range with a duration greater than zero.'); return; }
    const item = snapshot(nextName()); if (!item) return; addQueueItem(item); setSelectedQueueId(null); setError(null); setMessage(`Added ${item.name} to the render queue.`);
  };
  const updateClip = () => {
    if (!selectedQueueId || !video) return;
    if (!validSelection) { setError('Choose an In/Out range with a duration greater than zero.'); return; }
    updateQueueItem(selectedQueueId, { sourcePath: video.path, sourceName: fileName(video.path), inPoint, outPoint, width, fps, quality, outputDirectory, status: 'queued', error: undefined, outputPath: undefined }); setMessage('Clip updated. Its saved settings are now refreshed.'); setError(null);
  };
  const renderOne = async (item: GifQueueItem) => {
    updateQueueItem(item.id, { status: 'rendering', progress: 0, error: undefined });
    setRenderProgress(0);
    setRenderSession((session) => ({ ...session, currentId: item.id, startedAt: Date.now() }));
    try {
      const output = await invoke<string>('export_video_to_gif', { options: { inputPath: item.sourcePath, inPoint: item.inPoint, outPoint: item.outPoint, width: item.width, fps: item.fps, quality: item.quality, outputDirectory: item.outputDirectory || null, outputFilename: item.name } });
      updateQueueItem(item.id, { status: 'completed', progress: 1, elapsedMs: renderSession.startedAt ? Date.now() - renderSession.startedAt : undefined, outputPath: output, error: undefined }); return true;
    } catch (renderError) { const detail = String(renderError); updateQueueItem(item.id, { status: /cancel/i.test(detail) ? 'cancelled' : 'failed', error: detail }); return false; }
  };
  const renderItems = async (items: GifQueueItem[]) => {
    if (!items.length || busy) return;
    setBusy(true); setRenderingAll(true); setError(null); setMessage(''); setRenderSummary(null); setRenderProgress(0); cancelRequested.current = false; setRenderSession({ currentId: null, startedAt: Date.now(), completed: 0, total: items.length });
    let successful = 0; let failed = 0; let cancelled = 0; const folders = new Set<string>();
    try {
      for (const item of items) {
        if (cancelRequested.current) { updateQueueItem(item.id, { status: 'cancelled', progress: 0, error: 'Rendering cancelled by user.' }); cancelled += 1; continue; }
        const ok = await renderOne(item); if (ok) successful += 1; else if (cancelRequested.current) cancelled += 1; else failed += 1;
        setRenderSession((session) => ({ ...session, completed: session.completed + 1 })); setRenderProgress(0);
        setMessage(`Rendered ${successful} of ${items.length} clip${items.length === 1 ? '' : 's'}…`);
        if (ok) { const latest = useVideoGifStore.getState().queue.find((candidate) => candidate.id === item.id); if (latest?.outputPath) folders.add(parentDirectory(latest.outputPath)); }
      }
    } finally {
      setBusy(false); setRenderingAll(false); setRenderProgress(0); setRenderSession({ currentId: null, startedAt: 0, completed: items.length, total: items.length }); setRenderSummary({ successful, failed, cancelled, folders: [...folders] });
      setMessage(`Render complete: ${successful} successful${failed ? ` · ${failed} failed` : ''}${cancelled ? ` · ${cancelled} cancelled` : ''}.`);
    }
  };
  const renderAll = () => void renderItems(queue.filter((item) => item.status !== 'completed'));
  const retryFailed = () => void renderItems(queue.filter((item) => item.status === 'failed'));
  const cancelRendering = async () => { cancelRequested.current = true; try { await invoke('cancel_video_gif_render'); } catch { /* The loop still stops between items. */ } };
  const startRename = (item: GifQueueItem) => { setRenameId(item.id); setRenameValue(item.name); };
  const commitRename = () => { if (!renameId) return; const next = renameValue.trim(); if (next) updateQueueItem(renameId, { name: next.endsWith('.gif') ? next : `${next}.gif`, status: 'queued', outputPath: undefined, error: undefined }); setRenameId(null); };
  const openOutput = async (item: GifQueueItem) => { if (!item.outputPath) { setError('This GIF has no completed output yet.'); return; } try { await openPath(item.outputPath); setError(null); } catch (openError) { setError(`Could not open ${item.name}: ${String(openError)}`); } };
  const revealOutput = async (item: GifQueueItem) => { if (!item.outputPath) { setError('This GIF has no completed output yet.'); return; } try { await revealItemInDir(item.outputPath); setError(null); } catch (revealError) { setError(`Could not reveal ${item.name}: ${String(revealError)}`); } };
  const openSummaryFolder = async () => {
    if (!renderSummary?.folders.length) return;
    if (renderSummary.folders.length > 1) { setMessage('Outputs span multiple folders; use Show in Finder/Explorer on each completed row.'); return; }
    try { await openPath(renderSummary.folders[0]); } catch (openError) { setError(`Could not open output folder: ${String(openError)}`); }
  };

  const statusCounts = useMemo(() => ({ pending: queue.filter((item) => item.status === 'queued' || item.status === 'cancelled').length, rendering: queue.filter((item) => item.status === 'rendering').length, completed: queue.filter((item) => item.status === 'completed').length, failed: queue.filter((item) => item.status === 'failed').length }), [queue]);
  const pendingItems = statusCounts.pending;
  const renderableItems = pendingItems + statusCounts.failed;
  const ticks = useMemo(() => video ? buildTicks(visibleRange, video.fps) : [], [video, visibleRange]);
  const zoomLevel = video && visibleRange.end > visibleRange.start ? Math.max(1, video.duration / (visibleRange.end - visibleRange.start)) : 1;
  const renderElapsed = renderSession.startedAt ? Math.max(0, renderTick - renderSession.startedAt) : 0;
  const currentRender = renderSession.currentId ? queue.find((item) => item.id === renderSession.currentId) : null;
  const PlaybackIcon = playing ? Pause : Play;

  return <main className="video-gif-workspace flex-1 overflow-y-auto p-4 md:p-6">
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <section className="video-gif-panel rounded-3xl border p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0"><div className="flex items-center gap-2"><Film className="h-4 w-4 text-blue-400" /><h2 className="text-base font-semibold text-zinc-100">Video to GIF</h2></div><p className="mt-1 truncate text-xs text-zinc-400">{video ? fileName(video.path) : 'Make a few GIF clips from one video.'}</p>{video && <p className="mt-1 text-xs text-slate-400">{video.width} × {video.height} · {video.fps ? `${video.fps.toFixed(2)} FPS` : 'FPS unavailable'} · {formatTime(video.duration)}</p>}</div>
          <button type="button" onClick={chooseVideo} className="theme-surface-control flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium"><FolderOpen className="h-4 w-4" /> Open video</button>
        </div>
        {!video ? <div onClick={chooseVideo} className="video-gif-empty mt-4 flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed"><Play className="mb-2 h-8 w-8" /><span className="text-sm">Open a video to get started</span><span className="mt-1 text-xs">Your queue stays saved.</span></div> : <>
          <div className="app-media-preview mt-5 rounded-2xl"><video ref={videoRef} src={convertFileSrc(video.path)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} className="block h-full w-full object-contain" /></div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-zinc-200"><button type="button" aria-label="Step one frame backward" title="Step one frame backward" onClick={() => seek(currentTime - frameStep(video.fps))} className="theme-surface-control rounded-lg border p-2"><SkipBack className="h-4 w-4" /></button><button type="button" aria-label={playing ? 'Pause video' : 'Play video'} title={playing ? 'Pause video' : 'Play video'} onClick={togglePlayback} className="rounded-full bg-blue-600 p-2.5"><PlaybackIcon className="h-4 w-4 fill-current" /></button><button type="button" aria-label="Step one frame forward" title="Step one frame forward" onClick={() => seek(currentTime + frameStep(video.fps))} className="theme-surface-control rounded-lg border p-2"><SkipForward className="h-4 w-4" /></button><span className="font-mono text-sm">{formatTime(currentTime, true)}</span><span className="text-zinc-500">/ {formatTime(video.duration, true)}</span><span className="ml-auto text-xs text-zinc-500">{video.frameRateMode === 'vfr' ? 'VFR timestamp mode' : 'Frame-aware seeking'}</span></div>
        </>}
      </section>

      {video && <>
        <section className="video-gif-panel rounded-2xl border p-3 md:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-zinc-100">Timeline</h3><p className="mt-0.5 text-[11px] text-zinc-500">Drag to pick a range. Use 1 / 2 to zoom.</p></div><div className="flex items-center gap-1"><button type="button" aria-label="Zoom out timeline" title="Zoom out" onClick={() => handleZoom(0.5)} className="theme-surface-control h-8 rounded-lg border px-2"><Minus className="h-3.5 w-3.5" /></button><span className="video-gif-info-card min-w-12 rounded-lg px-2 py-1.5 text-center text-xs font-semibold">{zoomLevel.toFixed(1)}×</span><button type="button" aria-label="Zoom in timeline" title="Zoom in" onClick={() => handleZoom(2)} className="theme-surface-control h-8 rounded-lg border px-2"><Plus className="h-3.5 w-3.5" /></button><button type="button" aria-label="Fit timeline" title="Fit" onClick={() => setVisibleRange(fitTimeline(video.duration))} className="theme-surface-control flex h-8 items-center gap-1 rounded-lg border px-2 text-xs"><Maximize2 className="h-3.5 w-3.5" /> Fit</button></div></div>
          <div className="video-gif-timeline-shell mt-2 rounded-xl p-1"><TimelineTrack video={video} visibleRange={visibleRange} currentTime={currentTime} inPoint={inPoint} outPoint={outPoint} ticks={ticks} timelineRef={timelineRef} onPointerDown={handleTimelinePointerDown} onPointerMove={handleTimelinePointerMove} onPointerStop={handleTimelinePointerStop} onWheel={handleTimelineWheel} onMarkerPointerDown={handleMarkerPointerDown} onOverviewClick={handleOverviewClick} /></div>
          <div className="video-gif-summary-row mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg px-2 py-1.5 text-xs"><div><span className="text-blue-300">In</span> <span className="font-mono text-zinc-100">{formatTime(inPoint, true)}</span></div><div><span className="text-emerald-300">Out</span> <span className="font-mono text-zinc-100">{formatTime(outPoint, true)}</span></div><div><span className="text-slate-400">Length</span> <span className="font-mono text-zinc-100">{formatTime(Math.max(0, outPoint - inPoint), true)}</span></div></div>
          <div className="mt-2 flex flex-wrap items-end gap-2"><TimeField label="In" value={inPoint} accent="text-blue-300" onChange={(value) => setInPoint(clampTime(value, Math.max(0, outPoint - frameStep(video.fps))))} onCommit={commitTimeFields} /><TimeField label="Out" value={outPoint} accent="text-emerald-300" onChange={(value) => setOutPoint(Math.max(inPoint + frameStep(video.fps), Math.min(video.duration, value)))} onCommit={commitTimeFields} /><button type="button" onClick={setInAtPlayhead} className="theme-surface-control h-8 rounded-lg border px-2.5 text-xs">Set In</button><button type="button" onClick={setOutAtPlayhead} className="theme-surface-control h-8 rounded-lg border px-2.5 text-xs">Set Out</button><button type="button" onClick={() => setVisibleRange(fitTimeline(video.duration))} className="theme-surface-control h-8 rounded-lg border px-2.5 text-xs">Fit</button></div>
          {video.frameRateMode === 'vfr' && <div className="mt-2 flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-1.5 text-[11px] text-amber-300"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> VFR video: markers use timestamps.</div>}
        </section>

        <section className="video-gif-panel rounded-2xl border p-4 md:p-5">
          <div className="flex flex-wrap items-end gap-3"><div className="flex-1"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-300"><SlidersHorizontal className="h-3.5 w-3.5 text-blue-400" /> GIF settings</div><div className="grid grid-cols-2 gap-3 md:grid-cols-4"><label className="text-[11px] text-zinc-400">Width<input aria-label="GIF width" type="number" min="16" max="4096" value={width} onChange={(event) => setWidth(Number(event.target.value))} className="theme-surface-control mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label><label className="text-[11px] text-zinc-400">FPS<input aria-label="GIF FPS" type="number" min="1" max="60" value={fps} onChange={(event) => setFps(Number(event.target.value))} className="theme-surface-control mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label><label className="text-[11px] text-zinc-400">Quality <span className="text-zinc-200">{quality}</span><input aria-label="GIF quality" type="range" min="1" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} className="mt-3 w-full accent-blue-500" /></label><div className="text-[11px] text-zinc-400">Output folder<button type="button" onClick={chooseOutputDirectory} title="Choose output folder" className="theme-surface-control mt-1 flex h-10 w-full items-center gap-2 rounded-xl border px-3 text-left text-xs"><FolderOpen className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{outputDirectory || 'Same as input'}</span></button></div></div></div>{selectedQueueId ? <button type="button" onClick={updateClip} disabled={!validSelection || busy} className="h-10 rounded-xl bg-blue-600 px-4 text-xs font-semibold disabled:opacity-40"><Save className="mr-1 inline h-3.5 w-3.5" /> Update clip</button> : <button type="button" onClick={addToQueue} disabled={!validSelection || busy} className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold disabled:opacity-40"><Plus className="mr-1 inline h-4 w-4" /> Add clip <span className="text-blue-200">· Enter</span></button>}</div>{selectedQueueId && <p className="mt-2 text-[11px] text-amber-300">Editing a saved clip; changes apply only after Update.</p>}
        </section>
      </>}

      <section className="video-gif-panel rounded-2xl border p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold text-zinc-100">Render Queue</h3><p className="mt-0.5 text-xs text-zinc-400">{statusCounts.completed} done · {pendingItems} pending{statusCounts.failed ? ` · ${statusCounts.failed} failed` : ''}{statusCounts.rendering ? ` · ${statusCounts.rendering} rendering` : ''}</p></div><div className="flex flex-wrap items-center gap-2">{statusCounts.failed > 0 && <button type="button" onClick={retryFailed} disabled={busy} className="theme-surface-control h-8 rounded-lg border px-2.5 text-xs disabled:opacity-40"><RefreshCw className="mr-1 inline h-3.5 w-3.5" /> Retry failed</button>}{queue.length === 0 ? <span className="text-xs theme-text-muted">No clips yet</span> : renderableItems > 0 ? <button type="button" onClick={renderAll} disabled={busy} className="h-8 rounded-lg bg-blue-600 px-2.5 text-xs font-semibold disabled:opacity-40">Render {renderableItems}</button> : <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="h-4 w-4" /> All done</span>}{renderingAll && <button type="button" onClick={cancelRendering} className="h-8 rounded-lg border border-red-500/30 px-2.5 text-xs text-red-300"><Square className="mr-1 inline h-3.5 w-3.5 fill-current" /> Cancel</button>}</div></div>
        {queue.length === 0 ? <div className="video-gif-empty mt-3 rounded-lg border border-dashed px-3 py-2.5 text-xs theme-text-muted"><span className="font-medium theme-text-primary">No clips yet.</span> Pick a range, then add your first GIF.</div> : <div className="mt-3 space-y-2">{queue.map((item) => <div key={item.id} className={`video-gif-queue-row rounded-xl border p-3 transition ${selectedQueueId === item.id ? 'border-blue-500/50 bg-blue-500/5' : ''}`}><div className="flex flex-wrap items-center gap-3"><div className="video-gif-queue-thumb flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg"><Film className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="truncate text-sm font-medium text-zinc-100">{renameId === item.id ? <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') commitRename(); if (event.key === 'Escape') setRenameId(null); }} onBlur={commitRename} className="theme-surface-control rounded-lg border px-2 py-1 text-sm" /> : item.name}</span><span className={`flex items-center gap-1 text-xs ${statusClass[item.status]}`}>{item.status === 'rendering' && <Loader2 className="h-3 w-3 animate-spin" />}{item.status === 'completed' && <CheckCircle2 className="h-3 w-3" />}{statusLabel[item.status]}</span></div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-500"><span>{formatTime(item.inPoint, true)} → {formatTime(item.outPoint, true)}</span><span>{formatTime(item.outPoint - item.inPoint, true)}</span><span>{item.width}px</span><span>{item.fps} FPS</span><span>Q{item.quality}</span></div>{item.status === 'rendering' && <div className="mt-2 flex items-center gap-2"><div className="video-gif-progress-track h-1.5 flex-1 overflow-hidden rounded-full"><div className="h-full rounded-full bg-blue-400 transition-all" style={{ width: `${Math.max(3, Math.round((item.progress ?? renderProgress) * 100))}%` }} /></div><span className="text-[10px] text-blue-300">{Math.round((item.progress ?? renderProgress) * 100)}% · {formatTime(renderElapsed / 1000, true)}</span></div>}{item.error && <div className="mt-1 break-words text-[10px] text-red-400">{item.error}</div>}{item.outputPath && item.status === 'completed' && <div className="mt-1 truncate text-[10px] text-emerald-400">Saved: {item.outputPath}</div>}</div><div className="flex shrink-0 items-center gap-1"><button type="button" aria-label="Select and edit clip" title="Edit clip" onClick={() => void applyQueueItem(item)} className="theme-surface-control rounded-lg border p-2"><Eye className="h-3.5 w-3.5" /></button>{item.status === 'completed' && <><button type="button" aria-label="Open GIF" title="Open GIF" onClick={() => void openOutput(item)} className="theme-surface-control flex items-center gap-1 rounded-lg border px-2 py-2 text-xs"><Play className="h-3.5 w-3.5" /> Open GIF</button><button type="button" aria-label="Show GIF in Finder or Explorer" title="Show in Finder / Explorer" onClick={() => void revealOutput(item)} className="theme-surface-control rounded-lg border p-2"><Search className="h-3.5 w-3.5" /></button></>}<details className="relative"><summary aria-label="More actions" title="More actions" className="theme-surface-control flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg border"><MoreHorizontal className="h-4 w-4" /></summary><div className="theme-surface-elevated absolute right-0 top-10 z-30 min-w-36 rounded-xl border p-1 shadow-xl"><button type="button" onClick={() => startRename(item)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs video-gif-menu-item"><Save className="h-3.5 w-3.5" /> Rename</button><button type="button" onClick={() => duplicateQueueItem(item.id, `${item.name.replace(/\.gif$/i, '')}-copy.gif`)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs video-gif-menu-item"><Copy className="h-3.5 w-3.5" /> Duplicate</button><button type="button" disabled={busy} onClick={() => void renderItems([item])} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs video-gif-menu-item disabled:opacity-40"><Download className="h-3.5 w-3.5" /> Render this clip</button><button type="button" disabled={busy} onClick={() => { removeQueueItem(item.id); if (selectedQueueId === item.id) setSelectedQueueId(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs video-gif-menu-item video-gif-menu-danger disabled:opacity-40"><X className="h-3.5 w-3.5" /> Remove</button></div></details></div></div></div>)}</div>}
        {renderSession.currentId && currentRender && <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs"><Loader2 className="h-4 w-4 animate-spin text-blue-300" /><span className="text-blue-200">Rendering {currentRender.name}</span><span className="text-zinc-400">{renderSession.completed}/{renderSession.total} processed · {formatTime(renderElapsed / 1000, true)} elapsed</span></div>}
        {renderSummary && <div className="mt-4 flex flex-wrap items-center gap-3 video-gif-queue-row rounded-xl border p-3 text-xs"><Check className="h-4 w-4 text-emerald-400" /><span>{renderSummary.successful} successful · {renderSummary.failed} failed · {renderSummary.cancelled} cancelled</span>{renderSummary.folders.length === 1 && <button type="button" onClick={() => void openSummaryFolder()} className="theme-surface-control rounded-lg border px-2 py-1.5 text-xs"><FolderOpen className="mr-1 inline h-3.5 w-3.5" /> Open Output Folder</button>}{renderSummary.folders.length > 1 && <span className="text-zinc-500">Outputs span multiple folders.</span>}</div>}
      </section>

      {(message || error) && <div className={`flex items-start gap-2 px-1 text-xs ${error ? 'text-red-400' : 'text-emerald-400'}`}>{error ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5" /> : <Check className="mt-0.5 h-3.5 w-3.5" />}<span>{error || message}</span></div>}
      <p className="px-1 text-[10px] text-zinc-600">1 / 2 zoom · Shift+1 fit · I/O set In/Out · Space play · Enter add</p>
    </div>
  </main>;
};
