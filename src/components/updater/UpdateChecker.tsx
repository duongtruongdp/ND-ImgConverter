import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Sparkles, Download, X } from 'lucide-react';

const GITHUB_REPO = 'duongtruongdp/ND-ImgConverter';

export const UpdateChecker = () => {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [releaseUrl, setReleaseUrl] = useState<string>('');
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        // 1. Get the current version of the running application.
        const currentVersion = await getVersion();

        // 2. GitHub API to get the latest release.
        const response = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`,
          {
            headers: {
              Accept: 'application/vnd.github.v3+json',
            },
          }
        );

        if (!response.ok) return;

        const releases = await response.json();
        if (!Array.isArray(releases) || releases.length === 0) return;

        const stableReleases = releases.filter(
          (release: any) =>
            !release.draft &&
            !release.prerelease &&
            /^v?\d+\.\d+\.\d+$/.test(release.tag_name || '')
        );
        const latestRelease = stableReleases.sort((a: any, b: any) => {
          const parse = (value: string) =>
            value.replace(/^v/, '').split('.').map((part) => Number(part));
          const left = parse(a.tag_name);
          const right = parse(b.tag_name);
          for (let index = 0; index < 3; index += 1) {
            if (left[index] !== right[index]) return right[index] - left[index];
          }
          return 0;
        })[0];

        if (!latestRelease) return;

        const tag = (latestRelease.tag_name || '').replace(/^v/, '');
        const cleanCurrent = currentVersion.replace(/^v/, '').split('-')[0];
        const currentParts: number[] = cleanCurrent.split('.').map(Number);
        const latestParts: number[] = tag.split('.').map(Number);
        const isNewer = latestParts.some(
          (part: number, index: number) =>
            part > (currentParts[index] || 0) &&
            latestParts.slice(0, index).every((value: number, i: number) => value === (currentParts[i] || 0))
        );

        if (isNewer) {
          setLatestVersion(tag);
          setReleaseUrl(
            `https://github.com/${GITHUB_REPO}/releases/tag/${latestRelease.tag_name}`
          );
          setIsOpen(true);
        }
      } catch (err) {
        console.error('Failed to check for updates:', err);
      }
    };

    // Wait 800ms after the app finishes launching before calling the check
    const timer = setTimeout(checkUpdate, 800);
    return () => clearTimeout(timer);
  }, []);

  if (!isOpen || !latestVersion) return null;

  const handleOpenRelease = async () => {
    try {
      await openUrl(releaseUrl);
      setIsOpen(false);
    } catch (err) {
      console.error('Failed to open release page:', err);
      setError('Unable to open the download page. Copy this link into your browser.');
    }
  };

  return (
    <div className="fixed top-14 right-6 bg-[#161a23] border border-blue-500/40 rounded-2xl p-4 shadow-2xl backdrop-blur-xl z-50 animate-in fade-in slide-in-from-top-3 duration-300 max-w-sm select-none">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-zinc-100">Update Available</h4>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Version <span className="font-mono text-blue-400 font-medium">v{latestVersion}</span> is ready to download.
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-zinc-500 hover:text-zinc-300 p-1 transition cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={() => setIsOpen(false)}
          className="text-[11px] px-3 py-1.5 rounded-lg text-zinc-400 hover:bg-zinc-800 transition cursor-pointer"
        >
          Later
        </button>
        <button
          onClick={handleOpenRelease}
          className="text-[11px] px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition cursor-pointer"
        >
          <Download className="w-3 h-3" /> Download Update
        </button>
      </div>
      {error && (
        <p className="mt-2 text-[10px] leading-relaxed text-red-400 break-all">
          {error} {releaseUrl}
        </p>
      )}
    </div>
  );
};
