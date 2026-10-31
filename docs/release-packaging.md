# Release packaging

## macOS

The CI job builds the `.app` with Tauri and then creates the DMG with
`scripts/build-macos-dmg.mjs`. The project uses the Tauri-generated
`bundle_dmg.sh` with `--skip-jenkins` and `--no-internet-enable` because the
Finder-prettifying AppleScript is not reliable in headless or non-interactive
CI sessions. This preserves the valid disk image and app resources; Finder
cosmetic positioning is intentionally not a release gate.

```sh
ND_RUNTIME_TARGET=aarch64-apple-darwin npm run tauri build -- \
  --target aarch64-apple-darwin --bundles app
ND_RUNTIME_TARGET=aarch64-apple-darwin npm run build:macos-dmg
```

The script requires a native macOS target, uses an explicit output directory,
checks `hdiutil imageinfo`, and prints the artifact size and SHA-256. CI must
mount the resulting DMG read-only, run `verify-runtime-bundle.mjs`, run the
packaged FFmpeg/gallery smoke tests, and detach only the device it attached.
The workflow uploads the result as an internal Actions artifact; it does not
create or publish a GitHub Release.

## Windows

Windows CI uses the configured NSIS target and the approved runtime source
records in `scripts/runtime-sources.json`. Native Windows CI installs the NSIS
artifact into a disposable runner folder, verifies the installed
`resources/binaries` layout, runs PE architecture and version checks, launches
the installed executable, runs the media smoke test, and attempts silent
uninstall. WebView2 is the only expected OS-level prerequisite unless the
Tauri configuration changes.

## Trust boundaries

The app bundle and media-engine updates are separate trust domains. Bundled
engines are checked by source/archive/binary hashes and runtime manifests.
Managed updates remain disabled unless a trusted signed update manifest and
rollback path are configured. No release should silently fall back to
Homebrew, Python, FFmpeg on PATH, Winget or Chocolatey.
