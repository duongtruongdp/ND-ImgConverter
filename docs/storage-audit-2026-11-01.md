# Storage audit and safe cleanup

Audit date: 2026-11-01

## Scope and safety

The audit was read-only. No files were deleted because `npm run tauri dev` was active and the startup hook was running `src-tauri/binaries/yt-dlp --version`. The project contains uncommitted source, runtime and documentation changes; those were treated as protected.

## Workspace usage

Measured with filesystem-local `du -x`:

| Path | Size | Classification | Action |
| --- | ---: | --- | --- |
| Project total | 5.5G | Workspace | Preserved |
| `src-tauri/target/` | 5.3G | Rust/Tauri generated build output | Approval required; active dev process |
| `src-tauri/target/debug/deps/` | 3.7G | Rust compiled dependencies | Approval required; rebuild cost |
| `src-tauri/target/debug/incremental/` | 460M | Incremental Rust artifacts | Approval required; active dev process |
| `src-tauri/target/debug/build/` | 382M | Rust build-script outputs | Approval required; active dev process |
| `node_modules/` | 146M | Installed frontend dependencies | Approval required; network/reinstall cost |
| `dist/` | 384K | Vite production output | Regenerable but not removed |
| `src-tauri/gen/` | 952K | Generated Tauri schemas | Preserved; referenced by build tooling |
| `src-tauri/binaries/` | 77M | Runtime binaries and plugins | Protected; not disposable cache |
| `.git/` | 7.6M | Git history and worktrees | Protected |

No project-local `.part`, `.tmp`, `.temp`, `.log`, installer, DMG or stale media files were found. Eight `.DS_Store` files occupied approximately 50 KiB; they were not removed because the space is immaterial and Finder may recreate them.

## Active process check

Active processes included:

- `npm run tauri dev` / Tauri CLI.
- `npm run prepare:ytdlp-pot`.
- `src-tauri/binaries/yt-dlp --version`.
- VS Code, Rust Analyzer and Codex automation.

No process termination was performed.

## Outside-workspace findings

These locations were inspected but not modified:

- `~/.cargo/registry`: 523M.
- `~/.rustup`: 1.5G, including toolchains.
- `~/.npm`: 780M, including `_cacache` at 519M.
- `~/Library/Caches`: 2.5G, including Arc at 1.1G, Homebrew at 420M and Google at 261M.
- `~/Library/Developer/Xcode/DerivedData`: 0B.

They may be shared by other projects and require a separate explicit cleanup decision.

## Preventive changes

`.gitignore` now covers project-local Vite/scratch/benchmark directories and generated FFmpeg partial-download suffixes. The benchmark itself uses a temporary directory and removes it after completion.
