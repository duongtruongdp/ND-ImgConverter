# Media engine inventory

Audit date: 2026-11-01

This inventory describes the checked-in development tree and the release workflow. It is not a claim that the current checkout is production-ready.

| Engine | Current local state | Release source/provenance | macOS arm64 | macOS x64 | Windows x64 | License / obligation | Health check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FFmpeg + FFprobe | macOS arm64 checkout now contains genuine Martin Riedl 9.0.2 static binaries; Intel pair verified in a temporary staging directory | Martin Riedl 9.0.2 ZIPs, pinned with archive and extracted-binary hashes for both macOS targets | Verified locally; `.app` artifact pass | Source/archive verified; app not built | Blocked: no approved Windows archive/binary record | GPL-enabled build; retain publisher/source/dependency notices and obtain legal review | `-version`, `-buildconf`, `palettegen`, `paletteuse`; FFprobe `-version` |
| yt-dlp | `2026.08.27.231323`, local universal Mach-O | Official nightly asset and SHA2-256 record now pinned for macOS and Windows | Local macOS verified; native Intel/Windows packaging pending | Native CI pending | Native CI pending | Unlicense plus ISC/MIT/other upstream dependency notices | `--version` |
| gallery-dl | macOS arm64 self-contained PyInstaller onefile, `1.32.19`; gallery route integrated | Pinned Codeberg source archive/tag, native build manifest and hash-locked dependencies; Windows official binary record | Verified locally; packaged `.app` pass | Controlled source-build workflow prepared; native CI build pending | Official x64 asset metadata exists; full Windows bundle blocked by other runtime approvals | GPL-2.0-only; source/dependency/license notices ship in bundle | `--version`, isolated metadata preview and fixture download |
| yt-dlp JavaScript components | No yt-dlp-ejs or managed JavaScript runtime is bundled | No source/pin selected | Not available | Not available | Not available | Do not enable arbitrary remote JavaScript | No health check until a compatible local runtime is selected |
| bgutil-pot | Local arm64 binary, `0.8.1`; plugin tree is release-only | Official v0.8.1 assets and per-target hashes now pinned | Local arm64 only | Native CI pending | Native CI pending | GPL-3.0-or-later; source and notices required | `--version` |

## Local file evidence

These hashes are for the current checkout on this workstation and must not be reused as release hashes for a different artifact:

- `src-tauri/binaries/ffmpeg`: `2e11c6f90993cdb79fff84d3f90044d28316b310e75b3e030cfc9a54f2c9d384` — genuine Mach-O arm64, Martin Riedl 9.0.2.
- `src-tauri/binaries/ffprobe`: `2738aa46a7f9acbc8ab09a6715554c90f7de603171ac403726765685df6a0059` — genuine Mach-O arm64, Martin Riedl 9.0.2.
- `src-tauri/binaries/yt-dlp`: `282d67228a418b4f0c56ce0ca82d0f6b12dc31bb5d3f7b85c1d5944974e1fbe8` — universal arm64/x86_64 Mach-O.
- `src-tauri/binaries/bgutil-pot`: `34b83baf0a557fecaa6d67a8177e53e169c2ccf987182883a4bae289a7176883` — arm64 Mach-O.

## Current architecture decision

FFmpeg and FFprobe are one update group and must be activated together in a production manifest. yt-dlp and any required JavaScript companion must likewise be treated as one compatibility group. gallery-dl is an optional GPL runtime with a separate source-build provenance record and must not be represented as an official macOS upstream binary.
