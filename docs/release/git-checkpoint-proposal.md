# Git checkpoint proposal

Do not stage the entire worktree. The current branch contains intentional
uncommitted M2–M3.4 work plus generated/ignored runtime artifacts.

Suggested review groups:

1. Video/GIF: `src-tauri/src/video.rs`, `src/components/video/`, timeline and
   GIF store tests.
2. Downloader/queue: `src-tauri/src/download.rs`, `src-tauri/src/lib.rs`,
   `src/stores/mediaDownloadStore.ts`, downloader UI and queue tests.
3. Runtime manager: `src-tauri/src/runtime.rs`, `engine_update.rs`, settings
   diagnostics and runtime tests.
4. Packaging: `tauri.conf.json`, runtime source manifests, build/verify scripts,
   gallery lock, release workflow and packaging docs.
5. Notices/tests: resource notices, fixture scripts, audit documents and
   clean-machine checklist.

Keep generated `src-tauri/target/`, PyInstaller staging, downloaded archives and
ignored binaries out of the first checkpoint unless a deliberate binary
artifact review explicitly approves them. Review binary hashes and source
records before staging any forced ignored file.
