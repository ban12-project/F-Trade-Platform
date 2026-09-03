# Video Sandbox image

This image is the deterministic media and document worker for MVP1. It contains
FFmpeg, libass/subtitles, H.264 encoding, AAC encoding, curl, DejaVu fonts, Python,
and a pinned Microsoft MarkItDown PDF converter. The Next.js deployment does not
run FFmpeg or Python inside a request function.

Source assets are streamed into the network-restricted Sandbox with ten-minute,
exact-path, GET-only private Blob URLs. They are never buffered in a Vercel
Function before FFmpeg runs.

## Publish to Vercel Container Registry

1. Link this repository to the intended Vercel project and pull a fresh OIDC
   token with `vercel env pull .env.local`.
2. Authenticate Docker to `vcr.vercel.com` with username `oidc` and the
   `VERCEL_OIDC_TOKEN` as password.
3. From the repository root, build with
   `docker buildx build -f ops/video-sandbox/Dockerfile . --push` and an immutable
   release tag in the linked project's VCR namespace. The repository-root context
   is required so the governed MarkItDown wrapper can be copied into the image.
4. Resolve the pushed image digest and set `VIDEO_SANDBOX_IMAGE` to
   `repository@sha256:...` in Preview and Production.

Do not use `latest` in production. The worker probes FFmpeg capabilities again
at runtime and fails closed if subtitles, libx264, or AAC is missing. Document
conversion runs with outbound networking denied and retains the Python wrapper's
extension, size, OCR, and no-text checks.

Official deployment reference: https://vercel.com/kb/guide/how-to-use-vercel-container-registry
