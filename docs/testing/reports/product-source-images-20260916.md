# Product source images: private intake and Gate 01

Issue #344 records a pre-approval gap: the browser supplied no image bytes, the streaming adapter used text only, and the existing marketing media panel required ProductReady. That panel cannot establish Gate 01 image review.

## Implemented boundary

Single-product import accepts up to four PNG/JPEG images, each at most 5 MiB. Private direct-upload receipts bind the actor, project, purpose, filename, MIME and size. The server bounds reads, fully decodes each image with a 25-million-pixel limit, rejects corrupt/multi-frame files, and preserves the original bytes and SHA-256. Images remain separate from the text excerpts used as field evidence.

Both model entry paths receive the verified bytes. The streaming adapter and the existing non-streaming adapter use the installed AI SDK's file content part. New `product_source_image` rows associate the private evidence with the draft in the creation transaction; migration 0041 is required before deploying this code. Source-image references survive text revisions and cannot be changed through the review form.

Gate 01 provides an authenticated original-image link. Delivery checks project membership, current user ban status, MIME, exact size and digest, then checks membership again after reading. It returns private, uncached bytes without exposing a Blob URL. Approval of an image-backed draft requires explicit image-consistency confirmation; the audit stores the image references, actor, time and reviewed version. Refusal remains available without confirmation. This confirmation does not grant marketing rights.

## Observed validation

- Image regression: purpose/type/path/size limits, full PNG/JPEG decoding, truncated files, APNG animation-control chunks, duplicate/excess receipts and bounded stream cancellation passed.
- PostgreSQL regression: owner/project/purpose isolation, repeated claims, changed bytes, preview isolation, membership revocation during reads, missing/false confirmation, explicit simulated confirmation, refusal and no-image approval passed.
- Streaming SDK regression: both image/no-image requests deliver the expected bytes, retain incremental output and reject truncated final output.
- Existing product field-evidence and A–D synthetic domain regressions passed. These domain fixtures remain distinct from real-image acceptance.
- All 37 repository validation checks and Drizzle migration consistency passed.
- Node 24.21.0 / pnpm 11.24.0 isolated production build and production fixture/anonymous-access checks passed, with Cache Components and React Compiler enabled. The initial successful build used the global Node 26; it was repeated under the declared Node 24 runtime.
- TypeScript passed. Fresh browser console, Next runtime errors and compilation issues were empty after installation completed.

An actual browser test uploaded a 1,597,903-byte rasterized page from an authorized reference PDF plus an independent MOCK CSV. Expectations were frozen before invoking the saved model. The model completed and matched the four expected text fields exactly; it did not add fitment or dimensional facts from the image. The largest observed mutation request was 1,082 bytes, not the image body.

Authenticated preview was byte-identical to the uploaded image; unauthenticated preview returned 403. Browser approval without image confirmation failed. Explicit **simulated** confirmation then reached ProductReady and retained the image link after reload. Both temporary cloud objects were deleted; uncached reads returned null. The isolated local test records remain, so their links intentionally no longer serve those deleted test objects.

## Failures retained and limits

The first SDK assertion looked for the deprecated image content part; the installed SDK emits file parts. The test was corrected to inspect the actual tagged binary data, and both adapters now use the current API. The first PostgreSQL run passed behavior checks but cleanup was rejected by append-only audit triggers. The test now retains synthetic records in its dedicated local test database. Existing mock-based review tests were updated for the new image lookup and explicit no-image audit metadata.

This is one actual image-backed browser/model case plus synthetic negative regressions. It is **not** completion of the twenty-slot A–D protocol, blind visual accuracy, actual factory approval, or production deployment. Catalog batch imports still have no supported per-candidate image association. Original PDFs/images, model output, private URLs and credentials remain outside this report and repository.
