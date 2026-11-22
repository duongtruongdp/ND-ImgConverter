import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { CheckCircle2, Download, Loader2, X } from 'lucide-react';
import {
  dismissEngineUpdate,
  isEngineUpdateDismissed,
  readEngineUpdateCheckState,
  startEngineUpdateAutoCheck,
  type EngineAsset,
  type UpdateCheckResult,
} from './engineUpdateService';

const visibleVersion = (value: string) => value.split(/\r?\n/, 1)[0].replace(/^\S+\s+version\s+/i, '').split(/\s+Copyright\b/i, 1)[0].trim().slice(0, 80);

export const EngineUpdateNotice = () => {
  const [check, setCheck] = useState<UpdateCheckResult | null>(() => {
    const state = readEngineUpdateCheckState();
    if (state?.lastState !== 'updateAvailable' || !state.availableUpdates?.length) return null;
    return { state: state.lastState, checkedAt: state.lastSuccessAt ? String(Math.floor(state.lastSuccessAt / 1000)) : undefined, manifestRevision: state.manifestRevision, installedVersions: state.installedVersions, message: state.message || 'An engine update is ready.', updates: state.availableUpdates };
  });
  const [updating, setUpdating] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    const subscription = listen<{ completed: number; total: number }>('engine-update-progress', (event) => {
      if (mountedRef.current) setProgress(event.payload);
    });
    const stop = startEngineUpdateAutoCheck({ onResult: (result) => { if (mountedRef.current) setCheck(result); } });
    return () => {
      mountedRef.current = false;
      stop();
      subscription.then((unlisten) => unlisten());
    };
  }, []);

  const available = useMemo(() => {
    if (!check?.manifestRevision || check.state !== 'updateAvailable') return [];
    return check.updates.filter((asset) => !isEngineUpdateDismissed(check.manifestRevision, asset));
  }, [check]);

  const dismiss = (asset: EngineAsset) => {
    if (!check) return;
    dismissEngineUpdate(check.manifestRevision, asset);
    setCheck((current) => current ? { ...current, updates: current.updates.filter((candidate) => candidate !== asset) } : current);
  };

  const update = async (asset: EngineAsset) => {
    setUpdating(asset.engine);
    setProgress(null);
    setError(null);
    try {
      const stagedPath = await invoke<string>('download_engine_update', { asset });
      await invoke('install_engine_update', { request: { asset, stagedPath, activeJobs: 0 } });
      window.dispatchEvent(new Event('nd-engine-inventory-invalidated'));
      setCheck((current) => current ? { ...current, updates: current.updates.filter((candidate) => candidate !== asset), state: current.updates.length > 1 ? 'updateAvailable' : 'upToDate', message: 'Engine updated and checked.' } : current);
    } catch (reason) {
      if (mountedRef.current) setError(String(reason));
    } finally {
      if (mountedRef.current) {
        setUpdating(null);
        setProgress(null);
      }
    }
  };

  if (available.length === 0) return null;
  const asset = available[0];
  const percent = progress && progress.total > 0 ? `${Math.round(progress.completed / progress.total * 100)}%` : 'preparing';

  const installedVersion = check?.installedVersions?.[asset.engine];
  return <aside className="theme-surface-elevated fixed right-6 top-14 z-40 max-w-sm rounded-2xl border border-blue-500/30 p-3 shadow-2xl backdrop-blur-xl" role="status" aria-live="polite">
    <div className="flex items-start gap-2.5">
      <div className="rounded-lg bg-blue-500/15 p-1.5 text-blue-400"><Download className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1"><p className="text-xs font-semibold theme-text-primary">{asset.engine} update available</p><p className="mt-0.5 text-[11px] theme-text-secondary">New verified version: {visibleVersion(asset.version)}</p><p className="mt-1 text-[10px] theme-text-muted">Installed: {installedVersion ? visibleVersion(installedVersion) : 'current'} · New: {visibleVersion(asset.version)}</p></div>
      <button type="button" aria-label={`Dismiss ${asset.engine} update`} onClick={() => dismiss(asset)} className="p-1 theme-text-muted hover:theme-text-primary"><X className="h-3.5 w-3.5" /></button>
    </div>
    {error && <p className="mt-2 rounded-lg bg-red-500/5 px-2 py-1.5 text-[10px] theme-error">Update failed: {error}</p>}
    <div className="mt-2 flex items-center gap-2">
      <button type="button" onClick={() => void update(asset)} disabled={Boolean(updating)} className="app-primary-action flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-60">{updating ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}{updating ? `Updating… ${percent}` : error ? 'Retry' : 'Update'}</button>
      <button type="button" onClick={() => dismiss(asset)} disabled={Boolean(updating)} className="app-secondary-action rounded-lg px-2.5 py-1.5 text-[11px] theme-text-secondary disabled:opacity-60">Later</button>
    </div>
  </aside>;
};
