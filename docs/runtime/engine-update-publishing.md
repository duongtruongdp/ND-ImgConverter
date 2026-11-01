# Engine update publishing

## Trust model

Engine manifests use a separate Ed25519 trust domain from Tauri application updates. The signed bytes are the deterministic compact JSON representation of the manifest with `signature` set to `null`; this authenticates schema, publisher, asset URLs, hashes, sizes, versions, target identifiers, compatibility fields and licenses.

The verifier is in `src-tauri/src/engine_update.rs`. Schema 2 requires:

- `ND_ENABLE_ENGINE_UPDATES=1` in the controlled test/release environment;
- a 32-byte base64 public key in `ND_ENGINE_UPDATE_PUBLIC_KEY`;
- a stable expected key id in `ND_ENGINE_UPDATE_KEY_ID`;
- a matching `staging` or `production` channel in `ND_ENGINE_UPDATE_CHANNEL`;
- a positive manifest revision and non-expired publication/expiry window;
- `algorithm: "ed25519"`, a non-empty key id and a valid base64 signature.

Missing or invalid configuration fails closed. The production app must not embed a private key or accept an unsigned manifest.

## Publishing procedure

1. Build each exact target asset in an isolated release runner.
2. Record version, target, size, SHA-256, license and health-check evidence.
3. Generate the unsigned manifest from approved runtime records with `node scripts/prepare-engine-manifest.mjs <artifact-dir> <unsigned.json> <target> <https-base-url>`.
4. Sign it with `node scripts/sign-engine-manifest.mjs` from an isolated publisher environment. The private-key path must come from protected secret storage and is never checked into the repository.
5. Publish immutable, versioned artifacts from an allowlisted HTTPS host; publish the signed manifest last.
6. Verify the public key/key id and a local controlled download before enabling checks.
7. Retain the signed manifest, artifact hashes and verification logs with the release.

## Controlled configuration

Production configuration is intentionally not committed. The release build that should trust a publisher must receive the public key and stable key ID from protected CI/build configuration (they are embedded through compile-time environment values); the manifest location remains runtime configuration. Never log the values or private key:

```text
ND_ENABLE_ENGINE_UPDATES=1
ND_ENGINE_UPDATE_PUBLIC_KEY=<base64 32-byte Ed25519 public key>
ND_ENGINE_UPDATE_KEY_ID=nd-media-prod-1
ND_ENGINE_UPDATE_CHANNEL=production
ND_ENGINE_UPDATE_HOST=updates.example.com
ND_ENGINE_UPDATE_MANIFEST_URL=https://updates.example.com/manifests/0.9.0/production.json
# Local controlled tests may use ND_ENGINE_UPDATE_MANIFEST instead of the URL.
```

To sign a prepared manifest locally with a test-only key, generate the key outside the repository, then run:

```bash
node -e "const c=require('node:crypto'); const k=c.generateKeyPairSync('ed25519'); require('node:fs').writeFileSync('/secure/test-engine-private.pem', k.privateKey.export({type:'pkcs8',format:'pem'}), {mode:0o600}); console.log(k.publicKey.export({type:'spki',format:'der'}).toString('base64'))"
node scripts/sign-engine-manifest.mjs unsigned.json signed.json --private-key /secure/test-engine-private.pem --key-id nd-test-ephemeral-1
```

The test key and private-key file must be deleted or kept outside the workspace after testing. A test key is not production trust.

Key rotation requires shipping a new trusted public key/key id before publishing assets signed by the new key. Revoked keys must be rejected by the app configuration and release service. Private-key custody, rotation and revocation are not configured in this repository yet.

## Current state

The signature verifier, canonical publisher tool, HTTPS manifest fetch and exact verified-asset download path are implemented. No ND production public key, publisher service or approved remote endpoint is configured, so the UI reports that verified updates are unavailable. `ND_ENGINE_UPDATE_MANIFEST` is a local controlled-manifest input for testing; it is not a remote production update service.
