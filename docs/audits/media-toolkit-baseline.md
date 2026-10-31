# ND Image Converter media-toolkit baseline

Audit date: 2026-11-01

This report records the repository baseline and the first incremental implementation pass. The audit intentionally preserves existing work in progress and does not treat the reference application as code to copy.

## Repository and architecture

- Tauri 2 desktop shell with a React 19 + TypeScript frontend and Rust backend.
- Vite builds the frontend; `src-tauri/src/lib.rs` registers Tauri commands and owns shared application state.
- Image conversion is split into Rust engine modules for decoding, resizing, color management, metadata, watermarking and folder watching.
- Video workflows are React tabs backed by a shared Rust `video` module. FFmpeg/FFprobe are invoked through argument arrays, not shell strings.
- Media executable lookup is now centralized in `src-tauri/src/runtime.rs`; video and downloader paths share the resolver and diagnostics contract.
- Downloader work is isolated in `src-tauri/src/download.rs` and `VideoDownloaderTab.tsx`; it uses a pinned standalone yt-dlp binary and emits progress events.
- Tauri resources currently include FFmpeg, FFprobe, yt-dlp and the PO-token provider in release workflows. The checked-in FFmpeg/FFprobe files are development placeholders, not production binaries.

The baseline working tree before this implementation pass was on branch `dev`, tracking `origin/dev`, with pre-existing uncommitted changes in:

- `src-tauri/src/download.rs`
- `src/components/video/VideoDownloaderTab.tsx`

Those changes were preserved.

## Feature inventory

| Area | Current implementation | Assessment |
| --- | --- | --- |
| Image conversion | Rust `image` pipeline with batch processing, resizing, metadata controls, RAW/HEIC paths, WebP/AVIF/EXR/PDF support | Broad and established; needs more clean-machine coverage |
| Batch image processing | Rayon-based command with progress and cancellation state | Implemented; output collision and cancellation behavior should stay in the release matrix |
| RAW/HEIC/color | `rawloader`, `heic`, Little CMS, embedded-preview and ICC paths | Implemented; hardware/format coverage is not exhaustively tested |
| Video to GIF | Local probe, HTML video preview, trim controls and FFmpeg palette generation | Previously single-export only; now upgraded with persistent multi-clip queue and zoom model |
| Video conversion | Sequential batch conversion with codec/audio/CFR options | Implemented; depends on a valid packaged FFmpeg runtime |
| Grab Stills | Timestamp seek and JPEG/PNG/WebP extraction | Implemented; VFR frame semantics are timestamp-based |
| Watch Folder | Debounced image/video routing with profile settings | Implemented; requires operational regression tests |
| Downloader | URL analysis, format selection, browser-cookie opt-in, progress and safe yt-dlp arguments | Single-job workflow; gallery-dl and multi-job queue remain future work |
| Runtime dependency resolution | Centralized Rust resolver with bundled-first validation and advanced diagnostics | Implemented; production artifact and clean-machine verification remain |
| Packaging | Tauri bundles resources and CI downloads platform binaries | Release workflow exists but is not yet a clean-machine proof |

## Confirmed problems found

1. The original GIF export always wrote `<input-stem>.gif` with `-y`, so a second export silently overwrote the first.
2. The original timeline mapped the entire source duration directly to the control width. There was no visible range, zoom, pan model or stable coordinate space for long media.
3. The original GIF UI had no queue, so changing the current In/Out range could not produce independent snapshots from one loaded video.
4. The original FFprobe query did not request `avg_frame_rate`, although the frontend already exposed FPS-dependent frame stepping in Grab Stills.
5. `src-tauri/tauri.conf.json` lists bundled video resources, but the repository's checked-in `ffmpeg` and `ffprobe` files are tiny placeholders. Release CI replaces them; a local packaged build without the release preparation step is not self-contained.
6. The release workflow targets macOS Apple Silicon, Windows x64 and Ubuntu x64, but does not currently build a macOS Intel artifact or a universal macOS package.
7. The README and release workflow previously instructed users to remove macOS quarantine manually. Those instructions are now replaced with checksum verification and the normal Finder/System Settings approval flow; signing and notarization remain release blockers.

## Potential risks

- FFmpeg redistribution terms depend on the exact binary build and enabled codecs. Every shipped binary needs a source, version, license and architecture record.
- VFR sources do not have a uniform frame-to-time mapping. The new probe reports a VFR heuristic and keeps stored boundaries as timestamps; exact per-frame timestamps would require a frame-table probe.
- HTML video preview support varies by platform and codec even when FFmpeg can decode the source.
- Browser-cookie extraction is sensitive data access and must remain explicit, local and absent from logs.
- yt-dlp website compatibility changes independently of the application release. Engine updates need hash/signature verification and rollback behavior.
- Queue persistence stores local source paths. Restored items can become unavailable after a file move, so missing-source validation must be visible before rendering.
- Long-running FFmpeg processes need cancellation, temporary output paths and finalization checks; completion must never be reported before the final rename succeeds.

