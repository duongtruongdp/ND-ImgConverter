# Application update delivery

Application updates and Media Engine Updates are separate systems.

## M4.0 application channels

The About dialog now exposes an independent application update channel preference:

- `Stable` is the default and only considers non-draft GitHub releases that are neither marked `prerelease` nor tagged with a SemVer prerelease suffix.
- `Beta` considers valid non-draft stable and prerelease versions, including a GitHub `prerelease` release whose tag has no suffix such as the current `v0.9.0` release.
- Releases are selected by semantic version ordering, not API order or publication timestamp. A stable and prerelease release with the same `major.minor.patch` represent the same application version for update suppression.
- The choice is stored under `nd-image-converter-app-update-channel` in local webview storage. It does not change Media Engine update behavior or its trust domain.

Checks are manual from About → App Updates, with one guarded background check for the existing notification banner. Concurrent checks for the same version, target and channel share one request. Failed requests show an error and never display an “up to date” message. A newer release without the native target installer remains visible as a safe release-page fallback.

## v0.9.0 behavior

`src/components/updater/UpdateChecker.tsx` reads the installed app version, queries the GitHub Releases API, ignores drafts and stable-client pre-releases, compares semantic versions, and selects only the exact installer for the native target:

- `aarch64-apple-darwin` → `ND-Image-Converter_<version>_macos-arm64.dmg`
- `x86_64-apple-darwin` → `ND-Image-Converter_<version>_macos-x64.dmg`
- `x86_64-pc-windows-msvc` → `ND-Image-Converter_<version>_windows-x64-setup.exe`

The Rust command reports the native target rather than asking the browser to guess it. If the target or matching asset is uncertain, the notice opens the GitHub release page instead of selecting an arbitrary file. Installer URLs must be HTTPS GitHub release-download URLs for this repository; `SHA256SUMS.txt` is shown as integrity metadata when present, but a public checksum does not authenticate the publisher. This is a browser-assisted download, not an authenticated in-app install.

## Tauri updater decision

The current tree does not include `tauri-plugin-updater`, a Tauri updater public key, a private signing key, or signed updater artifacts. v0.9.0 therefore cannot safely gain authenticated direct installation through a remote configuration change. It uses the platform installer download path for existing installations.

A later app build may add the official Tauri updater flow (`tauri-plugin-updater`):

1. Generate a separate updater keypair; never reuse the Media Engine Ed25519 key.
2. Embed the updater public key in the app and store the private key in protected CI signing storage.
3. Produce signed per-platform updater artifacts and a static `latest.json` endpoint.
4. Verify version, target and signature before download/install/relaunch.
5. Test failed downloads, interrupted installation and recovery on clean macOS and Windows machines.

The official plugin requires a public key in `tauri.conf.json`, protected private signing material, HTTPS endpoints or static `latest.json`, and signed per-platform updater artifacts. The plugin's `createUpdaterArtifacts` output is distinct from the existing DMG/NSIS release installers. No updater plugin, public key, endpoint or updater artifact generation is enabled in v0.9.0.

## v0.9.0 bootstrap limitation

The v0.9.0 pre-release does not contain an authenticated Tauri updater trust root. Existing v0.9.0 installations therefore cannot safely acquire direct-install updater support through remote metadata alone. Manual, user-initiated installer downloads remain the supported path until a later signed build embeds the updater public key.

Application update signing does not authenticate Media Engine manifests, and Media Engine updates must continue to use the managed runtime's separate trust domain.
