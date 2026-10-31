# Engine update architecture

## Directory model

The application initializes a writable managed root with Tauri's app-data directory:

```text
<app-data>/media-engines/
  manifest.json                 # active and previous pointers
  staging/                       # transient verified-install inputs
  ffmpeg/<version>/ffmpeg
  ffprobe/<version>/ffprobe
  yt-dlp/<version>/yt-dlp
  gallery-dl/<version>/gallery-dl
  bgutil-pot/<version>/bgutil-pot
```

Version directories are immutable after activation. The application bundle remains read-only and is never updated in place.

## Resolution order

The centralized resolver now checks:

1. A healthy active managed executable from `media-engines/manifest.json`.
2. A healthy bundled executable in the application resources.
3. An explicit `ND_*` development/advanced override.
4. System PATH only in debug builds or with `ND_ALLOW_SYSTEM_BINARIES=1`.

Every job resolves its executable path before starting the subprocess, so an activation cannot switch the binary halfway through that job.

## Implemented lifecycle pieces

- Manifest schema and asset validation.
- HTTPS-only update URL shape validation.
- SHA-256 and size verification before install.
- Platform/architecture and safe-component checks.
- Dedicated staging directory and atomic active-manifest writes.
- Health checks before activation.
- Previous-version pointer and rollback.
- Startup staging cleanup.
- Disk-space guard with a 64 MiB safety reserve on Unix hosts.
- Persisted 24-hour check gating for the controlled manifest path.
- Minimal Media Engines UI with status, check and rollback actions.

The Rust download command accepts only HTTPS assets after URL, target, host, size and cancellation checks. It streams into staging, verifies the expected size and SHA-256, then the install path runs the binary health check before activation. It does not execute a candidate before those checks.

## Deliberate security boundary

Live update checking and installation are disabled by default. Ed25519 verification and canonicalization are implemented and covered by Rust tests, but this repository does not contain a trusted ND publisher key or signing service. Until that release infrastructure exists, the app reports that verified updates are disabled instead of treating an unsigned hash as trust.

Set `ND_ENABLE_ENGINE_UPDATES=1` only in a controlled development test environment. A configured manifest is still rejected unless publisher signature verification is wired to a trusted public key.
