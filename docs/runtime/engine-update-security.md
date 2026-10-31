# Engine update security

## Controls implemented

- Ed25519 verification covers the complete canonical manifest metadata.
- Stable-channel, safe-component, platform and architecture checks reject malformed assets.
- HTTPS is required; redirects are bounded and HTTPS-to-HTTP or unallowlisted final destinations are rejected.
- Literal loopback, private, link-local and unique-local IP destinations are blocked except for an explicit local test override.
- Downloads stream to staging, enforce a size limit, report progress and support cancellation.
- Expected size and SHA-256 are checked before install.
- Managed files are installed under immutable engine/version directories.
- Runtime health checks run before activation.
- Active/previous pointers are written atomically, with rollback and startup staging cleanup.
- Installation is guarded by a process mutex, active-job deferral and a free-space reserve.
- An invalid managed engine falls back to a healthy bundled engine.

## Threats still requiring evidence

- A real HTTPS mock-server integration suite is not yet present for truncation, cancellation, redirect, private-address and disk-full cases.
- The command surface still needs to be wired so a future frontend can only download assets from a verified manifest, rather than treating a caller-provided allowlist as trust.
- Archive extraction/symlink validation is not applicable to the current single-file staged asset path; any future archive format must add a traversal-safe extractor before use.
- Publisher key custody, revocation and production manifest hosting are not configured.
- Actual packaged binaries have not passed clean-machine health checks.

The safe production setting is to keep live engine updates disabled until those items have evidence.
