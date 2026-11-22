# Production engine update bootstrap

This document is a design gate for production Media Engine Updates. It does
not activate production trust and it does not authorize a production key.

## Trust domains

- Staging uses the separate `nd-media-staging-1` Ed25519 identity and the
  public `ND-ImgConverter-Engine-Feed` repository.
- Production must use a new key ID and private key. The staging private key
  must never sign a production manifest.
- Production builds must embed the production public key, channel and HTTPS
  host at compile time. Runtime environment variables must not override those
  values in release builds.

## Required production controls

1. Create a protected `engine-production-sign` environment with mandatory
   human approval and a narrowly scoped publishing workflow.
2. Keep publisher source and provenance records private; publish only signed
   manifests, immutable artifacts, checksums and required third-party notices.
3. Publish immutable versioned release assets first, verify them anonymously,
   then publish the signed manifest pointer last.
4. Record key ID, manifest revision, artifact hashes, architecture, license
   notices and the approval event in a non-secret audit record.
5. Ship an application build that explicitly trusts the production key before
   enabling the production channel for end users.
6. Add the next key ID to a reviewed rotation/revocation plan before changing
   signing identity. Never reuse a staging key for production.

## Activation gate

Production remains disabled until the owner approves the production key,
endpoint, protected-environment rules, artifact provenance and a native
installed-app update/rollback acceptance run. A staging manifest or staging
client build is not evidence that production trust is active.

## Recovery

An invalid signature, wrong channel, expired manifest, stale revision,
architecture mismatch, hash mismatch or failed health check must leave the
last known-good managed engine active. Rollback remains a local explicit
operation; failed downloads and failed activation must not replace the active
executable.
