import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { 
  FolderInput, 
  FolderOutput, 
  Play, 
  Square, 
  Activity, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink,
  Sliders
} from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { VIDEO_CODECS, VIDEO_FPS_OPTIONS, VIDEO_OUTPUT_FORMATS } from '../../types/video';
import { ALL_OUTPUT_FORMATS } from '../../types/conversion';

type MenuKind = 'image-format' | 'video-format' | 'video-codec' | 'video-fps';

interface LogItem {
  mediaType?: string;
  id: string;
  sourceFile: string;
  outputFile?: string;
  outputSize?: number;
  success: boolean;
  error?: string;
  timestamp: string;
}

const formatBytes = (bytes?: number) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export const AutomationTab = () => {
  const settings = useSettingsStore();
  const [incomingPath, setIncomingPath] = useState<string>('');
  const [processedPath, setProcessedPath] = useState<string>('');
  const [isWatching, setIsWatching] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [openMenu, setOpenMenu] = useState<MenuKind | null>(null);

  useEffect(() => {
    const unlistenPromise = listen<any>('folder-automation-event', (event) => {
      const payload = event.payload;
      const newLog: LogItem = {
        id: crypto.randomUUID(),
        mediaType: payload.mediaType,
        sourceFile: payload.sourceFile,
        outputFile: payload.outputFile,
        outputSize: payload.outputSize,
        success: payload.success,
        error: payload.error,
        timestamp: payload.timestamp,
      };
      setLogs((prev) => [newLog, ...prev.slice(0, 49)]);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const handleSelectIncoming = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === 'string') {
      setIncomingPath(selected);
      if (!processedPath) {
        setProcessedPath(`${selected}/Processed`);
      }
    }
  };

  const handleSelectProcessed = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === 'string') {
      setProcessedPath(selected);
    }
  };

  const toggleWatcher = async () => {
    if (isWatching) {
      try {
        await invoke('stop_watch_automation');
        setIsWatching(false);
      } catch (e) {
        console.error('Stop watcher error:', e);
      }
    } else {
      if (!incomingPath || !processedPath) return;
      try {
        await invoke('start_watch_automation', {
          watchPath: incomingPath,
          outputPath: processedPath,
          options: {
            format: settings.format,
            quality: settings.quality,
            resizeMode: settings.resizeMode,
            targetWidth: Number(settings.targetWidth) || undefined,
            scalePercentage: Number(settings.scalePercentage) || undefined,
            maintainAspectRatio: settings.maintainAspectRatio,
            outputDirectory: processedPath,
            colorSpace: 'srgb',
          },
          videoOptions: {
            inputPath: '',
            outputFormat: settings.videoOutputFormat,
            videoCodec: settings.videoCodec,
            quality: settings.videoQuality,
            audio: settings.videoAudio,
            outputDirectory: processedPath,
            forceCfr: settings.videoForceCfr,
            targetFps: settings.videoForceCfr ? Number(settings.videoTargetFps) : null,
            outputFilename: null,
          },
        });
        setIsWatching(true);
      } catch (e) {
        console.error('Start watcher error:', e);
      }
    }
  };

  const profileMenu = (kind: MenuKind, value: string, options: Array<{ value: string; label: string }>, setValue: (value: string) => void, disabled = false) => <div className="relative min-w-0"><button type="button" disabled={disabled || isWatching} onClick={() => setOpenMenu(openMenu === kind ? null : kind)} className={`theme-surface-control h-8 min-w-24 rounded-lg border px-2 text-left text-[11px] flex items-center justify-between gap-2 ${disabled || isWatching ? 'opacity-50 cursor-not-allowed' : ''}`}><span className="truncate">{options.find((option) => option.value === value)?.label}</span><span className="text-zinc-500">⌄</span></button>{openMenu === kind && !disabled && !isWatching && <div className="theme-surface-elevated absolute z-30 mt-1 min-w-full rounded-lg border p-1 shadow-xl">{options.map((option) => <button type="button" key={option.value} onClick={() => { setValue(option.value); setOpenMenu(null); }} className={`theme-option w-full rounded-md px-2 py-1.5 text-left text-[11px] ${option.value === value ? 'bg-blue-600 text-white' : ''}`}>{option.label}</button>)}</div>}</div>;

  const handleReveal = async (path: string) => {
    try {
      await invoke('reveal_in_finder', { path });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden max-w-5xl mx-auto w-full gap-6">
      {/* Configuration Card */}
      <div className="bg-[#12141a] border border-zinc-800/80 rounded-3xl p-6 shadow-xl flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-500" /> Watch Folder Automation
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Automatically detect and convert any newly added images or RAW files in real-time.
            </p>
          </div>

          <button
            onClick={toggleWatcher}
            disabled={!incomingPath || !processedPath}
            className={`h-9 px-5 rounded-2xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer shadow-lg ${
              isWatching
                ? 'bg-red-600/80 hover:bg-red-600 text-white shadow-red-600/20'
                : incomingPath && processedPath
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/25 active:scale-95'
                : 'theme-disabled-control cursor-not-allowed'
            }`}
          >
            {isWatching ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" /> Stop Watcher
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" /> Start Live Watcher
              </>
            )}
          </button>
        </div>

        {/* Path Selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* Incoming Folder */}
          <div
            onClick={!isWatching ? handleSelectIncoming : undefined}
            className={`theme-surface-control p-3.5 rounded-2xl border transition flex items-center justify-between ${
              isWatching ? 'opacity-70 cursor-not-allowed border-zinc-800' : 'border-zinc-800 hover:border-zinc-700 cursor-pointer'
            }`}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <FolderInput className="w-4 h-4" />
              </div>
              <div className="flex flex-col truncate">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  1. Incoming Folder (Watch)
                </span>
                <span className="text-xs text-zinc-200 truncate font-mono mt-0.5">
                  {incomingPath || 'Choose folder to watch...'}
                </span>
              </div>
            </div>
          </div>

          {/* Processed Folder */}
          <div
            onClick={!isWatching ? handleSelectProcessed : undefined}
            className={`theme-surface-control p-3.5 rounded-2xl border transition flex items-center justify-between ${
              isWatching ? 'opacity-70 cursor-not-allowed border-zinc-800' : 'border-zinc-800 hover:border-zinc-700 cursor-pointer'
            }`}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <FolderOutput className="w-4 h-4" />
              </div>
              <div className="flex flex-col truncate">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  2. Processed Folder (Export)
                </span>
                <span className="text-xs text-zinc-200 truncate font-mono mt-0.5">
                  {processedPath || 'Choose output folder...'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t theme-divider space-y-3">
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider"><span className="w-3.5 shrink-0"><Sliders className="w-3.5 h-3.5 text-zinc-500" /></span><span>Image Profile</span></div>
            <div className="flex flex-wrap items-center gap-2">
              {profileMenu('image-format', settings.format, ALL_OUTPUT_FORMATS.map((format) => ({ value: format.value, label: format.label })), (value) => settings.setFormat(value as typeof settings.format), false)}
              <label className="text-[11px] text-zinc-400 flex items-center gap-1">Quality <input type="number" min="1" max="100" disabled={isWatching} value={settings.quality} onChange={(event) => settings.setQuality(Number(event.target.value))} className="app-input w-16 h-8 rounded-lg px-2" /></label>
            </div>
          </div>
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider"><span className="w-3.5 shrink-0" aria-hidden="true" /><span>Video Profile</span></div>
            <div className="flex flex-wrap items-center gap-2">
              {profileMenu('video-format', settings.videoOutputFormat, VIDEO_OUTPUT_FORMATS.map((value) => ({ value, label: value.toUpperCase() })), (value) => settings.setVideoProfile({ videoOutputFormat: value as typeof settings.videoOutputFormat }))}
              {profileMenu('video-codec', settings.videoCodec, VIDEO_CODECS.map((codec) => ({ value: codec.value, label: codec.label })), (value) => settings.setVideoProfile({ videoCodec: value as typeof settings.videoCodec }))}
              <label className="text-[11px] text-zinc-400 flex items-center gap-1">Quality <input type="number" min="1" max="100" disabled={isWatching} value={settings.videoQuality} onChange={(event) => settings.setVideoProfile({ videoQuality: Number(event.target.value) })} className="app-input w-16 h-8 rounded-lg px-2" /></label>
            </div>
          </div>
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-3">
            <span />
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
            <label className="flex items-center gap-1.5"><input type="checkbox" disabled={isWatching} checked={settings.videoAudio} onChange={(event) => settings.setVideoProfile({ videoAudio: event.target.checked })} /> Preserve audio</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" disabled={isWatching} checked={settings.videoForceCfr} onChange={(event) => settings.setVideoProfile({ videoForceCfr: event.target.checked })} /> VFR → CFR</label>
            {profileMenu('video-fps', settings.videoTargetFps, VIDEO_FPS_OPTIONS.map((value) => ({ value, label: `${value} FPS` })), (value) => settings.setVideoProfile({ videoTargetFps: value }), !settings.videoForceCfr)}
            </div>
          </div>

          {/* Status Indicator */}
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isWatching ? 'bg-emerald-400 animate-ping' : 'bg-zinc-600'
              }`}
            />
            <span className="text-[11px] font-medium text-zinc-400">
              {isWatching ? 'Listening for incoming files...' : 'Idle'}
            </span>
          </div>
        </div>
      </div>

      {/* Realtime Activity Stream */}
      <div className="theme-surface-elevated flex-1 border rounded-3xl p-5 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-3 pb-2 border-b theme-divider">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Activity Stream
          </span>
          <span className="text-[10px] font-mono text-zinc-400">{logs.length} events</span>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {logs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2">
              <Sparkles className="w-6 h-6 stroke-[1.5]" />
              <span className="text-xs">No activity yet. Drop or copy new images or videos into the watched folder.</span>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="theme-surface-control p-3 rounded-2xl border flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  {log.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <div className="flex flex-col truncate">
                    <span className="font-medium text-zinc-200 truncate">
                      {log.mediaType === 'video' ? 'Video · ' : 'Image · '}{log.sourceFile.split('/').pop()}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {log.timestamp} • {log.outputSize ? formatBytes(log.outputSize) : log.error}
                    </span>
                  </div>
                </div>

                {log.outputFile && (
                  <button
                    onClick={() => handleReveal(log.outputFile!)}
                    className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg transition cursor-pointer"
                    title="Reveal in Finder"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
