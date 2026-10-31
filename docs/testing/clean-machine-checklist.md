# Clean-machine acceptance checklist

This checklist separates evidence already executed from checks that require a
native clean machine. It must be completed for each release artifact.

## macOS arm64

- [x] `.app` built for `aarch64-apple-darwin`.
- [x] DMG produced, mounted read-only, verified, and detached.
- [x] No Python/Homebrew path required by bundled media engines.
- [x] FFmpeg/FFprobe GIF and still smoke test.
- [x] gallery-dl version, metadata and real image download.
- [x] Unicode output path and deterministic local fixture subprocess test.
- [ ] Fresh supported macOS machine with no developer tools.
- [ ] GUI video download/open/reveal and gallery subset flow.
- [ ] GUI cancellation/retry with visible child-process cleanup.
- [ ] Developer ID signing, notarization, stapling and Gatekeeper verification.

## macOS x86_64

- [ ] Native Intel runner builds the PyInstaller gallery runtime.
- [ ] Native Intel `.app` and DMG are mounted and verified.
- [ ] Runtime manifest and architecture checks pass.
- [ ] Clean Intel machine smoke test.

## Windows x64

- [ ] Native Windows runner downloads and verifies all approved PE assets.
- [ ] NSIS installer is produced.
- [ ] Installer is installed on a clean Windows machine.
- [ ] No Python, global FFmpeg, Winget or Chocolatey dependency.
- [ ] Unicode install/output paths.
- [ ] Offline conversion, video download, gallery download and queue recovery.
- [ ] Authenticode signatures verified.

## Required evidence

Record artifact path, byte size, SHA-256, OS build, architecture, engine
versions, installer logs, runtime diagnostics and any manual deviations. Do
not mark a platform release-ready from a CI runner alone when the checklist
requires a clean-machine test.
