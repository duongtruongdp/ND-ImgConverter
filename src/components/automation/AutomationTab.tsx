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

interface LogItem {
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

  useEffect(() => {
    const unlistenPromise = listen<any>('folder-automation-event', (event) => {
      const payload = event.payload;
      const newLog: LogItem = {
        id: crypto.randomUUID(),
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
        });
        setIsWatching(true);
      } catch (e) {
        console.error('Start watcher error:', e);
      }
    }
  };

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
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
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
            className={`p-3.5 rounded-2xl bg-[#171a22] border transition flex items-center justify-between ${
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
            className={`p-3.5 rounded-2xl bg-[#171a22] border transition flex items-center justify-between ${
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

        {/* Workflow Profile Selected */}
        <div className="flex items-center justify-between pt-3 border-t border-zinc-800/80">
          <div className="flex items-center gap-2">
            <Sliders className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs text-zinc-400">Target Profile:</span>
            <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
              {settings.format} • {settings.quality}% Quality
            </span>
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
      <div className="flex-1 bg-[#12141a] border border-zinc-800/80 rounded-3xl p-5 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-800/80">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Activity Stream
          </span>
          <span className="text-[10px] font-mono text-zinc-400">{logs.length} events</span>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {logs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2">
              <Sparkles className="w-6 h-6 stroke-[1.5]" />
              <span className="text-xs">No activity yet. Drop or copy new images into the watched folder.</span>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="p-3 rounded-2xl bg-[#171a22] border border-zinc-800/80 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  {log.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <div className="flex flex-col truncate">
                    <span className="font-medium text-zinc-200 truncate">
                      {log.sourceFile.split('/').pop()}
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