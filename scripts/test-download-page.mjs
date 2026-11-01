import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../docs/website/NDImgConverter_download.html', import.meta.url), 'utf8');

test('download page keeps stable release entry, manual OS choices, and no auto-download', () => {
  assert.match(page, /ND Image Converter/);
  assert.match(page, /macos-arm64/);
  assert.match(page, /macos-x64/);
  assert.match(page, /windows-x64/);
  assert.match(page, /RELEASE_URL/);
  assert.match(page, /navigator\.userAgent/);
  assert.doesNotMatch(page, /window\.location\s*=|\.click\(\)/);
  assert.match(page, /SHA-256/);
});
