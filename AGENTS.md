# Contributor and Agent Guidance

## Project

ND Image Converter is a desktop application built with:

- React + TypeScript + Vite for the frontend.
- Tauri v2 for the desktop shell and IPC.
- Rust for the native backend and conversion engine.
- FFmpeg and FFprobe for video processing and probing.
- macOS, Windows, and Linux release targets.

## Branch workflow

- `main` is stable and release-ready only.
- `dev` is for development and testing.
- Do not push experimental work directly to `main`.
- Preserve unrelated work-in-progress changes.
- Prefer focused feature or hotfix branches and separate worktrees when appropriate.

## Repository-first rule

- Inspect the existing architecture before changing it.
- Make the smallest coherent change that solves the problem.
- Reuse established components, stores, IPC, and pipeline behavior.
- Do not redesign a working subsystem without a demonstrated need.

## Key areas

- `src/` — React application, shared types, styles, and client-side state.
- `src/components/` — feature-specific UI, including video workflows.
- `src/stores/` — Zustand stores and session-level frontend state.
- `src-tauri/src/` — Rust commands, models, errors, and native services.
- `src-tauri/src/video.rs` — video probing, conversion, GIF, and still-frame workflows.
- `src-tauri/src/engine/` — image conversion, color, metadata, resize, and watcher pipeline.
- `src-tauri/tauri.conf.json` — Tauri packaging, permissions, and application metadata.
- `.github/workflows/release.yml` — cross-platform release builds and artifacts.

## Validation

Run the standard checks from the repository root:

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml --offline
cargo test --manifest-path src-tauri/Cargo.toml --offline
```

For GUI or runtime changes, also recommend:

```bash
npm run tauri dev
```

## UI conventions

- Support both Dark and Light themes.
- Use semantic theme tokens instead of isolated color overrides.
- Blue accent backgrounds use white text and icons.
- Preserve visual consistency across tabs, controls, and states.
- Media preview surfaces may intentionally remain dark in either theme.

## Conversion rules

- Do not advertise an output format without a real encoder.
- Reuse the existing FFmpeg pipeline for video processing.
- Avoid unbounded concurrency and unnecessary memory duplication.
- Preserve useful backend error propagation to the UI.
- Do not silently overwrite existing output files.

## Release and versioning

- Keep package, Tauri, Rust, and app-visible versions consistent.
- Do not move or recreate existing release tags.
- Stable hotfixes receive a new patch version.
- Review release workflow changes carefully for every supported platform.

## Contributor etiquette

- Keep diffs focused and explain significant behavior changes.
- Do not commit generated binaries or build artifacts.
- Update `Changelog.md` for significant user-visible changes when appropriate.
- Do not remove or rewrite unrelated user changes.
