export type AppUpdateTarget = 'macos-arm64' | 'macos-x64' | 'windows-x64' | 'unknown';

export type ReleaseAsset = {
  name: string;
  browser_download_url: string;
  size?: number;
};

export type GitHubRelease = {
  tag_name: string;
  name?: string;
  body?: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets?: ReleaseAsset[];
};

export type ReleaseUpdate = {
  release: GitHubRelease;
  version: string;
  installer: ReleaseAsset | null;
  target: AppUpdateTarget;
  releaseNotes: string;
};

const STABLE_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/;

export const normalizeVersion = (value: string) => value.trim().replace(/^v/i, '').split('-', 1)[0];

export const parseVersion = (value: string): [number, number, number] | null => {
  const match = normalizeVersion(value).match(STABLE_TAG);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

export const compareVersions = (left: string, right: string) => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
};

export const targetFromNativeTriple = (triple: string | null | undefined): AppUpdateTarget => {
  if (triple === 'aarch64-apple-darwin') return 'macos-arm64';
  if (triple === 'x86_64-apple-darwin') return 'macos-x64';
  if (triple === 'x86_64-pc-windows-msvc') return 'windows-x64';
  return 'unknown';
};

type BrowserNavigator = {
  userAgent?: string;
  platform?: string;
  userAgentData?: { architecture?: string; platform?: string };
};

export const targetFromBrowser = (navigatorLike: BrowserNavigator): AppUpdateTarget => {
  const userAgent = navigatorLike.userAgent || '';
  const platform = navigatorLike.platform || '';
  const architecture = `${navigatorLike.userAgentData?.architecture || ''} ${userAgent} ${platform}`.toLowerCase();
  if (/windows/i.test(`${userAgent} ${platform}`)) {
    return /x64|x86_64|win64|amd64|arm64|aarch64/.test(architecture) ? 'windows-x64' : 'unknown';
  }
  if (/macintosh|mac os x/i.test(`${userAgent} ${platform}`)) {
    return /arm64|aarch64/.test(architecture) ? 'macos-arm64' : /x86_64|amd64/.test(architecture) ? 'macos-x64' : 'unknown';
  }
  return 'unknown';
};

export const installerName = (version: string, target: AppUpdateTarget) => {
  if (target === 'macos-arm64') return `ND-Image-Converter_${version}_macos-arm64.dmg`;
  if (target === 'macos-x64') return `ND-Image-Converter_${version}_macos-x64.dmg`;
  if (target === 'windows-x64') return `ND-Image-Converter_${version}_windows-x64-setup.exe`;
  return null;
};

const legacyInstallerNames = (version: string, target: AppUpdateTarget) => {
  if (target === 'macos-arm64') return [`ND Image Converter_${version}_aarch64.dmg`, `ND.Image.Converter_${version}_aarch64.dmg`];
  if (target === 'macos-x64') return [`ND Image Converter_${version}_x64.dmg`, `ND.Image.Converter_${version}_x64.dmg`];
  if (target === 'windows-x64') return [`ND Image Converter_${version}_x64-setup.exe`, `ND.Image.Converter_${version}_x64-setup.exe`];
  return [];
};

export const selectInstaller = (release: GitHubRelease, target: AppUpdateTarget): ReleaseAsset | null => {
  const version = normalizeVersion(release.tag_name);
  const names = [installerName(version, target), ...legacyInstallerNames(version, target)].filter(Boolean);
  return (release.assets || []).find((asset) => names.includes(asset.name)) || null;
};

export const summarizeReleaseNotes = (body: string | null | undefined) => {
  const summary = (body || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return summary.length > 220 ? `${summary.slice(0, 217).trimEnd()}…` : summary;
};

export const findLatestRelease = (releases: GitHubRelease[], includePrerelease = false) => releases
  .filter((release) => !release.draft && (includePrerelease || !release.prerelease) && Boolean(parseVersion(release.tag_name)))
  .sort((left, right) => compareVersions(right.tag_name, left.tag_name))[0] || null;

export const resolveReleaseUpdate = (
  releases: GitHubRelease[],
  currentVersion: string,
  target: AppUpdateTarget,
  includePrerelease = false,
): ReleaseUpdate | null => {
  const release = findLatestRelease(releases, includePrerelease);
  if (!release || compareVersions(release.tag_name, currentVersion) <= 0) return null;
  const version = normalizeVersion(release.tag_name);
  return {
    release,
    version,
    installer: selectInstaller(release, target),
    target,
    releaseNotes: summarizeReleaseNotes(release.body),
  };
};
