import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const diagnostics = readFileSync(new URL('../src/components/settings/RuntimeDiagnostics.tsx', import.meta.url), 'utf8');
const engines = readFileSync(new URL('../src/components/settings/MediaEngines.tsx', import.meta.url), 'utf8');
const downloader = readFileSync(new URL('../src/components/video/VideoDownloaderTab.tsx', import.meta.url), 'utf8');

test('About is instrumented for immediate first-frame timing and responsive modal bounds', () => {
  assert.match(app, /nd-about-click/);
  assert.match(app, /nd-about-click-to-state/);
  assert.match(app, /nd-about-first-frame/);
  assert.match(app, /max-h-\[calc\(100vh-1\.5rem\)\]/);
  assert.match(app, /aria-modal="true"/);
  assert.match(app, /key === 'Escape'/);
});

test('advanced runtime sections load only after their details element opens', () => {
  assert.match(diagnostics, /onToggle=/);
  assert.match(engines, /onToggle=/);
  assert.doesNotMatch(engines, /useEffect\(\(\) => \{ if \(!loaded\)/);
  assert.match(diagnostics, /get_runtime_diagnostics/);
  assert.match(engines, /get_engine_inventory/);
  assert.match(diagnostics, /nd-about-diagnostics-load/);
  assert.match(engines, /nd-about-engines-load/);
  assert.match(diagnostics, /requestRef/);
  assert.match(engines, /requestRef/);
});

test('downloader keeps sign-in opt-in and exposes the compact multi-source queue', () => {
  assert.match(downloader, /> Media Downloader</);
  assert.match(downloader, /Paste one or more media links/);
  assert.match(downloader, /Analyze links/);
  assert.match(downloader, /MP4 video/);
  assert.match(downloader, /Parallel downloads/);
  assert.match(downloader, /Connections per download/);
  assert.match(downloader, /download_gallery_url/);
  assert.match(downloader, /Select all/);
  assert.match(downloader, /selectedIndexExpression\(source\.selectedPlaylist\)/);
  assert.match(downloader, /selectedIndices: isGallery \? source\.selectedGallery/);
  assert.match(downloader, /jobId: job\.id/);
  assert.match(downloader, /Ready to retry/);
  assert.match(downloader, /slice\(0, visibleCount\)/);
  assert.match(downloader, /Show more/);
  assert.match(downloader, /Browser sign-in/);
  assert.match(downloader, /label: 'No sign-in'/);
  assert.match(downloader, /No clips yet\./);
  assert.doesNotMatch(downloader, />PO Token provider:/);
  assert.match(downloader, /Show folder/);
  assert.match(diagnostics, /refresh_runtime_diagnostics/);
  assert.match(engines, /refresh_engine_inventory/);
});
