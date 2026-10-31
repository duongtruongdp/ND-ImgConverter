# Video to GIF M2.1 UX and performance audit

Audit date: 2026-11-01

## Confirmed UX issues

- The video preview contained the trim timeline as an overlay, reducing preview area and mixing playback with editing.
- The timeline had only endpoint labels, weak marker hitboxes and no visual overview of the full source when zoomed.
- Export settings, time editing and queue actions were spread across dense inline controls.
- Queue rows exposed several unlabeled icon-only actions and used `Render All (N GIFs)` even when all work was complete.
- Completed outputs had no direct Open GIF or Show in Finder/Explorer action.
- Render progress was only represented by a global busy state; FFmpeg progress was not surfaced.

## Implemented

- Separated preview, transport, timeline editor, compact GIF settings and Render Queue into distinct workspace zones.
- Added a readable ruler, lazy bounded thumbnail filmstrip, playhead, larger Mark In/Out hitboxes, selected range highlight and full-duration overview viewport.
- Kept timeline coordinate transforms in `src/components/video/timeline.ts`; zoom remains anchored without changing saved In/Out values.
- Replaced time number inputs with editable timecode controls and kept keyboard shortcuts protected from form fields.
- Redesigned the queue as compact media rows with metadata, status, per-clip progress, elapsed time, contextual actions and meaningful aggregate labels.
- Added direct `Open GIF`, `Show in Finder / Explorer`, and single-folder `Open Output Folder` actions through the installed Tauri opener plugin.
- Added FFmpeg `-progress pipe:2` reporting while preserving the single-process palettegen/paletteuse graph and atomic temporary-output finalization.
- Added `scripts/benchmark-gif.mjs` and the `benchmark:gif` package script.

## Benchmark method

The benchmark creates the same local 640×360 H.264, 30 FPS, 12-second fixture and runs the existing single-process palette renderer for 2, 6 and 12 seconds. It records elapsed wall time and output bytes. It uses the local debug/system FFmpeg on this workstation; it is not evidence for a bundled release binary.

| Case | Width | FPS | Before UI pass | After UI/progress pass | Output bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Short 2s | 320 | 10 | 170 ms | 161 ms | 105,676 |
| Medium 6s | 480 | 12 | 522 ms | 498 ms | 773,701 |
| Long 12s | 640 | 15 | 1,604 ms | 1,488 ms | 3,001,320 |

The renderer/filter graph was not changed between runs. The small difference is normal local timing variance; no performance improvement is claimed. The result confirms output size/settings are stable and provides a repeatable baseline for future optimization.

## Validation limits

- The benchmark covers CFR H.264 only; VFR, 23.976/24/25/29.97/60 FPS and large 4K sources still need dedicated fixtures.
- Per-clip progress now comes from FFmpeg progress output, but the UI intentionally does not estimate remaining time until enough historical data exists for a meaningful estimate.
- Thumbnail generation samples visible timeline positions through a temporary HTML video element and bounds its cache; it does not decode the entire source.
