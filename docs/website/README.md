# Website download page package

`NDImgConverter_download.html` is a self-contained, WordPress-compatible landing page for the existing public URL:

`https://duongtruongdp.net/NDImgConverter_download`

The current endpoint still redirects visitors to the old combined v0.8.4 ZIP. It was inspected but not modified because hosting/WordPress administrator access was not available in this workspace.

## Deployment

1. The verified v0.9.0 GitHub pre-release is published and its exact asset URLs are already populated in `NDImgConverter_download.html`.
2. Verify each URL returns the expected installer type and compare its downloaded SHA-256 with the release `SHA256SUMS.txt`.
3. Replace the current direct-file redirect with this page, preserving the existing `/NDImgConverter_download` path.
4. Keep the old ZIP available at its existing URL until the new page has been checked from a clean browser session.

The page does not start a download automatically. Browser signals are treated as a recommendation only; all three manual choices remain visible. Mac CPU architecture is intentionally shown as uncertain when the browser cannot prove it.

## WordPress options

- Use a full-page HTML block only if the site permits inline `<style>` and `<script>`.
- Otherwise upload this file as a static page and configure the existing endpoint to redirect to it.
- Do not change unrelated header/footer or WordPress routing.
- Do not put Media Engine URLs or manifests on this application download page.
