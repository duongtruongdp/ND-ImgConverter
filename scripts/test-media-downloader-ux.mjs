import test from 'node:test';
import assert from 'node:assert/strict';
import { clampDownloaderSetting, parseMediaUrls, selectedIndexExpression } from '../src/components/video/downloaderUtils.ts';

test('media URL input trims, ignores blanks, and deduplicates', () => {
  assert.deepEqual(parseMediaUrls('  https://a.example/x\n\nhttps://b.example/y\nhttps://a.example/x  '), [
    'https://a.example/x', 'https://b.example/y',
  ]);
});

test('download settings stay inside safe bounds', () => {
  assert.equal(clampDownloaderSetting(99, 1, 4), 4);
  assert.equal(clampDownloaderSetting(0, 1, 16), 1);
  assert.equal(clampDownloaderSetting(Number.NaN, 1, 16), 1);
});

test('playlist indices are stable and safe for yt-dlp', () => {
  assert.equal(selectedIndexExpression([4, 1, 4, 0, -2, 2.5, 3]), '1,3,4');
});
