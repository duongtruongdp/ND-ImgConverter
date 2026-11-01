import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Sparkles, Download, ExternalLink, X } from 'lucide-react';
import {
  type AppUpdateTarget,
  type GitHubRelease,
  type ReleaseUpdate,
  resolveReleaseUpdate,
  targetFromBrowser,
  targetFromNativeTriple,
} from './updateUtils';

const GITHUB_REPO = 'duongtruongdp/ND-ImgConverter';
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`;
const stableDownloadPage = 'https://duongtruongdp.net/NDImgConverter_download';

const targetLabel = (target: AppUpdateTarget) => {
  if (target === 'macos-arm64') return 'macOS Apple Silicon';
  if (target === 'macos-x64') return 'macOS Intel';
  if (target === 'windows-x64') return 'Windows x64';
  return 'your platform';
};

const readReleaseList = async (signal: AbortSignal): Promise<GitHubRelease[]> => {
  const response = await fetch(RELEASES_API, {
    signal,
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  const releases: unknown = await response.json();
  return Array.isArray(releases) ? releases as GitHubRelease[] : [];
};

export const UpdateChecker = () => {
  const [update, setUpdate] = useState<ReleaseUpdate | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const checkUpdate = async () => {
      try {
        const [currentVersion, nativeTriple] = await Promise.all([
          getVersion(),
          invoke<string>('get_app_update_target').catch(() => null),
        ]);
        const nativeTarget = targetFromNativeTriple(nativeTriple);
        const target = nativeTarget !== 'unknown' ? nativeTarget : targetFromBrowser(window.navigator);
        const releases = await readReleaseList(controller.signal);
        const nextUpdate = resolveReleaseUpdate(releases, currentVersion, target);
        if (nextUpdate) {
          setUpdate(nextUpdate);
          setIsOpen(true);
        }
      } catch (reason) {
        if (!controller.signal.aborted) console.error('Failed to check for updates:', reason);
      }
    };

    const timer = setTimeout(checkUpdate, 800);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  if (!isOpen || !update) return null;

  const destination = update.installer?.browser_download_url || update.release.html_url || stableDownloadPage;
  const hasInstaller = Boolean(update.installer);

  const handleOpenDownload = async () => {
    try {
      await openUrl(destination);
      setIsOpen(false);
    } catch (reason) {
      console.error('Failed to open release download:', reason);
      setError('Unable to open the download page. Please use the link below.');
    }
  };

  return (
    <div className="theme-surface-elevated fixed top-14 right-6 z-50 max-w-sm select-none rounded-2xl border border-blue-500/40 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-3 duration-300">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-blue-500/20 p-1.5 text-blue-400"><Sparkles className="h-4 w-4" /></div>
          <div>
            <h4 className="theme-text-primary text-xs font-semibold">Update Available</h4>
            <p className="theme-text-secondary mt-0.5 text-[11px]">v<span className="font-mono font-medium text-blue-400">{update.version}</span> for {targetLabel(update.target)}.</p>
          </div>
        </div>
        <button type="button" aria-label="Close update notice" onClick={() => setIsOpen(false)} className="theme-text-muted p-1 transition hover:theme-text-primary"><X className="h-3.5 w-3.5" /></button>
      </div>

      {update.releaseNotes && <p className="theme-text-secondary mt-3 text-[11px] leading-relaxed">{update.releaseNotes}</p>}
      {!hasInstaller && <p className="theme-text-muted mt-2 text-[10px] leading-relaxed">This release does not include the matching installer yet. Open the release page to choose another download.</p>}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={() => setIsOpen(false)} className="app-secondary-action theme-text-secondary rounded-lg px-3 py-1.5 text-[11px] transition">Later</button>
        <button type="button" onClick={handleOpenDownload} className="app-primary-action flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium shadow-md shadow-blue-600/20 transition">
          {hasInstaller ? <Download className="h-3 w-3" /> : <ExternalLink className="h-3 w-3" />}
          {hasInstaller ? 'Download Update' : 'Open Release Page'}
        </button>
      </div>
      {error && <p className="theme-error mt-2 break-all text-[10px] leading-relaxed">{error} <a className="theme-link underline" href={destination}>{destination}</a></p>}
    </div>
  );
};
