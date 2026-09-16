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
3. Create a source-only context with the checked-in helper. It copies only the
   Dockerfile and its three governed Python modules; it rejects symlinks,
   existing output directories, and changed COPY/ADD inputs. Do not use the
   repository root as the build context.

   ```sh
   image_context_parent=$(mktemp -d)
   python3 scripts/prepare-document-image-context.py "$image_context_parent/context"
   docker buildx build --platform linux/amd64 \
     -f "$image_context_parent/context/ops/video-sandbox/Dockerfile" \
     -t "vcr.vercel.com/<team>/<project>/<repository>:<immutable-release-tag>" \
     "$image_context_parent/context" --push
   ```

   Remove the temporary context after the build. No environment files, reference
   documents, application database files, or dependency directories belong in it.
4. Resolve the pushed image digest and set `VIDEO_SANDBOX_IMAGE` to
   `repository@sha256:...` in Preview and Production.

Do not use `latest` in production. The worker probes FFmpeg capabilities again
at runtime and fails closed if subtitles, libx264, or AAC is missing. Document
conversion runs with outbound networking denied and retains the Python wrapper's
extension, size, OCR, and no-text checks.

Official deployment reference: https://vercel.com/kb/guide/how-to-use-vercel-container-registry
