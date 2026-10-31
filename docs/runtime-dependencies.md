# Runtime dependency inventory

Audit date: 2026-11-01

ND Image Converter treats media engines as application-managed runtime dependencies. Production resolution starts at the application bundle and does not silently fall back to a developer machine's PATH.

## Resolver API

The shared resolver is implemented in `src-tauri/src/runtime.rs`:

- `BinaryKind` identifies FFmpeg, FFprobe, yt-dlp, gallery-dl and the optional PO-token provider.
- `resolve_path()` returns a validated executable path for backend call sites.
- `resolve_optional_path()` is used for optional provider binaries.
- `diagnostics()` returns status, source, version, architecture, path and capabilities for the advanced UI.
- `resource_path()` resolves paths relative to the installed application resource directory.

Resolution order:

1. `Contents/Resources/binaries` on macOS or the equivalent Tauri resource directory.
2. Explicit `ND_FFMPEG`, `ND_FFPROBE`, `ND_YTDLP`, `ND_GALLERY_DL` or `ND_BGUTIL_POT` managed paths.
3. A system executable only for debug builds or when `ND_ALLOW_SYSTEM_BINARIES=1` is explicitly set.

The resolver validates version output using argument arrays. FFmpeg additionally must expose `palettegen` and `paletteuse`. It classifies missing files, permission errors, wrong architecture/exec-format errors, missing shared libraries and unsupported process output.

## Inventory

| Binary | Purpose | Version source | Bundling | License / obligations | Status |
| --- | --- | --- | --- | --- | --- |
| FFmpeg | GIF rendering, video conversion, still extraction and downloader merging | CI-installed build; version recorded by `runtime-manifest.json` | `binaries/ffmpeg` on Unix, `binaries/ffmpeg.exe` on Windows | FFmpeg is LGPL 2.1+ by default, but optional GPL/non-free components change obligations. The exact build configuration must be retained with each release. See [FFmpeg legal considerations](https://www.ffmpeg.org/legal.html). | Release workflow bundles; local checked-in binary must not be treated as production evidence |
| FFprobe | Media metadata and downloaded-output verification | Same FFmpeg distribution | `binaries/ffprobe` / `ffprobe.exe` | Same distribution/license record as FFmpeg | Release workflow bundles |
| yt-dlp | URL inspection and authorized media download | `scripts/downloader-versions.json` | `binaries/yt-dlp` / `yt-dlp.exe` | yt-dlp source is Unlicense, but release executables can contain third-party code with different licenses. Use upstream checksum/signature files and retain notices. See [yt-dlp licensing](https://github.com/yt-dlp/yt-dlp#licensing). | Release workflow downloads pinned asset; hash verification remains a release hardening task |
| bgutil-pot | Optional YouTube PO-token provider | `scripts/downloader-versions.json` | `binaries/bgutil-pot` / `bgutil-pot.exe` | GPLv3-or-later. Source and license notices must accompany redistributed binaries. See [bgutil provider](https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs). | Release workflow bundles per target |
| gallery-dl | Image-gallery downloader | Pinned upstream v1.32.19 source; macOS artifact built with hash-locked PyInstaller environment; Windows official binary record | `binaries/gallery-dl` on macOS; `gallery-dl.exe` on Windows when approved | GPL-2.0-only; preserve upstream source, dependency and attribution notices | macOS arm64 `.app` verified locally; x64 source build and Windows package remain CI/pending |
| JavaScript runtime / yt-dlp-ejs | Possible future yt-dlp extractor requirement | Not managed | Not bundled | Must be evaluated before claiming support for extractors requiring JS execution | Not available |
| Python, Go, Rust, Node.js | Build/development tools only | CI toolchains | Never required at runtime | Not runtime dependencies | Not required by the app |

## Runtime path rules

Video Converter, Video to GIF, Grab Stills, downloader analysis, downloader merging and output verification all call the same `video::tool()` adapter, which delegates to the resolver. No ordinary media process uses a shell command string.

The resolver intentionally does not contain Homebrew, Chocolatey, Winget or hard-coded developer paths. CI may install build dependencies, but a successful CI build must verify the packaged resource path rather than the host PATH.

## Update and provenance policy

- Keep versions pinned in repository manifests.
- Generate `src-tauri/binaries/runtime-manifest.json` in CI with version, byte size, SHA-256 and FFmpeg build-configuration records for each downloaded binary.
- Prefer upstream release checksums/signatures before downloading into the bundle.
- Preserve binary source URLs, build flags, licenses and corresponding source archives in release records.
- Never replace a working bundled binary with a downloaded update without verification and atomic replacement.
