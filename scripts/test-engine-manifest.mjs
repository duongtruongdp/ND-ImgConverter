import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUnsignedManifest } from './prepare-engine-manifest.mjs';

test('engine manifest builder binds approved target metadata and artifact hashes', () => {
  const manifest = buildUnsignedManifest({ artifactDir: 'src-tauri/binaries', target: 'aarch64-apple-darwin', baseUrl: 'https://updates.example.invalid' });
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.assets.length, 5);
  assert.equal(manifest.assets.find((asset) => asset.engine === 'ffmpeg').architecture, 'arm64');
  assert.equal(manifest.assets.find((asset) => asset.engine === 'ffmpeg').companions[0], 'ffprobe');
  for (const asset of manifest.assets) {
    assert.match(asset.downloadUrl, /^https:\/\//);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.ok(asset.sizeBytes > 0);
  }
});
