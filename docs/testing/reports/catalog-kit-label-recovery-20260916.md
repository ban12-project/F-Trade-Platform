# Independent kit-label recovery — 2026-09-16

Issue #346. Source commit `c4c2b28`. Reference files were authorized for private testing; this report publishes counts and synthetic test details only. Original identifiers, source files, raw OCR, provider output and private object URLs remain outside Git.

## Behavior and bounded claim

Previously, an incomplete component row could prevent discovery of otherwise legible kit headings on the same page. The fallback now recovers individual explicitly labelled kit numbers while supplying no component ownership, dimensions or other engineering facts. Ambiguous captions retain the existing rejection behavior. A damaged heading can be reread only from its own bounded image region. Literal digit grouping is preserved, including the unusual grouping in the frozen visual baseline. Candidates still require source review.

Original OCR is retained separately. A guard rejects recovery that would remove an original recognized identifier. This is source extraction, not factory verification.

## Frozen local reference comparison

The five-page visual baseline was frozen before the repair. Expected values were not changed after implementation.

| Physical page | Visually expected | Previously found | Found after repair | Unexpected |
| --- | ---: | ---: | ---: | ---: |
| 19 | 6 | 6 | 6 | 0 |
| 21 | 6 | 5 | 6 | 0 |
| 25 | 4 | 2 | 4 | 0 |
| 26 | 5 | 2 | 5 | 0 |
| 30 | 5 | 4 | 5 | 0 |

All 26 expected headings were found; all seven missing headings were recovered. Existing page-19 component source blocks remained identical.

| Private document slot | Physical pages | Prior candidates | Current candidates | Lost prior occurrences |
| --- | ---: | ---: | ---: | ---: |
| 1 | 32 | 32 | 68 | 0 |
| 2 | 32 | 47 | 111 | 0 |
| 3 | 48 | 62 | 62 | 0 |
| 4 | 10 | 0 | 0 | 0 |

All four file hashes and all 122 physical-page markers were unchanged. The remaining pages were checked for loss of previous identifier/page occurrences, not against complete visual ground truth. Increased candidate counts do not establish full-catalog accuracy.

## Browser and saved-model acceptance

An actual 16,312,857-byte PDF was uploaded privately from the browser and processed in the isolated local database. The seven previously missing headings were selected from the frozen baseline. The configured saved model completed seven independent drafts without failed model attempts or corrective model retries. All seven drafts contained only the source-supported internal identifier, passed source-location validation, and remained `PRODUCT_REVIEW_REQUIRED` with pending approvals. Reload restored the results. Recorded resumed Server Action payloads were at most 472 bytes.

A simulated approval of an incomplete draft was rejected. Product and pending approval records remained unchanged. This was a negative Gate test, not an actual factory approval. The Next.js runtime probes reported no compilation or session errors; agent-browser confirmed the catalog UI and mounted React component.

Both initial upload observers exceeded their 120-second test deadline. Both uploads subsequently produced parsing tasks; the original task was resumed for the seven-record acceptance. The second task was not sent to the model. These observer timeouts are retained as failed test attempts and do not establish a server-side upload rejection. The first parse attempt took 686 seconds under concurrent local load.

## Image and build checks

The source-only container build excluded references and credentials. Offline native-document, scanned-page and kit-label regression tests passed locally and in a deny-all Vercel Sandbox. Installed preprocessing script hashes matched the source commit. Synthetic subtitle rendering verified H.264 and AAC support. The synthetic-test Sandbox and temporary registry authentication file were deleted; the initially stopped local VM was stopped again.

Private image tag: `ocr-346-c4c2b28`.

Image digest: `sha256:cd20c8d265c1292c864b081a698202f0d4c98490142aca2ed62f0470098f6613`.

Node 24.21.0 / pnpm 11.24.0 production build and production route-boundary checks passed. The first build reached page-data collection but failed because the test environment omitted `BETTER_AUTH_SECRET`; the separate rerun supplied synthetic local test configuration. TypeScript, candidate/preflight tests, native OCR regressions and source-context exclusion tests passed. Existing Biome warnings remain.

## Actual cloud reference and cleanup

The original first PDF also passed a separate deny-all cloud preprocessing test using the same image, 2 vCPUs and the current 600-second Sandbox limit. Creation, transfer, processing and validation took 233 seconds. All 26 frozen visual headings were recovered in exact expected order without extras on those five pages; the source hash was unchanged. The full cloud output contained 65 candidates versus 68 locally. Non-frozen page differences remain unreviewed; this is not a claim of cross-platform full-catalog equivalence or complete accuracy. The cloud Sandbox was stopped and deleted.

Both private PDF uploads were deleted after all parsing/model attempts became terminal; uncached reads confirmed absence. No temporary reference object or Sandbox remains from this acceptance. Preview and Production image pins have not changed. Remote PR/CI/merge and deployed-runtime acceptance remain outstanding.

Subsequent investigation: issue #350 visually confirmed additional omissions on three formerly non-frozen pages. See `catalog-platform-gap-baseline-20260916.md`. The original 26-heading acceptance remains valid within its stated scope; it does not close those new gaps.
