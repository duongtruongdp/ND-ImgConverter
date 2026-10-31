# Video to GIF M2.4 compact timeline and copy audit

Audit date: 2026-11-01

## Changes

- Reduced the timeline track from a large `h-44` editor to a compact ruler/track layout: 24px ruler, 56px track and 8px overview rail.
- Kept marker hitboxes generous while shrinking the visible blue/green marker bodies.
- Replaced three large information cards with one compact In / Out / Length summary row.
- Tightened the edit row inputs and controls, while preserving timecode editing, Set In, Set Out and Fit behavior.
- Reduced the initial empty-video panel and empty queue padding.
- Kept the geometry-only timeline and M2.3 fast zoom path unchanged.

## Copy changes

- “Drag handles to select a range. Zoom follows the playhead; pan with Shift + wheel.” → “Drag to pick a range. Use 1 / 2 to zoom.”
- “Mark In”, “Mark Out” and “Selected Duration” → “In”, “Out” and “Length” in the compact summary.
- “Fit Entire Video” → “Fit”.
- Empty queue → “No clips yet. Pick a range, then add your first GIF.”
- Shortened queue statuses and shortcut help; changed “GIF export” to “GIF settings”.

## Verification

- `npm run build`: passed.
- `npm run test:timeline`: passed, 7 tests.
- `npm run test:video-gif-store`: passed, 2 tests.
- `cargo check`: passed with existing warnings.
- `cargo test --lib`: passed, 24 tests.
- `git diff --check`: passed.

No thumbnail code or new async work was introduced.
