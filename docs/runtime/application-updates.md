# Application update delivery

Application updates and Media Engine Updates are separate systems.

## v0.9.0 behavior

`src/components/updater/UpdateChecker.tsx` reads the installed app version, queries the GitHub Releases API, ignores drafts and stable-client pre-releases, compares semantic versions, and selects only the exact installer for the native target:

- `aarch64-apple-darwin` → `ND-Image-Converter_<version>_macos-arm64.dmg`
- `x86_64-apple-darwin` → `ND-Image-Converter_<version>_macos-x64.dmg`
- `x86_64-pc-windows-msvc` → `ND-Image-Converter_<version>_windows-x64-setup.exe`

The Rust command reports the native target rather than asking the browser to guess it. If the target or matching asset is uncertain, the notice opens the GitHub release page instead of selecting an arbitrary file. This is a browser-assisted download, not an authenticated in-app install.

## Tauri updater decision

The current tree does not include `tauri-plugin-updater`, a Tauri updater public key, a private signing key, or signed updater artifacts. v0.9.0 therefore cannot safely gain authenticated direct installation through a remote configuration change. It uses the platform installer download path for existing installations.

A later app build may add the official Tauri updater flow:

1. Generate a separate updater keypair; never reuse the Media Engine Ed25519 key.
2. Embed the updater public key in the app and store the private key in protected CI signing storage.
3. Produce signed per-platform updater artifacts and a static `latest.json` endpoint.
4. Verify version, target and signature before download/install/relaunch.
5. Test failed downloads, interrupted installation and recovery on clean macOS and Windows machines.

Application update signing does not authenticate Media Engine manifests, and Media Engine updates must continue to use the managed runtime's separate trust domain.
