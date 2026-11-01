import { useCallback, useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { CheckCircle2, Download, ExternalLink, Loader2, Sparkles, X } from 'lucide-react';
import {
  type AppUpdateChannel,
  type AppUpdateTarget,
  type ReleaseUpdate,
  isTrustedReleasePageUrl,
  targetFromNativeTriple,
} from './updateUtils';
import {
  checkAppUpdates,
  readAppUpdateChannel,
  writeAppUpdateChannel,
  type AppUpdateCheckState,
} from './appUpdateService';

const RELEASES_PAGE = 'https://github.com/duongtruongdp/ND-ImgConverter/releases';
const nativeTarget = async (): Promise<AppUpdateTarget> => {
  try {
    return targetFromNativeTriple(await invoke<string>('get_app_update_target'));
  } catch {
    return 'unknown';
  }
};

const targetLabel = (target: AppUpdateTarget) => {
  if (target === 'macos-arm64') return 'macOS Apple Silicon';
  if (target === 'macos-x64') return 'macOS Intel';
  if (target === 'windows-x64') return 'Windows x64';
  return 'this device';
};

const releasePage = (update: ReleaseUpdate) => isTrustedReleasePageUrl(update.release.html_url) ? update.release.html_url : RELEASES_PAGE;

const updateDestination = (update: ReleaseUpdate) => update.installer?.browser_download_url || releasePage(update);

const statusMessage = (state: AppUpdateCheckState | 'idle' | 'checking', channel: AppUpdateChannel) => {
  if (state === 'checking') return 'Checking for updates…';
  if (state === 'up-to-date') return channel === 'beta' ? 'No newer Beta available.' : "You're up to date.";
  if (state === 'update-available') return 'New version available.';
  if (state === 'no-installer') return 'New version available, but no installer for this device.';
  return 'Choose a channel and check for updates.';
};

type UpdatePanelProps = {
  installedVersion: string;
};

export const AppUpdatePanel = ({ installedVersion }: UpdatePanelProps) => {
  const [channel, setChannel] = useState<AppUpdateChannel>(() => readAppUpdateChannel());
  const [target, setTarget] = useState<AppUpdateTarget>('unknown');
  const [state, setState] = useState<AppUpdateCheckState | 'idle' | 'checking'>('idle');
  const [update, setUpdate] = useState<ReleaseUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let active = true;
    void nativeTarget().then((nextTarget) => { if (active) setTarget(nextTarget); });
    return () => { active = false; };
  }, []);

  const changeChannel = (nextChannel: AppUpdateChannel) => {
    setChannel(nextChannel);
    writeAppUpdateChannel(nextChannel);
    setState('idle');
    setUpdate(null);
    setError(null);
    setOpenError(null);
  };

  const checkNow = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setState('checking');
    setError(null);
    setOpenError(null);
    try {
      const resolvedTarget = target === 'unknown' ? await nativeTarget() : target;
      const result = await checkAppUpdates({ currentVersion: installedVersion, target: resolvedTarget, channel });
      if (currentRequest !== requestId.current) return;
      setTarget(resolvedTarget);
      setUpdate(result.update);
      setState(result.state);
    } catch (reason) {
      if (currentRequest !== requestId.current) return;
      setUpdate(null);
      setState('idle');
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [channel, installedVersion, target]);

  const openDownload = async () => {
    if (!update) return;
    try {
      await openUrl(updateDestination(update));
      setOpenError(null);
    } catch (reason) {
      setOpenError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return <section className="mt-4 border-t border-zinc-800/80 pt-3" aria-labelledby="app-updates-title">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 id="app-updates-title" className="text-xs font-medium theme-text-primary">App Updates</h3>
        <p className="mt-1 text-[10px] theme-text-muted">Installed v{installedVersion} · {targetLabel(target)}</p>
      </div>
      <button type="button" onClick={() => void checkNow()} disabled={state === 'checking'} className="theme-surface-control flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[11px] disabled:opacity-60">
        {state === 'checking' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        Check for Updates
      </button>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
      <label className="theme-text-secondary" htmlFor="app-update-channel">Update channel</label>
      <select id="app-update-channel" value={channel} onChange={(event) => changeChannel(event.target.value as AppUpdateChannel)} className="theme-surface-control rounded-lg border px-2 py-1.5 text-[11px]">
        <option value="stable">Stable</option>
        <option value="beta">Beta</option>
      </select>
      <span className="theme-text-muted">Stable is recommended.</span>
    </div>
    <p className={`mt-3 rounded-lg px-2.5 py-2 text-[11px] ${error ? 'theme-error bg-red-500/5' : 'theme-text-muted bg-blue-500/5'}`}>
      {error ? `Couldn't check for updates: ${error}` : statusMessage(state, channel)}
    </p>
    {update && <div className="mt-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-2.5 py-2 text-[11px]">
      <div className="flex items-center gap-1.5 theme-text-primary"><CheckCircle2 className="h-3.5 w-3.5 text-blue-400" /> v{update.version}</div>
      {update.releaseNotes && <p className="mt-1 leading-relaxed theme-text-secondary">{update.releaseNotes}</p>}
      {update.checksumAsset && <p className="mt-1 theme-text-muted">SHA-256 manifest available.</p>}
      {state === 'no-installer' && <p className="mt-1 theme-text-muted">No installer for this device. Open the release page to review available downloads.</p>}
      <button type="button" onClick={() => void openDownload()} className="app-primary-action mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium">
        {state === 'no-installer' ? <ExternalLink className="h-3 w-3" /> : <Download className="h-3 w-3" />}
        {state === 'no-installer' ? 'Open Release Page' : 'Download Update'}
      </button>
      {openError && <p className="mt-2 break-words theme-error">Couldn’t open the download: {openError}</p>}
    </div>}
  </section>;
};

let automaticCheckStarted = false;

export const UpdateChecker = () => {
  const [update, setUpdate] = useState<ReleaseUpdate | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (automaticCheckStarted) return;
    automaticCheckStarted = true;
    const controller = new AbortController();
    const checkOnce = async () => {
      try {
        const [currentVersion, target] = await Promise.all([getVersion(), nativeTarget()]);
        if (controller.signal.aborted) return;
        const result = await checkAppUpdates({ currentVersion, target, channel: readAppUpdateChannel() });
        if (mounted.current && result.update) {
          setUpdate(result.update);
          setIsOpen(true);
        }
      } catch (reason) {
        if (!controller.signal.aborted) console.debug('Application update check failed:', reason);
      }
    };
    const timer = setTimeout(() => { void checkOnce(); }, 800);
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  if (!isOpen || !update) return null;
  const hasInstaller = Boolean(update.installer);
  return <div className="theme-surface-elevated fixed right-6 top-14 z-50 max-w-sm select-none rounded-2xl border border-blue-500/40 p-4 shadow-2xl backdrop-blur-xl">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2"><div className="rounded-lg bg-blue-500/20 p-1.5 text-blue-400"><Sparkles className="h-4 w-4" /></div><div><h4 className="theme-text-primary text-xs font-semibold">Update Available</h4><p className="mt-0.5 text-[11px] theme-text-secondary">v<span className="font-mono font-medium text-blue-400">{update.version}</span> for {targetLabel(update.target)}.</p></div></div>
      <button type="button" aria-label="Close update notice" onClick={() => setIsOpen(false)} className="p-1 theme-text-muted hover:theme-text-primary"><X className="h-3.5 w-3.5" /></button>
    </div>
    {update.releaseNotes && <p className="mt-3 text-[11px] leading-relaxed theme-text-secondary">{update.releaseNotes}</p>}
    {!hasInstaller && <p className="mt-2 text-[10px] leading-relaxed theme-text-muted">No installer for this device. Open the release page to choose another download.</p>}
    <button type="button" onClick={() => void openUrl(updateDestination(update)).catch((reason) => console.debug('Failed to open update:', reason))} className="app-primary-action mt-3 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium">
      {hasInstaller ? <Download className="h-3 w-3" /> : <ExternalLink className="h-3 w-3" />}
      {hasInstaller ? 'Download Update' : 'Open Release Page'}
    </button>
  </div>;
};
