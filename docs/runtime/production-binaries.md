# Production runtime binaries

Audit date: 2026-11-01

## Current finding

The macOS arm64 and x86_64 entries now use genuine FFmpeg 9.0.2 static builds from Martin Riedl's FFmpeg Build Server. The arm64 pair was downloaded, archive-verified, extracted, inspected and used in a real `.app`/`.dmg` build. The Windows entry remains blocked until the archive and extracted PE files are independently inspected.

All target records are now populated in `scripts/runtime-sources.json` with immutable URLs, versions, architectures and hashes. Native Intel/Windows packaging and installed-app acceptance remain pending; the workflow must still fail closed if any downloaded artifact does not match these records.

## Approved macOS candidate

Publisher: Martin Riedl FFmpeg Build Server. FFmpeg's official download page identifies third-party macOS static builds as the executable distribution path; the selected publisher provides separate arm64 and amd64 release ZIPs, SHA-256 files, open build scripts, signed macOS binaries and notarized installer options.

| Target | Version | Archive SHA-256 | Extracted FFmpeg SHA-256 | Extracted FFprobe SHA-256 |
| --- | --- | --- | --- | --- |
| macOS arm64 | 9.0.2 | `c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924` / `fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6` | `2e11c6f90993cdb79fff84d3f90044d28316b310e75b3e030cfc9a54f2c9d384` | `2738aa46a7f9acbc8ab09a6715554c90f7de603171ac403726765685df6a0059` |
| macOS x86_64 | 9.0.2 | `7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4` / `2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd` | `b25689cf2211c0582d317e849912769a1f1c93904fe102c485b5364a425633d1` | `b5df9964b0c2048318fafedcd4e3bbafbc561033cee77de8da1840685d8a9d0d` |

The exact URLs, archive format and executable paths are in the source metadata. Both binaries report version 9.0.2, are Mach-O for their target architecture, expose `palettegen` and `paletteuse`, and link only Apple system frameworks in the observed `otool -L` output. The selected build advertises a macOS 12.3 minimum load-command and the app configuration now matches that floor.

The build configuration enables GPL and libraries including x264, x265, dav1d, SVT-AV1, OpenH264, OpenSSL and others. The distribution describes these builds as GPLv3; retain the publisher's notices/source offer and obtain legal review before public distribution.

## Required source record

Before enabling a target, record all of the following in the reviewed source configuration:

- exact FFmpeg and FFprobe version and matching build;
- publisher and immutable HTTPS release/source reference;
- SHA-256 for each downloaded file;
- target architecture and minimum OS;
- `-version`, `-buildconf` and required `palettegen`/`paletteuse` evidence;
- whether the build is LGPL or GPL and which enabled codecs/dependencies add obligations;
- required DLLs/dylibs and their licenses/notices;
- source offer/build instructions when the selected license requires them.

The project must not use Homebrew, Chocolatey or apt output as a redistributable runtime source.

## Reproducible commands

After a source review fills the target entry, run:

```bash
ND_RUNTIME_TARGET=aarch64-apple-darwin node scripts/prepare-release-runtime.mjs
ND_RUNTIME_TARGET=aarch64-apple-darwin node scripts/verify-release-sources.mjs --ffmpeg-only
node scripts/write-runtime-manifest.mjs src-tauri/binaries
node scripts/verify-runtime-bundle.mjs src-tauri --require-downloader
```

The preparation script downloads only over HTTPS, verifies the archive SHA-256, rejects unsafe ZIP paths, extracts only the approved executable path, verifies the extracted binary SHA-256 and runs the binary version command. The bundle verifier additionally rejects wrappers, checks architecture/permissions, FFmpeg GIF filters, runtime manifest hashes and the FFmpeg/FFprobe version pair.

## Current evidence

The local wrapper hashes and local yt-dlp/bgutil hashes are recorded in [engine-inventory.md](engine-inventory.md) for audit purposes only. They must not be copied into a production source record.
