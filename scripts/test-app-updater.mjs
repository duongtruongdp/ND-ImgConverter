import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  findLatestRelease,
  isEligibleRelease,
  isTrustedReleaseDownloadUrl,
  isTrustedReleasePageUrl,
  resolveReleaseUpdate,
  selectInstaller,
  targetFromBrowser,
  targetFromNativeTriple,
} from '../src/components/updater/updateUtils.ts';
import {
  APP_UPDATE_CHANNEL_STORAGE_KEY,
  checkAppUpdates,
  fetchReleases,
  readAppUpdateChannel,
  resetInFlightAppUpdateCheck,
  writeAppUpdateChannel,
} from '../src/components/updater/appUpdateService.ts';

const asset = (name, url = `https://github.com/duongtruongdp/ND-ImgConverter/releases/download/v0.9.0/${name}`) => ({ name, browser_download_url: url });
const release = (tag_name, overrides = {}) => ({
  tag_name,
  html_url: `https://github.com/duongtruongdp/ND-ImgConverter/releases/tag/${tag_name}`,
  draft: false,
  prerelease: false,
  body: '## Improvements\n\nFaster downloads and safer updates.',
  assets: [],
  ...overrides,
});

test('compares full semantic versions including prerelease precedence', () => {
  assert.equal(compareVersions('v0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('0.9.0-beta.2', '0.9.0-beta.10'), -1);
  assert.equal(compareVersions('0.9.0-beta.1', '0.9.0'), -1);
  assert.equal(compareVersions('0.9.1', '0.9.0'), 1);
  assert.equal(compareVersions('0.9.0-dev.1', '0.9.0'), -1);
});

test('stable and beta channels apply explicit release eligibility', () => {
  const flagged = release('v0.9.0', { prerelease: true });
  const suffixed = release('v0.9.1-beta.1', { prerelease: false });
  const stable = release('v0.9.0');
  const draft = release('v1.0.0', { draft: true });
  assert.equal(isEligibleRelease(flagged, 'stable'), false);
  assert.equal(isEligibleRelease(flagged, 'beta'), true);
  assert.equal(isEligibleRelease(suffixed, 'stable'), false);
  assert.equal(isEligibleRelease(suffixed, 'beta'), true);
  assert.equal(isEligibleRelease(stable, 'stable'), true);
  assert.equal(isEligibleRelease(draft, 'beta'), false);
  assert.equal(findLatestRelease([flagged, stable], 'beta')?.tag_name, 'v0.9.0');
  assert.equal(findLatestRelease([release('v0.9.0-beta.1'), stable], 'beta')?.tag_name, 'v0.9.0');
});

test('beta selects the highest applicable application version, not publication order', () => {
  const next = findLatestRelease([
    release('v0.9.0-beta.1', { prerelease: true }),
    release('v0.9.1', { prerelease: false }),
    release('v0.9.1-beta.1', { prerelease: true }),
  ], 'beta');
  assert.equal(next?.tag_name, 'v0.9.1');
});

test('same application version is suppressed for stable and beta channels', () => {
  assert.equal(resolveReleaseUpdate([release('v0.9.0', { prerelease: true })], '0.9.0', 'macos-arm64', 'beta'), null);
  assert.equal(resolveReleaseUpdate([release('v0.9.0')], '0.9.0-beta.1', 'macos-arm64', 'stable'), null);
});

test('selects only the exact trusted installer for the native target', () => {
  const current = release('v0.9.0', {
    assets: [
      asset('ND-Image-Converter_0.9.0_macos-arm64.dmg'),
      asset('ND-Image-Converter_0.9.0_macos-x64.dmg'),
      asset('ND-Image-Converter_0.9.0_windows-x64-setup.exe'),
      asset('SHA256SUMS.txt'),
      asset('ND-Image-Converter_0.9.0_engine-manifest.json'),
      asset('ND-Image-Converter_0.9.0_macos-arm64.dmg', 'http://example.invalid/wrong.dmg'),
    ],
  });
  assert.equal(selectInstaller(current, 'macos-arm64')?.name, 'ND-Image-Converter_0.9.0_macos-arm64.dmg');
  assert.equal(selectInstaller(current, 'macos-x64')?.name, 'ND-Image-Converter_0.9.0_macos-x64.dmg');
  assert.equal(selectInstaller(current, 'windows-x64')?.name, 'ND-Image-Converter_0.9.0_windows-x64-setup.exe');
  assert.equal(selectInstaller(current, 'unknown'), null);
  assert.equal(isTrustedReleaseDownloadUrl('https://github.com/duongtruongdp/ND-ImgConverter/releases/download/v0.9.0/a.dmg'), true);
  assert.equal(isTrustedReleaseDownloadUrl('https://evil.example/duongtruongdp/ND-ImgConverter/releases/download/v0.9.0/a.dmg'), false);
  assert.equal(isTrustedReleasePageUrl('https://github.com/duongtruongdp/ND-ImgConverter/releases/tag/v0.9.0'), true);
  assert.equal(isTrustedReleasePageUrl('https://github.com/duongtruongdp/ND-ImgConverter/releases'), true);
});

test('missing architecture installer remains an update with a safe fallback', () => {
  const update = resolveReleaseUpdate([release('v0.9.1', { assets: [asset('SHA256SUMS.txt')] })], '0.8.4', 'macos-arm64', 'stable');
  assert.equal(update?.installer, null);
  assert.equal(update?.checksumAsset?.name, 'SHA256SUMS.txt');
  assert.match(update?.releaseNotes || '', /Faster downloads/);
});

test('native target mapping never guesses Mac architecture from a browser UA', () => {
  assert.equal(targetFromNativeTriple('aarch64-apple-darwin'), 'macos-arm64');
  assert.equal(targetFromNativeTriple('x86_64-apple-darwin'), 'macos-x64');
  assert.equal(targetFromNativeTriple('x86_64-pc-windows-msvc'), 'windows-x64');
  assert.equal(targetFromBrowser({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' }), 'unknown');
  assert.equal(targetFromBrowser({ userAgent: 'Mozilla/5.0 (Macintosh; Mac OS X 14_0)' }), 'unknown');
  assert.equal(targetFromBrowser({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'windows-x64');
});

test('API failures and malformed metadata remain errors, not up-to-date states', async () => {
  await assert.rejects(fetchReleases(async () => ({ ok: false, status: 429, json: async () => [] })), /rate limit/i);
  await assert.rejects(fetchReleases(async () => ({ ok: true, status: 200, json: async () => ({}) })), /malformed/i);
  await assert.rejects(fetchReleases(async () => ({ ok: false, status: 500, json: async () => [] })), /HTTP 500/);
});

test('update channel preference persists separately from engine storage', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(readAppUpdateChannel(storage), 'stable');
  writeAppUpdateChannel('beta', storage);
  assert.equal(values.get(APP_UPDATE_CHANNEL_STORAGE_KEY), 'beta');
  assert.equal(readAppUpdateChannel(storage), 'beta');
  assert.equal(values.has('nd-media-engine-update-channel'), false);
});

test('concurrent checks for the same channel and target share one request', async () => {
  resetInFlightAppUpdateCheck();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ok: true, status: 200, json: async () => [release('v0.9.1', { assets: [asset('ND-Image-Converter_0.9.1_windows-x64-setup.exe')] })] };
  };
  const first = checkAppUpdates({ currentVersion: '0.9.0', target: 'windows-x64', channel: 'stable', fetchImpl });
  const second = checkAppUpdates({ currentVersion: '0.9.0', target: 'windows-x64', channel: 'stable', fetchImpl });
  assert.strictEqual(first, second);
  const result = await first;
  assert.equal(calls, 1);
  assert.equal(result.state, 'update-available');
  assert.equal(result.update?.version, '0.9.1');
  resetInFlightAppUpdateCheck();
});
