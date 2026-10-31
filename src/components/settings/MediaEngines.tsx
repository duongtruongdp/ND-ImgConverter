import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react';

type EngineStatus = {
  key: string;
  label: string;
  installedVersion?: string;
  status: string;
  source: string;
  path?: string;
  rollbackAvailable: boolean;
  detail?: string;
};

type UpdateCheckResult = {
  state: string;
  checkedAt?: string;
  message: string;
  updates: unknown[];
};

const sourceLabel = (source: string) => source === 'bundled' ? 'Bundled' : source === 'managed' ? 'Managed' : source === 'explicit' ? 'Explicit' : source === 'system' ? 'System' : 'Unavailable';
const visibleVersion = (value: string) => value.split(/\r?\n/, 1)[0].replace(/^\S+\s+version\s+/i, '').split(/\s+Copyright\b/i, 1)[0].trim().slice(0, 80);

export const MediaEngines = () => {
  const [items, setItems] = useState<EngineStatus[]>([]);
  const [check, setCheck] = useState<UpdateCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = useCallback(async (force = false) => {
    if (requestRef.current) return requestRef.current;
    performance.mark('nd-about-engines-start');
    setLoading(true);
    setError(null);
    const request = invoke<EngineStatus[]>(force ? 'refresh_engine_inventory' : 'get_engine_inventory')
      .then((nextItems) => {
        if (!mountedRef.current) return;
        setItems(nextItems);
        setLoaded(true);
      })
      .catch((reason) => {
        if (mountedRef.current) setError(String(reason));
      })
      .finally(() => {
        performance.mark('nd-about-engines-load-end');
        performance.measure('nd-about-engines-load', 'nd-about-engines-start', 'nd-about-engines-load-end');
        if (mountedRef.current) setLoading(false);
        requestRef.current = null;
      });
    requestRef.current = request;
    return request;
  }, []);

  const checkForUpdates = async () => {
    if (requestRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const [nextCheck, nextItems] = await Promise.all([
        invoke<UpdateCheckResult>('check_engine_updates'),
        invoke<EngineStatus[]>('refresh_engine_inventory'),
      ]);
      if (!mountedRef.current) return;
      setCheck(nextCheck);
      setItems(nextItems);
      setLoaded(true);
    } catch (reason) {
      if (mountedRef.current) setError(String(reason));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const rollback = async (engine: string) => {
    setLoading(true);
    try {
      await invoke('rollback_engine', { engine });
      await refresh(true);
    } catch (reason) {
      if (mountedRef.current) setError(String(reason));
    } finally {
      setLoading(false);
    }
  };

  return <details className="mt-4 border-t border-zinc-800/80 pt-3" onToggle={(event) => { if (event.currentTarget.open && !loaded) void refresh(); }}>
    <summary className="cursor-pointer text-xs theme-text-secondary">Media Engines</summary>
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] theme-text-muted">Signed engine updates are unavailable until a publisher key is configured.</p><button type="button" onClick={() => void checkForUpdates()} disabled={loading} className="theme-surface-control flex h-8 items-center gap-1 rounded-lg border px-2 text-[11px]"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Check for updates</button></div>
      {loading && <p className="text-[10px] theme-text-muted">Checking media engines…</p>}
      {error && <p className="text-[10px] theme-error">Couldn’t load media engines: {error}</p>}
      {check && <p className={`rounded-lg px-2 py-1.5 text-[11px] ${check.state === 'failed' ? 'theme-error bg-red-500/5' : 'theme-text-muted bg-blue-500/5'}`}>{check.message}</p>}
      {items.map((item) => <div key={item.key} className="theme-surface-elevated rounded-lg border px-2.5 py-2"><div className="flex items-center gap-2"><span className="text-xs font-medium theme-text-primary">{item.label}</span>{item.status === 'available' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <TriangleAlert className="h-3.5 w-3.5 text-amber-400" />}<span className="text-[10px] theme-text-muted">{item.installedVersion ? visibleVersion(item.installedVersion) : item.status}</span><span className="ml-auto text-[10px] theme-text-muted">{sourceLabel(item.source)}</span></div>{item.rollbackAvailable && <button type="button" onClick={() => void rollback(item.key)} disabled={loading} className="mt-1 flex items-center gap-1 text-[10px] theme-link disabled:opacity-50"><RotateCcw className="h-3 w-3" /> Restore previous version</button>}</div>)}
      {loaded && items.length === 0 && <p className="text-[10px] theme-text-muted">No media engines found.</p>}
    </div>
  </details>;
};
