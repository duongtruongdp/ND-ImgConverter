# Video to GIF M2.3 minimal timeline audit

Audit date: 2026-11-01

## A. Confirmed causes of zoom latency

- The M2.2 timeline performed HTML video seeks and canvas JPEG extraction for visible positions whenever the range changed.
- Thumbnail state updates caused repeated React work during zoom, and stale extraction work needed cancellation guards.
- The parent workspace also recreated timeline handlers during unrelated render-progress updates.

## B. Thumbnail subsystem removed

- Removed the `ThumbnailStrip` component, thumbnail cache, timestamp sampling, media extraction loop, stale-generation logic and low-priority thumbnail updates.
- Removed timeline thumbnail CSS and the thumbnail-count test helper.
- No FFmpeg thumbnail command or media-processing decoder was removed. Grab Stills and actual GIF export remain unchanged.

The timeline now has zero image elements and zero video/canvas work beyond the existing preview video.

## C. New timeline design

- Adaptive ruler labels remain derived from the visible time range.
- The main track is a theme-token surface with a selected-range overlay, blue Mark In handle, green Mark Out handle and theme-aware playhead.
- The overview rail remains a lightweight geometry-only viewport indicator.
- Zoom, Fit, pan, pointer mapping and frame snapping continue to use the shared transforms in `src/components/video/timeline.ts`.
- The timeline track is isolated as a memoized component; render-progress updates do not recreate its DOM when timeline props are unchanged.

## D. Performance measurements

The repository already had a running Tauri dev process, but no browser-control surface/tab was available for this pass. Therefore the requested 7-second, 90-second and 15-minute interactive measurements were not run, and no frame latency or React render-count number is claimed.

Static/runtime inspection confirms:

- `handleZoom` only calls the local `zoomTimeline` transform and `setVisibleRange`.
- Zoom does not call `invoke`, FFmpeg, `seek`, `load`, thumbnail extraction or queue-store actions.
- The codebase contains no timeline thumbnail extraction path after this change.
- The Rust render path was not modified by M2.3.

## E. Verification

- `npm run build`: passed.
- `npm run test:timeline`: passed, 7 tests covering anchor precision, short/long media, repeated zoom, marker coordinates and pan boundaries.
- `npm run test:video-gif-store`: passed, 2 tests.
- `cargo check`: passed with existing unused/dead-code warnings.
- `cargo test --lib`: passed, 24 tests.
- `git diff --check`: passed.

## F. Remaining limitations

- Interactive Tauri profiling still needs a connected browser/desktop surface to measure input-to-frame timing, React render counts and rapid key input behavior.
- VFR remains timestamp-based as documented in prior audits.
- The parent component still owns preview and queue state; the timeline geometry itself is isolated, but a full state-domain split into separate preview/settings/queue components remains a future refactor.
