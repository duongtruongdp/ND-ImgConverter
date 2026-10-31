# Update manifest contract

The update manifest is intended to be published by the ND release process over HTTPS after signature verification is implemented.

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-01T00:00:00Z",
  "publisher": "ND Image Converter release team",
  "signature": {
    "algorithm": "ed25519",
    "keyId": "nd-media-prod-1",
    "value": "base64-signature"
  },
  "assets": [
    {
      "engine": "yt-dlp",
      "version": "2026.08.27.231323",
      "channel": "stable",
      "platform": "macos",
      "architecture": "arm64",
      "downloadUrl": "https://updates.example.invalid/yt-dlp",
      "sha256": "64-lowercase-hex-characters",
      "sizeBytes": 123,
      "publisher": "yt-dlp project",
      "minAppVersion": "0.9.0",
      "companions": [],
      "license": "Unlicense",
      "fileName": "yt-dlp"
    }
  ]
}
```

## Required publishing workflow

1. Build the exact platform artifact in a clean release runner.
2. Record version, architecture, size, SHA-256, license notices and health-check expectations.
3. Sign the canonical manifest with the offline ND release key.
4. Publish the manifest and assets over HTTPS from an allowlisted release host.
5. Keep the public verification key bundled in a future signed app release; never ship the private key.
6. Test a local mock server and a clean-machine install before enabling automatic checks.

The current implementation rejects unsigned manifests and does not claim that a downloaded sidecar hash is trustworthy by itself. Live checks remain disabled until the public-key and publisher configuration is supplied.
