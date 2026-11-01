import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { canonicalManifestBytes, signManifest } from './sign-engine-manifest.mjs';

const fixture = () => ({
  schemaVersion: 2,
  channel: 'staging',
  manifestRevision: 1,
  publishedAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  generatedAt: '2026-11-01T00:00:00Z',
  publisher: 'ND test publisher',
  signature: null,
  assets: [{
    engine: 'yt-dlp', packageId: 'yt-dlp', version: '2026.10.26', channel: 'stable', platform: 'macos', architecture: 'arm64',
    downloadUrl: 'https://updates.example.invalid/yt-dlp', sha256: 'a'.repeat(64), sizeBytes: 12,
    publisher: 'yt-dlp project', minAppVersion: '0.9.0', companions: [], license: 'Unlicense', fileName: 'yt-dlp',
  }],
});

test('publisher signs the same canonical bytes used by the Rust verifier', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signed = signManifest(fixture(), privateKey.export({ type: 'pkcs8', format: 'pem' }), 'nd-test-ephemeral-1');
  const signature = Buffer.from(signed.signature.value, 'base64');
  assert.equal(signed.signature.algorithm, 'ed25519');
  assert.equal(verify(null, canonicalManifestBytes(signed), publicKey, signature), true);
});

test('changing a signed asset field invalidates the signature', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signed = signManifest(fixture(), privateKey.export({ type: 'pkcs8', format: 'pem' }), 'nd-test-ephemeral-1');
  const modified = structuredClone(signed);
  modified.assets[0].sizeBytes = 13;
  assert.equal(verify(null, canonicalManifestBytes(modified), publicKey, Buffer.from(signed.signature.value, 'base64')), false);
});
