# Third-party distribution inventory

This is an engineering inventory, not legal advice. A release requires legal
review and preservation of the corresponding source offers/notices.

| Component | Version/build | Source/provenance | License/obligation | Current evidence |
| --- | --- | --- | --- | --- |
| FFmpeg/FFprobe macOS | 9.0.2 Martin Riedl | Pinned ZIPs and extracted hashes in `runtime-sources.json` | GPL-enabled build; retain FFmpeg and dependency notices/source offer | arm64 app/DMG verified; Intel source metadata only |
| FFmpeg/FFprobe Windows | BtbN `N-128227-g4811625b5f` | Immutable autobuild ZIP and checksums in `runtime-sources.json` | GPL-3.0-or-later; retain BtbN/FFmpeg source and dependency notices | PE hashes audited; native Windows packaging pending |
| yt-dlp | nightly `2026.08.27.231323` | Official nightly assets and SHA2-256SUMS | Unlicense plus ISC/MIT/other bundled dependencies | macOS binary verified; Windows CI pending |
| gallery-dl | 1.32.19 | Official Codeberg source archive; native PyInstaller build | GPL-2.0-only; provide corresponding source/build provenance | macOS arm64 app/DMG verified |
| bgutil POT provider | v0.8.1 | Official GitHub release assets | GPL-3.0-or-later | Hash metadata recorded; native Windows test pending |
| bgutil yt-dlp plugin | v0.8.1 | Official GitHub ZIP asset | GPL-3.0-or-later and dependency notices | Hash metadata recorded; native Windows test pending |
| PyInstaller environment | Python 3.15.2 / PyInstaller 6.22.3 | Hash-locked macOS build requirements | Preserve dependency notices; not an end-user dependency | Included provenance in gallery build manifest |

The app includes FFmpeg and gallery notices under `src-tauri/resources/`.
yt-dlp and bgutil third-party license bundles still need to be copied into
the release resources before public distribution.
