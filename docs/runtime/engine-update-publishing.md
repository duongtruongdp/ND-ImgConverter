# Engine update publishing

## Trust model

Engine manifests use a separate Ed25519 trust domain from Tauri application updates. The signed bytes are the deterministic compact JSON representation of the manifest with `signature` set to `null`; this authenticates schema, publisher, asset URLs, hashes, sizes, versions, target identifiers, compatibility fields and licenses.

The verifier is in `src-tauri/src/engine_update.rs`. It requires:

- `ND_ENABLE_ENGINE_UPDATES=1` in the controlled test/release environment;
- a 32-byte base64 public key in `ND_ENGINE_UPDATE_PUBLIC_KEY`;
- an optional expected key id in `ND_ENGINE_UPDATE_KEY_ID`;
- `algorithm: "ed25519"`, a non-empty key id and a valid base64 signature.

Missing or invalid configuration fails closed. The production app must not embed a private key or accept an unsigned manifest.

## Publishing procedure

1. Build each exact target asset in an isolated release runner.
2. Record version, target, size, SHA-256, license and health-check evidence.
3. Generate the canonical manifest without the signature value.
4. Sign it with an offline release key held by the release service or hardware-backed key store.
5. Publish the manifest and assets from an allowlisted HTTPS host.
6. Verify the public key/key id and a local mock download before enabling checks.
7. Retain the signed manifest, artifact hashes and verification logs with the release.

Key rotation requires shipping a new trusted public key/key id before publishing assets signed by the new key. Revoked keys must be rejected by the app configuration and release service. Private-key custody, rotation and revocation are not configured in this repository yet.

## Current state

The signature verifier and canonicalization tests are implemented, but no ND production public key or publisher service is present. The UI therefore reports that verified updates are unavailable. `ND_ENGINE_UPDATE_MANIFEST` is a local controlled-manifest input for testing; it is not a remote production update service.
