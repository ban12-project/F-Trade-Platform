# Approved quotation customer preview

Issue: #823. Baseline: `8194706c7199e89dc4fa1684977d088dcd4c0c60` (`main`).

## Delivered scope

- The approved quotation page now shows a read-only English customer-text preview and an explicit copy button before the existing manual delivery-record form.
- Export formatting requires matching record identity, approved aggregate and payload states, an approved matching approval reference, and a valid displayed version. Draft, rejected, sent, and inconsistent records do not produce an approved preview.
- Commercial terms are copied from the approved quotation without AI generation. Customer, company, product code/name, and requested quantity come only from matching linked records. Both the UI and text distinguish this live linked context from an approval-time snapshot.
- The existing contract has validity days but no start date, expiry date, or quantity unit. These remain explicitly unrecorded. No calendar deadline, order total, engineering specification, or quantity unit is invented.
- Copying does not send a message, invoke a business write, mark delivery, or fill the channel/receipt fields. Clipboard denial retains selectable read-only text and a retry. Copy status is tied to the exact text, not reused after the text changes.
- No schema, database, access-control, CI, merge, deployment, or real customer operations changed. Marketing-video creative guidance does not apply because this is a quotation UI change.

## Passed local verification

Using Node 26.13.0 and the unchanged main dependency set:

- Repository-wide Biome check: 1,098 files, no diagnostics.
- TypeScript `--noEmit` and `git diff --check`.
- Quotation handoff and preview assertions, including approved-state/reference matching, invalid versions, missing/unrelated source records, unknown expiry, excluded internal author/approval data, repeated formatting, and no mutation.
- Existing RFQ completeness, sales clarification, inquiry history, sales journey, delivery confirmation, workflow transition/replay, and workspace contract scripts.
- Next.js development compilation and HTTP 200 for the synthetic approved-quotation page. Parsed server-rendered HTML contains one read-only preview with the expected synthetic customer, product, requested quantity, currency/price, version, and unknown-expiry warning. This is an SSR smoke check, not browser interaction coverage.

## Verification limits and retained failures

- The first production-build attempt could not resolve Next.js through a dependency-directory symlink outside Turbopack's root. Dependencies were copied into this isolated checkout without changing the lockfile.
- The subsequent production build remained in compilation for roughly five minutes while the shared environment was resource constrained. It was interrupted with exit 130; no production-build pass is claimed.
- The configured Playwright browser was absent. An attempt with installed system Chromium 156 failed before browser startup because local Unix sockets are restricted (`EPERM`). Retrying the same localhost-only test run with approved elevated execution still hit that restriction. No browser-security or repository setting was weakened.
- The attempted 18-case run had 17 browser-initialization failures and one existing API-only authorization pass. The three new quotation browser regressions did not reach their assertions. That API pass does not validate the quotation UI.
- The committed browser tests cover exact clipboard contents, repeated copy, no POST/delivery mutation, clipboard-denial fallback/retry, missing context, mismatched approvals, rejection, and Back/Forward navigation. They still require execution in a browser-capable environment before calling interactive acceptance complete.

No full repository aggregate run, authenticated database integration, actual customer delivery, merge, or deployment is claimed.
