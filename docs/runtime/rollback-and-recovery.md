# Rollback and recovery

## Activation

An engine update is copied into a new `<engine>/<version>/` directory, verified, health-checked and then activated by an atomic replacement of `media-engines/manifest.json`. The prior active pointer is retained in `previous`.

If health checking fails, activation is not completed. If the app is restarted after an interrupted staging copy, startup removes transient staging entries and leaves the active manifest untouched.

## Rollback

The Media Engines section exposes `Restore previous version` when a previous pointer exists. Rollback switches the active pointer atomically; it never deletes bundled resources or the previous managed directory.

## Failure cases

- Missing/corrupt managed executable: resolver falls back to a verified bundled engine.
- Wrong platform or architecture: asset is rejected before installation.
- Path traversal or unsafe file name: manifest is rejected.
- Checksum or size mismatch: staged file is rejected.
- Insufficient disk space: installation is rejected before copying into the version directory.
- Active jobs: installation request is deferred/rejected when `activeJobs > 0`; existing subprocesses retain their already-resolved path.
- No trusted publisher key: update checks remain disabled and the user keeps the bundled fallback.

The current tree has not passed a clean-machine packaged-app recovery test. That remains a release blocker.
