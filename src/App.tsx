import React, { useEffect, useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { 
  Upload, 
  Trash2, 
  Play, 
  Square, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  Image as ImageIcon, 
  Plus, 
  Sparkles, 
  FolderOpen, 
  ExternalLink, 
  ArrowRight, 
  Eye, 
  Sliders,
  ChevronDown,
  Layers,
  Activity
  ,Sun, Moon, Camera
} from 'lucide-react';
import { useFileStore } from './stores/fileStore';
import { useSettingsStore, DEFAULT_PRESETS } from './stores/settingsStore';
import { ComparisonModal } from './components/comparison/ComparisonModal';
import { AutomationTab } from './components/automation/AutomationTab';
import { QualityAnalyzerPill } from './components/analyzer/QualityAnalyzerPill';
import { UpdateChecker } from './components/updater/UpdateChecker';
import { VideoToGifTab } from './components/video/VideoToGifTab';
import { VideoConverterTab } from './components/video/VideoConverterTab';
import { GrabStillsTab } from './components/video/GrabStillsTab';
import { ImageItem, ResizeMode, SUPPORTED_INPUT_EXTENSIONS, ALL_OUTPUT_FORMATS } from './types/conversion';

interface ProgressPayload {
  filePath: string;
  outputPath?: string;
  outputSize?: number;
  success: boolean;
  error?: string;
  completed: number;
  total: number;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export default function App() {
  const { files, removeFile, clearFiles, addFiles, updateFileStatus, updateBatchFileInfo } = useFileStore();
  const settings = useSettingsStore();
  
  const [currentTab, setCurrentTab] = useState<'converter' | 'automation' | 'video' | 'video-converter' | 'grab-stills'>('converter');
  const [isConverting, setIsConverting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [selectedComparisonItem, setSelectedComparisonItem] = useState<ImageItem | null>(null);
  const [isFormatMenuOpen, setIsFormatMenuOpen] = useState(false);
  
  const formatMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // 1. Scan the path and ingest files
  const processIncomingFiles = useCallback(async (rawPaths: string[]) => {
    try {
      const scannedPaths: string[] = await invoke('scan_dropped_paths', { paths: rawPaths });

      if (!scannedPaths || scannedPaths.length === 0) return;

      const newFiles: ImageItem[] = scannedPaths.map((p) => ({
        id: crypto.randomUUID(),
        path: p,
        name: p.split('/').pop() || p,
        size: 0,
        status: 'queued',
      }));

      addFiles(newFiles);

      const results: Array<any> = await invoke('fetch_batch_metadata', {
        paths: newFiles.map((f) => f.path),
      });

      const validResults = results
        .filter(Boolean)
        .map((res) => ({
          path: res.path,
          width: res.width,
          height: res.height,
          size: res.size,
          thumbnail: res.thumbnailBase64,
        }));

      updateBatchFileInfo(validResults);
    } catch (err) {
      console.error('Error processing incoming paths:', err);
    }
  }, [addFiles, updateBatchFileInfo]);

  // 2. Open the file selection dialog
  const handleSelectFiles = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: 'All Supported Formats', extensions: SUPPORTED_INPUT_EXTENSIONS },
          { name: 'Standard Formats', extensions: ['jpg', 'jpeg', 'png', 'webp', 'svg', 'gif', 'bmp', 'ico', 'tiff'] },
          { name: 'Camera RAW', extensions: ['arw', 'cr2', 'crw', 'dng', 'nef', 'orf', 'pef', 'raf', 'rw2'] }
        ],
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        processIncomingFiles(paths);
      }
    } catch (err) {
      console.error('Error opening dialog:', err);
    }
  }, [processIncomingFiles]);

  // 3. Drag and drop macOS / Windows windows
  const handleStartDragging = async (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement | null;
    if (
      e.button === 0 &&
      target &&
      !target.closest('button') &&
      !target.closest('input') &&
      !target.closest('.no-drag')
    ) {
      try {
        await getCurrentWindow().startDragging();
      } catch (err) {
        console.error('Failed to start window drag:', err);
      }
    }
  };

  // 4. Batch Convert
  const handleStartBatch = useCallback(async () => {
    if (files.length === 0 || isConverting) return;

    files.forEach((f) => {
      if (f.status !== 'completed') updateFileStatus(f.id, 'processing');
    });

    setIsConverting(true);
    setProgress({ completed: 0, total: files.length });

    try {
      await invoke('start_batch_conversion', {
        files: files.map((f) => f.path),
        options: {
          format: settings.format,
          quality: settings.quality,
          resizeMode: settings.resizeMode,
          targetWidth: Number(settings.targetWidth) || undefined,
          scalePercentage: Number(settings.scalePercentage) || undefined,
          maintainAspectRatio: settings.maintainAspectRatio,
          outputDirectory: settings.outputDirectory || null,
          colorSpace: 'srgb',
        },
      });
    } catch (err) {
      console.error('Batch convert failed:', err);
      setIsConverting(false);
    }
  }, [files, isConverting, settings, updateFileStatus]);

  const handleSelectOutputFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        settings.setOutputDirectory(selected);
      }
    } catch (err) {
      console.error('Error selecting directory:', err);
    }
  };

  const handleCancel = async () => {
    try {
      await invoke('cancel_conversion');
      setIsConverting(false);
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  };

  const handleReveal = async (path: string) => {
    try {
      await invoke('reveal_in_finder', { path });
    } catch (e) {
      console.error('Failed to reveal file:', e);
    }
  };

  // Close popover Format
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (formatMenuRef.current && !formatMenuRef.current.contains(e.target as Node)) {
        setIsFormatMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.key === 'o' && currentTab === 'converter') {
        e.preventDefault();
        handleSelectFiles();
      } else if (isCmdOrCtrl && e.key === 'Enter' && currentTab === 'converter') {
        e.preventDefault();
        handleStartBatch();
      } else if (isCmdOrCtrl && e.key === 'Backspace' && files.length > 0 && !isConverting && currentTab === 'converter') {
        e.preventDefault();
        clearFiles();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSelectFiles, handleStartBatch, files.length, isConverting, clearFiles, currentTab]);

  // Drag & Drop
  useEffect(() => {
    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'over' || event.payload.type === 'enter') {
        setIsDragging(true);
      } else if (event.payload.type === 'drop') {
        setIsDragging(false);
        if (currentTab === 'converter') {
          processIncomingFiles(event.payload.paths);
        }
      } else if (event.payload.type === 'leave') {
        setIsDragging(false);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [processIncomingFiles, currentTab]);

  // Conversion Progress
  useEffect(() => {
    const unlistenPromise = listen<ProgressPayload>('conversion-progress', (event) => {
      const { filePath, outputPath, outputSize, success, error, completed, total } = event.payload;
      setProgress({ completed, total });

      const targetFile = files.find((f) => f.path === filePath);
      if (targetFile) {
        updateFileStatus(
          targetFile.id,
          success ? 'completed' : 'failed',
          error,
          outputPath && outputSize ? { path: outputPath, size: outputSize } : undefined
        );
      }

      if (completed >= total) {
        setIsConverting(false);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [files, updateFileStatus]);

  return (
    <div className="app-shell flex flex-col h-screen w-screen bg-[#0b0d10] text-zinc-200 select-none font-sans antialiased overflow-hidden">
      {/* Header with Native Window Dragging */}
      <header
        data-tauri-drag-region
        onMouseDown={handleStartDragging}
        className="relative h-12 pl-20 pr-5 border-b border-zinc-800/60 flex items-center justify-between bg-[#101216]/80 backdrop-blur-xl z-30 shrink-0 select-none cursor-default"
      >
        {/* Left: Branding */}
        <div className="flex items-center gap-2 pointer-events-none z-10">
          <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Sparkles className="w-3 h-3 text-white" />
          </div>
          <span className="text-xs font-semibold tracking-wide text-zinc-100">ND Image Converter</span>
          <span className="text-[10px] text-zinc-500 font-mono ml-1">v0.8.2</span>
        </div>

        {/* Center: Absolute Fixed Position Tabs */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center z-20">
          <div className="flex items-center gap-1 bg-[#15181e] p-1 rounded-xl border border-zinc-800/80 shadow-inner">
            <button
              onClick={() => setCurrentTab('converter')}
              className={`text-[11px] font-medium px-3.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                currentTab === 'converter'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'app-nav-item text-zinc-400'
              }`}
            >
              <Layers className="w-3.5 h-3.5" /> Batch Convert
            </button>
            <button
              onClick={() => setCurrentTab('automation')}
              className={`text-[11px] font-medium px-3.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                currentTab === 'automation'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'app-nav-item text-zinc-400'
              }`}
            >
              <Activity className="w-3.5 h-3.5" /> Watch Folder
            </button>
            <button
              onClick={() => setCurrentTab('video')}
              className={`text-[11px] font-medium px-3.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${currentTab === 'video' ? 'bg-blue-600 text-white shadow-sm' : 'app-nav-item text-zinc-400'}`}
            >
              <Activity className="w-3.5 h-3.5" /> Video to GIF
            </button>
            <button onClick={() => setCurrentTab('video-converter')} className={`text-[11px] font-medium px-3.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${currentTab === 'video-converter' ? 'bg-blue-600 text-white shadow-sm' : 'app-nav-item text-zinc-400'}`}><ArrowRight className="w-3.5 h-3.5" /> Video Convert</button>
            <button onClick={() => setCurrentTab('grab-stills')} className={`text-[11px] font-medium px-3.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${currentTab === 'grab-stills' ? 'bg-blue-600 text-white shadow-sm' : 'app-nav-item text-zinc-400'}`}><Camera className="w-3.5 h-3.5" /> Grab Stills</button>
          </div>
        </div>

        {/* Right: Presets & Quick Actions */}
        <div className="flex items-center gap-2 z-10">
          <button
            onClick={() => settings.setTheme(settings.theme === 'dark' ? 'light' : 'dark')}
            className="h-7 w-7 rounded-lg bg-[#171a21] border border-zinc-800 text-zinc-400 hover:text-zinc-100 flex items-center justify-center transition cursor-pointer"
            title={`Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {settings.theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
          {currentTab === 'converter' && (
            <>
              <div className="hidden xl:flex items-center gap-1 bg-[#15181e] p-1 rounded-xl border border-zinc-800/80">
                <Sliders className="w-3 h-3 text-zinc-500 ml-1.5 mr-1" />
                {DEFAULT_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => settings.applyPreset(p)}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                      settings.activePresetId === p.id
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'app-nav-item text-zinc-400'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>

              {files.length > 0 && !isConverting && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleSelectFiles}
                    className="app-primary-action text-[11px] font-medium px-3 py-1.5 rounded-lg border border-blue-500/60 flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Add
                  </button>
                  <button
                    onClick={clearFiles}
                    className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 flex items-center gap-1 transition cursor-pointer"
                    title="Clear All"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </header>

      {/* Main Body */}
      {currentTab === 'converter' ? (
        <>
          <main className="flex-1 relative overflow-hidden flex flex-col p-4">
            {files.length === 0 ? (
              <div
                onClick={handleSelectFiles}
                className={`flex-1 rounded-3xl border border-dashed transition-all duration-300 flex flex-col items-center justify-center cursor-pointer ${
                  isDragging
                    ? 'border-blue-500 bg-blue-500/10 scale-[0.99]'
                    : 'border-zinc-800/80 hover:border-zinc-700 bg-[#111317]/50 hover:bg-[#111317]/80'
                }`}
              >
                <div className="p-4 rounded-2xl bg-[#181b22] border border-zinc-700/40 mb-4 shadow-2xl text-blue-400">
                  <Upload className="w-8 h-8 stroke-[1.75]" />
                </div>
                <h2 className="text-sm font-medium text-zinc-200 mb-1">Drop images or camera RAW files here</h2>
                <p className="text-xs text-zinc-500 mb-4">or click to browse from computer (⌘O)</p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] tracking-wider uppercase font-semibold text-zinc-400 bg-[#161920] px-3 py-1.5 rounded-full border border-zinc-800">
                    50+ INPUT FORMATS • 12 OUTPUT FORMATS
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-1 space-y-2">
                {files.map((file) => {
                  const savingsPercent =
                    file.outputSize && file.size
                      ? Math.round(((file.size - file.outputSize) / file.size) * 100)
                      : null;

                  return (
                    <div
                      key={file.id}
                      className="group flex items-center justify-between p-2.5 rounded-2xl bg-[#12141a] border border-zinc-850 hover:border-zinc-750 transition-all shadow-sm"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 overflow-hidden">
                          {file.thumbnail ? (
                            <img src={file.thumbnail} alt={file.name} className="w-full h-full object-cover" />
                          ) : (
                            <ImageIcon className="w-4 h-4 text-zinc-500" />
                          )}
                        </div>

                        <div className="flex flex-col truncate">
                          <span className="text-xs font-medium text-zinc-200 truncate">{file.name}</span>
                          <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                            {file.width && file.height && <span>{file.width}×{file.height}</span>}
                            {file.size > 0 && <span>• {formatBytes(file.size)}</span>}
                            {file.outputSize && (
                              <div className="flex items-center gap-1 text-emerald-400">
                                <ArrowRight className="w-2.5 h-2.5" />
                                <span>{formatBytes(file.outputSize)}</span>
                                {savingsPercent !== null && savingsPercent > 0 && (
                                  <span className="bg-emerald-500/10 px-1 py-0.2 rounded font-mono">
                                    -{savingsPercent}%
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5">
                        {file.status === 'queued' && (
                          <span className="app-status-ready text-[10px] px-2 py-0.5 rounded-md border">Ready</span>
                        )}
                        {file.status === 'processing' && (
                          <span className="text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20 flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Processing
                          </span>
                        )}
                        {file.status === 'completed' && (
                          <div className="flex items-center gap-1.5">
                            <span className="app-status-done text-[10px] px-2 py-0.5 rounded-md border flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Done
                            </span>
                            <button
                              onClick={() => setSelectedComparisonItem(file)}
                              title="Compare Before / After"
                              className="text-zinc-400 hover:text-blue-400 p-1.5 hover:bg-zinc-800 rounded-lg transition cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            {file.outputPath && (
                              <button
                                onClick={() => handleReveal(file.outputPath!)}
                                title="Show in Finder"
                                className="text-zinc-400 hover:text-zinc-200 p-1.5 hover:bg-zinc-800 rounded-lg transition cursor-pointer"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                        {file.status === 'failed' && (
                          <span className="text-[10px] text-red-400 bg-red-500/10 px-2 py-0.5 rounded-md border border-red-500/20 flex items-center gap-1" title={file.errorMessage}>
                            <AlertCircle className="w-3 h-3" /> Error
                          </span>
                        )}

                        {!isConverting && (
                          <button
                            onClick={() => removeFile(file.id)}
                            className="text-zinc-500 hover:text-red-400 p-1.5 transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>

          {/* Progress Bar */}
          {isConverting && (
            <div className="w-full bg-zinc-900 h-1 relative overflow-hidden">
              <div
                className="bg-blue-500 h-full transition-all duration-200 shadow-[0_0_8px_rgba(59,130,246,0.8)]"
                style={{ width: `${(progress.completed / (progress.total || 1)) * 100}%` }}
              />
            </div>
          )}

          {/* Bottom Footer Controls */}
          <footer className="p-3.5 bg-[#101216]/95 border-t border-zinc-800/80 flex items-center justify-between gap-4 z-20 shrink-0">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Format Popover */}
              <div className="relative" ref={formatMenuRef}>
                <button
                  onClick={() => setIsFormatMenuOpen(!isFormatMenuOpen)}
                  className="h-8 px-3 rounded-xl bg-[#171a21] hover:bg-[#1e222b] border border-zinc-800 hover:border-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-2 transition cursor-pointer shadow-sm"
                >
                  <span className="text-zinc-400 font-normal">Format</span>
                  <span className="font-semibold text-blue-400 uppercase tracking-wider">{settings.format}</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform duration-200 ${isFormatMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {isFormatMenuOpen && (
                  <div className="theme-surface-elevated absolute bottom-11 left-0 w-[420px] border rounded-2xl p-3.5 shadow-2xl backdrop-blur-2xl z-50 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-zinc-800/80 px-1">
                      <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Select Output Format</span>
                      <span className="text-[10px] text-zinc-400 font-mono">{ALL_OUTPUT_FORMATS.length} Formats</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 max-h-60 overflow-y-auto pr-1">
                      {ALL_OUTPUT_FORMATS.map((item) => (
                        <button
                          key={item.value}
                          onClick={() => {
                            settings.setFormat(item.value);
                            setIsFormatMenuOpen(false);
                          }}
                          className={`h-8 rounded-xl text-[11px] font-medium transition-all flex items-center justify-center cursor-pointer border ${
                            settings.format === item.value
                              ? 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-600/30'
                              : 'theme-option theme-surface-control border'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Quality Analyzer */}
              <QualityAnalyzerPill />

              {/* Resize Pill */}
              <div className="h-8 p-0.5 rounded-xl bg-[#171a21] border border-zinc-800 flex items-center gap-0.5 shadow-sm">
                {(['original', 'width', 'percentage'] as ResizeMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => settings.setResizeMode(mode)}
                    className={`h-7 px-2.5 rounded-lg text-[11px] font-medium capitalize transition cursor-pointer ${
                      settings.resizeMode === mode
                        ? 'bg-[#252a36] text-white border border-zinc-700/60 shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {mode === 'original' ? 'Original' : mode === 'width' ? 'Width' : 'Scale %'}
                  </button>
                ))}

                {settings.resizeMode === 'width' && (
                  <input
                    type="number"
                    value={settings.targetWidth || ''}
                    onChange={(e) => settings.setTargetWidth(Number(e.target.value))}
                    placeholder="px"
                    className="w-16 h-7 ml-1 bg-[#101216] border border-zinc-700/80 text-zinc-200 text-xs rounded-lg px-2 outline-none focus:border-blue-500 font-mono"
                  />
                )}

                {settings.resizeMode === 'percentage' && (
                  <input
                    type="number"
                    value={settings.scalePercentage || ''}
                    onChange={(e) => settings.setScalePercentage(Number(e.target.value))}
                    placeholder="%"
                    className="w-14 h-7 ml-1 bg-[#101216] border border-zinc-700/80 text-zinc-200 text-xs rounded-lg px-2 outline-none focus:border-blue-500 font-mono"
                  />
                )}
              </div>

              {/* Output Directory */}
              <button
                onClick={handleSelectOutputFolder}
                className="h-8 px-3 rounded-xl bg-[#171a21] hover:bg-[#1e222b] border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-xs font-medium flex items-center gap-2 transition cursor-pointer shadow-sm"
                title={settings.outputDirectory ? `Output: ${settings.outputDirectory}` : 'Same folder as source'}
              >
                <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
                <span className="max-w-[110px] truncate">
                  {settings.outputDirectory ? settings.outputDirectory.split('/').pop() : 'Source Dir'}
                </span>
              </button>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-zinc-400 font-mono">
                {isConverting ? `${progress.completed}/${progress.total}` : `${files.length} items`}
              </span>

              {isConverting ? (
                <button
                  onClick={handleCancel}
                  className="h-8 px-4 bg-red-600/80 hover:bg-red-600 text-white font-medium text-xs rounded-xl flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Cancel</span>
                </button>
              ) : (
                <button
                  disabled={files.length === 0}
                  onClick={handleStartBatch}
                  className="h-8 px-4.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600 text-white font-medium text-xs rounded-xl flex items-center gap-2 shadow-lg shadow-blue-600/25 transition cursor-pointer active:scale-95"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Convert (⌘↵)</span>
                </button>
              )}
            </div>
          </footer>
        </>
      ) : null}
      <div className={currentTab === 'automation' ? 'contents' : 'hidden'}><AutomationTab /></div>
      <div className={currentTab === 'video' ? 'contents' : 'hidden'}><VideoToGifTab active={currentTab === 'video'} /></div>
      <div className={currentTab === 'video-converter' ? 'contents' : 'hidden'}><VideoConverterTab active={currentTab === 'video-converter'} /></div>
      <div className={currentTab === 'grab-stills' ? 'contents' : 'hidden'}><GrabStillsTab active={currentTab === 'grab-stills'} /></div>

      {/* Auto-Update Notification Banner */}
      <UpdateChecker />

      {/* Comparison Modal */}
      {selectedComparisonItem && (
        <ComparisonModal
          item={selectedComparisonItem}
          onClose={() => setSelectedComparisonItem(null)}
        />
      )}
    </div>
  );
}
