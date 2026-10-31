# gallery-dl standalone runtime

M3.3 records a controlled PyInstaller path for macOS arm64 and x86_64. The
repository may contain the generated runtime for local/package verification,
but release CI must rebuild it on a native runner from the pinned upstream
source and the hash-locked environment.

## Inputs

- Upstream version: `1.32.19`
- Source directory: `ND_GALLERY_DL_SOURCE_DIR`
- Target: `aarch64-apple-darwin` or `x86_64-apple-darwin`
- Python: `ND_PYTHON` or `python3`
- Output: `ND_RUNTIME_OUTPUT` or `src-tauri/binaries`
- Dependency lock: `scripts/gallery-runtime/requirements-macos.lock`

The script fails closed when the source tree, version, PyInstaller, or target
architecture does not match. It never installs packages or fetches source.

## Build

Create a fresh virtual environment and install the exact locked build
dependencies. `pip` must enforce the hashes:

```sh
python3 -m venv .venv-gallery
.venv-gallery/bin/python -m pip install --require-hashes \
  -r scripts/gallery-runtime/requirements-macos.lock
```

Verify the upstream source archive against the release `SHA256SUMS` asset,
extract it, and run:

```sh
ND_RUNTIME_TARGET=aarch64-apple-darwin \
ND_GALLERY_DL_SOURCE_DIR=/path/to/gallery-dl \
ND_GALLERY_DL_SOURCE_COMMIT=e1322ffe8c0880d09ebeb43fd6531ed9bee25583 \
ND_GALLERY_DL_SOURCE_ARCHIVE_SHA256=63323bc1bc37b8ba25c19d2ef7a86158d1f79cccaee8d69dda907986f3f3e824 \
ND_GALLERY_DEPENDENCY_LOCK=scripts/gallery-runtime/requirements-macos.lock \
ND_RUNTIME_OUTPUT=src-tauri/binaries \
node scripts/build-gallery-runtime.mjs
```

Use the x86_64 target on a native macOS x86_64 runner. The script uses
PyInstaller one-file mode, verifies the output architecture and `--version`,
and writes `gallery-dl-build.json` beside the executable. The manifest includes
the source commit/archive hash, dependency-lock path, Python/PyInstaller
versions, artifact hash and size. One-file mode may extract to a temporary
directory at startup; the packaged runtime is tested for that behavior before
release.

## Release controls

The generated hash identifies the artifact but does not establish provenance.
CI must retain the source commit/archive hash, Python and PyInstaller versions,
dependency lock, build logs, code-signing/notarization result, and GPL/dependency
notices. Do not publish a macOS runtime until those records are reviewed.
