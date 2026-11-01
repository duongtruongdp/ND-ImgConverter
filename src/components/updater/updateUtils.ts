export type AppUpdateChannel = 'stable' | 'beta';

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
  checksumAsset: ReleaseAsset | null;
  target: AppUpdateTarget;
  releaseNotes: string;
};

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/i;
const RELEASE_REPOSITORY = 'duongtruongdp/ND-ImgConverter';

export const normalizeVersion = (value: string) => value.trim().replace(/^v/i, '');

export const parseVersion = (value: string): ParsedVersion | null => {
  const match = normalizeVersion(value).match(VERSION_PATTERN);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
};

const comparePrerelease = (left: string[], right: string[]) => {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
};

export const compareVersions = (left: string, right: string) => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
};

export const compareApplicationVersions = (left: string, right: string) => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  if (a.major === b.major && a.minor === b.minor && a.patch === b.patch && (a.prerelease.length === 0 || b.prerelease.length === 0)) return 0;
  return compareVersions(left, right);
};

export const hasPrereleaseSuffix = (version: string) => Boolean(parseVersion(version)?.prerelease.length);

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

export const isTrustedReleaseDownloadUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith(`/${RELEASE_REPOSITORY}/releases/download/`)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
};

export const isTrustedReleasePageUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && (url.pathname === `/${RELEASE_REPOSITORY}/releases` || url.pathname.startsWith(`/${RELEASE_REPOSITORY}/releases/`))
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
};

export const selectInstaller = (release: GitHubRelease, target: AppUpdateTarget): ReleaseAsset | null => {
  const version = normalizeVersion(release.tag_name);
  const names = [installerName(version, target), ...legacyInstallerNames(version, target)].filter(Boolean);
  return (release.assets || []).find((asset) => names.includes(asset.name) && isTrustedReleaseDownloadUrl(asset.browser_download_url)) || null;
};

export const selectChecksumAsset = (release: GitHubRelease) => (release.assets || [])
  .find((asset) => asset.name === 'SHA256SUMS.txt' && isTrustedReleaseDownloadUrl(asset.browser_download_url)) || null;

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

const channelFor = (channelOrIncludePrerelease: AppUpdateChannel | boolean): AppUpdateChannel =>
  typeof channelOrIncludePrerelease === 'boolean' ? (channelOrIncludePrerelease ? 'beta' : 'stable') : channelOrIncludePrerelease;

export const isEligibleRelease = (release: GitHubRelease, channel: AppUpdateChannel) => {
  const parsed = parseVersion(release.tag_name);
  if (release.draft || !parsed) return false;
  if (channel === 'beta') return true;
  return !release.prerelease && parsed.prerelease.length === 0;
};

export const findLatestRelease = (releases: GitHubRelease[], channelOrIncludePrerelease: AppUpdateChannel | boolean = 'stable') => {
  const channel = channelFor(channelOrIncludePrerelease);
  return releases
    .filter((release) => isEligibleRelease(release, channel))
    .sort((left, right) => {
      const versionOrder = compareVersions(right.tag_name, left.tag_name);
      if (versionOrder !== 0) return versionOrder;
      const leftStable = !left.prerelease && !hasPrereleaseSuffix(left.tag_name);
      const rightStable = !right.prerelease && !hasPrereleaseSuffix(right.tag_name);
      return Number(rightStable) - Number(leftStable);
    })[0] || null;
};

export const resolveReleaseUpdate = (
  releases: GitHubRelease[],
  currentVersion: string,
  target: AppUpdateTarget,
  channelOrIncludePrerelease: AppUpdateChannel | boolean = 'stable',
): ReleaseUpdate | null => {
  const channel = channelFor(channelOrIncludePrerelease);
  const release = findLatestRelease(releases, channel);
  if (!release || compareApplicationVersions(release.tag_name, currentVersion) <= 0) return null;
  const version = normalizeVersion(release.tag_name);
  return {
    release,
    version,
    installer: selectInstaller(release, target),
    checksumAsset: selectChecksumAsset(release),
    target,
    releaseNotes: summarizeReleaseNotes(release.body),
  };
};