## Reference audit: YTDown

Reference: [JustinNguyen9979/YTDown](https://github.com/JustinNguyen9979/YTDown).

The repository is a Go/Wails application with dedicated downloader, gallery, compressor, dependency-checker, cookie and update modules. Its README describes yt-dlp, gallery-dl and FFmpeg as external dependencies and documents automatic installation through Homebrew, Winget or Linux package managers. It also describes single video/audio, playlist, thumbnail, cookie and image-gallery workflows.

The repository README declares MIT licensing. No YTDown source implementation was copied. The recommended strategy for ND Image Converter is a clean Rust/Tauri integration around managed standalone binaries:

- Keep URL inspection, format normalization, job state, progress and output management in the existing Rust domain.
- Keep subprocess execution on blocking workers with argument arrays and explicit output templates.
- Reuse the existing FFmpeg runtime for merging/remuxing where needed.
- Add gallery-dl only after its binary license, version pin, platform coverage and output contract are documented.
- Avoid the reference application's package-manager installation model in production because it conflicts with the clean-machine requirement.

This preserves the existing Tauri architecture, avoids a second desktop runtime, and lets the application enforce its own path, URL and subprocess safety rules. The tradeoff is that ND must own binary acquisition, validation, update policy and platform packaging instead of inheriting YTDown's package-manager setup.

## Dependency and packaging inventory

| Dependency | Purpose | Current source/path | Current weakness |
| --- | --- | --- | --- |
| FFmpeg | GIF rendering, video conversion, still extraction, downloader merging | `src-tauri/binaries/ffmpeg` in release bundles | CI obtains it from Homebrew/Chocolatey/apt without recording a binary hash or license manifest |
| FFprobe | Local media metadata and output verification | `src-tauri/binaries/ffprobe` | Same provenance and clean-machine verification gap |
| yt-dlp | Online video analysis/download | Pinned release asset from `scripts/downloader-versions.json` | Nightly updates are pinned by version but not hash-verified in CI |
| bgutil PO-token provider | Optional YouTube token provider | Release-downloaded provider binary and plugin | GPLv3/provider obligations and architecture matrix need explicit release documentation |
| gallery-dl | Planned gallery extraction | Not integrated | No binary, license or queue contract yet |
| JavaScript runtime / yt-dlp-ejs | Potential future yt-dlp extractor requirement | Not separately managed | Must be evaluated before claiming broad website compatibility |

Runtime resolution now prefers validated application resources, then explicit managed overrides. System PATH fallback is limited to debug builds or `ND_ALLOW_SYSTEM_BINARIES=1`; production diagnostics report binary path, version, architecture and validation status without silently depending on the developer machine.

## Implemented in this pass

- Added a persistent Zustand-backed GIF render queue with immutable per-item export snapshots.
- Added a shared timeline coordinate model with visible range, zoom around an anchor, fit-to-video, panning and frame snapping helpers.
- Added Video to GIF queue actions for add, select/edit, explicit update, rename, duplicate, remove, individual render, Render All, retry failed and cancellation.
- Added keyboard shortcuts with form-control focus protection.
- Added collision-safe GIF names, temporary output files and atomic finalization around FFmpeg.
- Added FFprobe frame-rate fields and a visible VFR limitation notice.
- Added focused Rust tests for safe filenames and collision handling.

## M2 implementation pass

- Added `src-tauri/src/runtime.rs` as the shared resolver for FFmpeg, FFprobe, yt-dlp, gallery-dl and bgutil-pot.
- Production resolution now prefers bundled resources and refuses implicit system PATH fallback; debug builds and `ND_ALLOW_SYSTEM_BINARIES=1` retain explicit development fallback.
- Added safe version/capability checks, architecture reporting and friendly advanced diagnostics in the About dialog.
- Added runtime bundle verification and binary manifest scripts, plus CI wiring for macOS arm64/x64 and Windows x64 resource checks.
- Added the required runtime, packaging and clean-machine documentation.

## M2.1 implementation pass

- Separated the video preview from the timeline editor and reorganized the workspace into source, preview/transport, timeline, compact GIF settings and queue zones.
- Added a lazy bounded thumbnail filmstrip, ruler ticks, overview viewport, stronger marker hitboxes and timecode fields.
- Added compact queue rows, meaningful aggregate labels, FFmpeg progress events, elapsed time, Open GIF and Show in Finder/Explorer actions.
- Recorded before/after renderer measurements in [video-to-gif-m2.1.md](video-to-gif-m2.1.md). The renderer graph was unchanged, so no speedup is claimed.

## M2.2 implementation pass

- Added semantic light/dark theme tokens for the Video to GIF workspace, timeline, filmstrip, overview rail, queue cards and controls.
- Made the empty Render Queue explicit instead of treating an empty queue as “All GIFs Rendered”.
- Kept zoom/pan state separate from preview seeking and bounded thumbnail work to the visible range plus a small cache.
- Added stale-result protection and low-priority thumbnail updates for rapid zoom changes.
- Recorded the theme and timeline audit in [video-to-gif-m2.2.md](video-to-gif-m2.2.md). No renderer speedup is claimed because the FFmpeg graph was unchanged.

## M2.3 implementation pass

- Removed the Video to GIF timeline filmstrip, thumbnail extraction, timestamp cache and stale thumbnail scheduling entirely.
- Replaced it with a geometry-only track rendered from duration, visible range, marker positions and playhead time.
- Centralized pan clamping in the timeline model and isolated the visual track in a memoized component so unrelated render-progress updates do not rebuild its DOM.
- Recorded the result and profiling limitation in [video-to-gif-m2.3.md](video-to-gif-m2.3.md). No interactive frame-latency number is claimed because no browser-control surface was available.

## M2.4 implementation pass

- Compactified the geometry-only timeline while preserving marker hitboxes, ruler precision, overview navigation, zoom and frame snapping.
- Replaced the three large timing cards with a compact In / Out / Length row and tightened the time edit controls.
- Simplified Video to GIF, timeline, settings and queue copy for a more casual operator workflow.
- Recorded the UI pass in [video-to-gif-m2.4.md](video-to-gif-m2.4.md).

## Prioritized next steps

1. Add deterministic frontend tests for the timeline model and queue reducer/store behavior, then add FFmpeg fixture tests for output duration and filename collisions.
2. Pin and provenance-check release binaries, then attach manifests and hashes to release artifacts.
3. Extend the downloader into a persistent bounded queue with cancellation/retry, then evaluate gallery-dl separately.
4. Add secure engine-update metadata, signature/hash verification and rollback.
5. Build and validate macOS Intel/universal packaging, Windows clean-machine packaging and signed/notarized release artifacts.
6. Add a clean VM acceptance matrix covering image conversion, all video tools, downloader inspection/download, merging and gallery images.

## Acceptance matrix

| Scenario | Current status | Evidence / gap |
| --- | --- | --- |
| One source, multiple independent GIF ranges | Implemented in UI/store | Requires fixture-driven end-to-end render test |
| Zoom does not change clip timestamps | Implemented as pure timeline model | Timeline tests pass |
| Selecting a queue item restores its range | Implemented | Add UI integration test |
| Explicit Update Clip preserves other items | Implemented | Add store test |
| Overlapping and duplicate ranges | Supported | Add store/render fixture test |
| Render All with per-item settings | Implemented sequentially | Requires FFmpeg fixture test |
| Collision-safe output and temp finalization | Implemented in Rust | Rust unit tests pass |
| Cancellation and Retry Failed | Implemented at UI/backend process boundary | Needs process-level fixture test |
| VFR source-frame exactness | Timestamp exact; frame table not yet implemented | Documented limitation |
| Downloader multi-job/gallery queue | Not implemented | Phase 2 |
| Clean-machine release validation | Not proven | M2 release blocker; requires actual artifacts/VMs |

## Verification baseline for this pass

- `npm run build`: passed.
- `npm run test:timeline`: passed, 7 tests covering anchor stability, boundary clamping, long/short media, pointer mapping, marker precision, repeated zoom, pan clamping, frame snapping and invalid selections.
- `cargo test --lib video::tests`: passed, including the real FFmpeg fixture test.
- `cargo test --lib`: passed, 24 tests total.
- `cargo check`: passed with existing dead-code/import warnings.
- `npm run benchmark:gif`: completed before/after the M2.1 UI/progress pass; output bytes and filter graph stayed identical, so no speedup is claimed. See [video-to-gif-m2.1.md](video-to-gif-m2.1.md).
- `node scripts/verify-runtime-bundle.mjs src-tauri --require-downloader`: correctly rejects the checked-in FFmpeg/FFprobe development wrappers; the local yt-dlp executable also cannot complete its PyInstaller semaphore check in this sandbox. No release artifact was available for clean inspection.
- `cargo fmt --all -- --check`: reports pre-existing formatting differences across unrelated files; no broad formatting rewrite was applied to preserve the working tree.
