# Current synthetic upload acceptance — 2026-10-02

Refs #492, #307 and #348. Production baseline `86d49db38c73c7f6e68cf87145aa84e40d2937f7`.
Only newly created, explicitly labelled synthetic test records were used. No factory facts,
product approval, production orphan deletion, social proxy, post or DM was involved.

## Observed production result

An authenticated browser created a separate TEST ONLY SYNTHETIC project. The first
313-byte CSV used underscore column names outside the current evidence-label contract.
Its browser upload, receipt claim and project evidence attachment succeeded. An independent
uncached private Blob read returned 200 with exact bytes, size and SHA-256 equality.
The stream request then returned 400; the existing sanitized diagnostic recorded
`stage: start_run, category: unclassified`, and no product/stream run was created.

A separate execution through the configured deny-all, non-persistent document Sandbox
converted those same bytes successfully and produced zero recognized evidence locations.
The Sandbox stopped in the existing finally path. The negative input is preserved as a
rejected attempt; this is not proof of the historical #348 incident's cause.

A separately named 251-byte fixture used explicit `Product name` and `Product type`
headers. The browser uploaded it, conversion completed, the real configured model produced
two source-validated fields, and the durable stream run completed. Read-only database
verification found version 3 in `PRODUCT_REVIEW_REQUIRED`, only those two saved fields,
and a pending approval. Missing SKU/OE/fitment remained blocking; nothing was approved.
An independent uncached private read again returned 200 with exact bytes/size/SHA-256.

`reconcile-evidence-uploads.ts --dry-run` returned an empty intent count before this run.
Browser-direct receipts are a separate durable protocol and do not populate the server-upload
intent table. Empty counts do not establish that historical objects are present or recover #463.
No `--apply` maintenance ran.

## Repair and verification

The source rejection previously appeared as an administrator/evidence/model configuration
failure. Fixed source-error codes now distinguish missing labels and excessive locations,
with concrete instructions to label fields or split the input. The browser reads only the
allowlisted response code, never an exception or provider response body. Unknown errors
retain a generic message. The existing evidence parser, 512-location limit, authorization
and human review requirements are unchanged.

Local TypeScript 7 and Turbopack production testing build passed. The source-location and
sanitized-diagnostic suites passed; all 15 project-workflow browser tests passed without
retries, including both new pre-run error cases, partial-stream feedback, source-free rejection,
and cross-origin/unauthenticated rejection. Final remote CI is recorded on the PR.

## Preserved setup failures and limits

- A WSL UNC file selection appeared as a zero-byte malformed filename in the desktop browser
  bridge. The subsequent large-file selection attempt encountered a renderer crash. This is
  not a successful 25 MiB boundary test or an established application defect. A fresh tab in
  the same authenticated browser accepted the small fixture from a verified Windows path.
- The first standalone preprocessing probe lacked the local OIDC context; adding the existing
  CLI-provided project OIDC context allowed the same application function to complete.
- The initial local typecheck caught a nullable Blob stream in an ignored inspection helper;
  an explicit guard corrected it. The first browser runner resolved its server command from
  the temporary configuration directory and failed before any tests; setting its working
  directory to the repository fixed the harness. The subsequent 15-test run passed.
- Original factory inputs, full source/OCR accuracy, large-file desktop acceptance and real
  business Gates remain unverified. This synthetic slice does not close #307 or #348.
