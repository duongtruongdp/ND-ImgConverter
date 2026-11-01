import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  findLatestRelease,
  resolveReleaseUpdate,
  selectInstaller,
  targetFromBrowser,
  targetFromNativeTriple,
} from '../src/components/updater/updateUtils.ts';

const asset = (name) => ({ name, browser_download_url: `https://github.com/duongtruongdp/ND-ImgConverter/releases/download/v0.9.0/${name}` });
const release = (tag_name, overrides = {}) => ({
  tag_name,
  html_url: `https://github.com/duongtruongdp/ND-ImgConverter/releases/tag/${tag_name}`,
  draft: false,
  prerelease: false,
  body: '## Improvements\n\nFaster downloads and safer updates.',
  assets: [],
  ...overrides,
});

test('compares stable semantic versions and ignores prerelease tags', () => {
  assert.equal(compareVersions('v0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('0.9.0-dev.1', '0.9.0'), 0);
  assert.equal(findLatestRelease([release('v0.9.0-dev.1', { prerelease: true }), release('v0.8.4')]).tag_name, 'v0.8.4');
});

test('selects only the exact installer for the native target', () => {
  const current = release('v0.9.0', {
    assets: [
      asset('ND-Image-Converter_0.9.0_macos-arm64.dmg'),
      asset('ND-Image-Converter_0.9.0_macos-x64.dmg'),
      asset('ND-Image-Converter_0.9.0_windows-x64-setup.exe'),
      asset('SHA256SUMS.txt'),
      asset('ND-Image-Converter_0.9.0_engine-manifest.json'),
    ],
  });
  assert.equal(selectInstaller(current, 'macos-arm64')?.name, 'ND-Image-Converter_0.9.0_macos-arm64.dmg');
  assert.equal(selectInstaller(current, 'macos-x64')?.name, 'ND-Image-Converter_0.9.0_macos-x64.dmg');
  assert.equal(selectInstaller(current, 'windows-x64')?.name, 'ND-Image-Converter_0.9.0_windows-x64-setup.exe');
  assert.equal(selectInstaller(current, 'unknown'), null);
});

test('returns a fallback update when the release is newer but lacks the matching installer', () => {
  const update = resolveReleaseUpdate([release('v0.9.0', { assets: [asset('SHA256SUMS.txt')] })], '0.8.4', 'macos-arm64');
  assert.equal(update?.installer, null);
  assert.match(update?.releaseNotes || '', /Faster downloads/);
});

test('maps native targets and remains cautious with browser architecture signals', () => {
  assert.equal(targetFromNativeTriple('aarch64-apple-darwin'), 'macos-arm64');
  assert.equal(targetFromNativeTriple('x86_64-pc-windows-msvc'), 'windows-x64');
  assert.equal(targetFromBrowser({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' }), 'unknown');
  assert.equal(targetFromBrowser({ userAgent: 'Mozilla/5.0 (Macintosh; Mac OS X 14_0)' }), 'unknown');
  assert.equal(targetFromBrowser({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'windows-x64');
});
