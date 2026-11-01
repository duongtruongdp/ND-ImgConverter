# Engine distribution repository plan

The proposed dedicated repository is `duongtruongdp/ND-ImgConverter-Engines`. It has not been created or authorized in this milestone.

## Separation

1. Source/build recipes and approved provenance records.
2. Immutable engine artifacts and required notices.
3. Signed schema-2 manifests for staging and production.
4. Publication history, revision pointers and revocation records.

The application repository contains only the client verifier, preparation/signing tooling, and a manual dry-run workflow. It does not hold a production private key and does not publish an update feed.

## Hosting recommendation

Use immutable GitHub Release assets in the dedicated repository, with versioned release identifiers and exact asset URLs. A small static HTTPS host is also acceptable if it provides immutable paths, external hash verification and controlled manifest pointer updates. Do not use Actions artifact URLs as a production endpoint and do not use mutable `latest/download` URLs as the signed artifact identity.

## Required protected environments

- `engine-staging-sign`: staging Ed25519 private key, staging key ID, staging channel and staging host.
- `engine-production-sign`: production Ed25519 private key, production key ID, production channel and production host.
- Separate publish permission from source/build permissions.
- Require human approval for production signing and manifest-pointer publication.
- Keep revoked key IDs in client configuration before rotating to a new trust root.

The repository owner must create the dedicated repository, configure protected environments, choose the hosting destination and authorize production publication before the client can enable `ND_ENABLE_ENGINE_UPDATES=1` for end users.
