import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';

type RuntimeDiagnostic = {
  key: string;
  label: string;
  status: string;
  source: string;
  path?: string;
  version?: string;
  architecture: string;
  detail?: string;
  capabilities: string[];
};

const friendlyStatus = (status: string) => {
  if (status === 'available') return 'Available';
  if (status === 'notExecutable') return 'Not executable';
  if (status === 'wrongArchitecture') return 'Wrong architecture';
  if (status === 'missingSharedLibrary') return 'Missing shared library';
  if (status === 'unsupportedVersion') return 'Unsupported or invalid';
  return 'Unavailable';
};

const friendlySource = (source: string) => source === 'bundled' ? 'Bundled' : source === 'managed' ? 'Managed' : source === 'explicit' ? 'Explicit' : source === 'system' ? 'System' : 'Unavailable';
const visibleVersion = (value: string) => value.split(/\r?\n/, 1)[0].replace(/^\S+\s+version\s+/i, '').split(/\s+Copyright\b/i, 1)[0].trim().slice(0, 120);

export const RuntimeDiagnostics = () => {
  const [items, setItems] = useState<RuntimeDiagnostic[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = useCallback(async (force = false) => {
    if (requestRef.current) return requestRef.current;
    performance.mark('nd-about-diagnostics-start');
    setLoading(true);
    setError(null);
    const request = invoke<RuntimeDiagnostic[]>(force ? 'refresh_runtime_diagnostics' : 'get_runtime_diagnostics')
      .then((nextItems) => {
        if (!mountedRef.current) return;
        setItems(nextItems);
        setLoaded(true);
      })
      .catch((reason) => {
        if (mountedRef.current) setError(String(reason));
      })
      .finally(() => {
        performance.mark('nd-about-diagnostics-end');
        performance.measure('nd-about-diagnostics-load', 'nd-about-diagnostics-start', 'nd-about-diagnostics-end');
        if (mountedRef.current) setLoading(false);
        requestRef.current = null;
      });
    requestRef.current = request;
    return request;
  }, []);

  return <details className="mt-4 border-t border-zinc-800/80 pt-3" onToggle={(event) => { if (event.currentTarget.open && !loaded) void refresh(); }}>
    <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">Advanced runtime diagnostics</summary>
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between gap-2"><p className="text-[10px] text-zinc-500">Media engines are resolved from the application bundle first. System binaries are only used in development or explicit advanced mode.</p><button type="button" onClick={() => void refresh(true)} disabled={loading} className="theme-surface-control rounded-lg border p-1.5 disabled:opacity-50" title="Refresh diagnostics"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></button></div>
      {loading && <p className="text-[10px] text-zinc-500">Checking media engines…</p>}
      {error && <p className="text-[10px] text-red-400">Couldn’t load diagnostics: {error}</p>}
      {items.map((item) => <div key={item.key} className="rounded-xl border border-zinc-800 p-2.5 text-[10px]"><div className="flex items-center gap-2"><span className="font-medium text-zinc-200">{item.label}</span>{item.status === 'available' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <AlertTriangle className="w-3 h-3 text-amber-400" />}<span className={item.status === 'available' ? 'text-emerald-400' : 'text-amber-300'}>{friendlyStatus(item.status)}</span><span className="ml-auto text-zinc-500">{friendlySource(item.source)} · {item.architecture}</span></div><div className="mt-1 text-zinc-500 break-all">{item.version ? visibleVersion(item.version) : item.detail || 'No version information'}</div>{item.path && <div className="mt-1 text-zinc-600 break-all">{item.path}</div>}{item.capabilities.length > 0 && <div className="mt-1 text-zinc-600">Capabilities: {item.capabilities.join(', ')}</div>}{item.detail && item.status === 'available' && <details className="mt-1"><summary className="cursor-pointer text-zinc-600">Details</summary><pre className="mt-1 whitespace-pre-wrap break-words text-zinc-500">{item.detail}</pre></details>}</div>)}
      {loaded && items.length === 0 && <p className="text-[10px] text-zinc-500">No runtime diagnostics were returned.</p>}
      {!loaded && !loading && !error && <p className="text-[10px] text-zinc-500">Open this section to inspect the installed media engines.</p>}
    </div>
  </details>;
};
