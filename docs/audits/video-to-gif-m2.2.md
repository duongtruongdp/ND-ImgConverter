# Video to GIF M2.2 theme and timeline audit

Audit date: 2026-11-01

## Confirmed root causes

- The Video to GIF workspace still used literal dark surface colors for the panel, timeline, thumbnail strip, queue thumbnail and zoom badge. The light-theme overrides did not cover every one of those values.
- Timeline zoom changed the visible range correctly, but thumbnail extraction was keyed only by timestamp, updated synchronously for every decoded frame and could continue applying results after a rapid range change.
- The queue header derived its empty state from `renderableItems`, so an empty queue could display “All GIFs Rendered”.

## Implemented corrections

- Added light/dark semantic tokens for muted surfaces, timeline surfaces, filmstrip frames, overview rail and viewport.
- Applied semantic classes to the Video to GIF panels, empty states, timeline shell, information cards, filmstrip, queue rows, queue thumbnails, menu items, progress track and playhead.
- Kept Mark In blue and Mark Out green; both remain visually distinct in either theme.
- Empty queue now says: “No clips added yet. Mark a range and add your first GIF.” The completed label is shown only when the queue contains clips and none remain renderable.
- Theme changes continue to be CSS-variable driven; no component state or queue persistence is reset.

## Timeline performance findings

- Zoom and pan update only the visible `TimelineRange`; they do not seek the preview video.
- Ruler ticks, playhead, selected range, handles and overview viewport are derived directly from the visible range and update before thumbnail work.
- Thumbnail requests are bounded to 8–18 positions based on the visible span. A source-and-timestamp cache prevents reuse across different sources, and the cache is capped at 36 entries.
- Thumbnail extraction starts after the current paint, updates through `startTransition`, and uses a generation guard so stale seeks cannot update the current zoom window. Cleanup cancels the pending animation and detaches the media source.
- Placeholder filmstrip cells remain visible while thumbnails are pending; the source is never decoded into a full-frame timeline image.

This pass does not claim a measured renderer speedup. The FFmpeg graph was unchanged; the existing renderer measurements remain in [video-to-gif-m2.1.md](video-to-gif-m2.1.md).

## Verification

- `npm run build` passed.
- `npm run test:timeline` passed, 5 tests including bounded/adaptive thumbnail request counts.
- `npm run test:video-gif-store` passed, 2 tests.
- `cargo test --lib` passed, 24 tests.
- `cargo check` passed with existing unused/dead-code warnings.
- `git diff --check` passed.

## Limitations

- No automated browser screenshot comparison was available in this pass, so both themes still need a manual visual check at narrow and wide window sizes.
- Thumbnail decode time was not separately profiled with browser performance marks; the implementation is bounded and stale-safe, but no numeric UI latency claim is made.
- Existing runtime/downloader packaging limitations remain documented in the M2 and M2.1 audits.
