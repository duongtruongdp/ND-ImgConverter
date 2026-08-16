import { useState, useEffect } from 'react';
import { Sparkles, Download, X } from 'lucide-react';

const CURRENT_VERSION = '0.5.0';
const GITHUB_REPO = 'duongtruongdp/nd-image-converter';

export const UpdateChecker = () => {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [releaseUrl, setReleaseUrl] = useState<string>('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
        if (!response.ok) return;
        const data = await response.json();
        const tag = (data.tag_name || '').replace(/^v/, '');

        if (tag && tag !== CURRENT_VERSION) {
          setLatestVersion(tag);
          setReleaseUrl(data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`);
          setIsOpen(true);
        }
      } catch (err) {
        console.error('Failed to check for updates:', err);
      }
    };

    checkUpdate();
  }, []);

  if (!isOpen || !latestVersion) return null;

  const handleOpenRelease = () => {
    window.open(releaseUrl, '_blank');
  };

  return (
    <div className="fixed top-14 right-6 bg-[#161a23] border border-blue-500/40 rounded-2xl p-4 shadow-2xl backdrop-blur-xl z-50 animate-in fade-in slide-in-from-top-3 duration-300 max-w-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-zinc-100">Update Available</h4>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Version <span className="font-mono text-blue-400 font-medium">v{latestVersion}</span> is now available on GitHub.
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
    </div>
  );
};