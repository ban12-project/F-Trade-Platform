---
meta:
  contentType: Reference
---
# Browser acceptance isolation and publication coverage

[Issue #805](https://github.com/ban12-project/F-Trade-Platform/issues/805) addresses ambiguous UI assertions, reuse of unknown local servers and missing first-failure traces. The [acceptance guide](../browser-acceptance.md) separates synthetic UI, database, authenticated browser and live-channel evidence.

## Changes and observed results

The batch UI test now has four independent scenarios and locates results by account. The focused suite also exposed two outdated expectations: a removed setup button and diagnostics moved into a closed details element. Updated assertions verify the current recovery state and expand the diagnostic before reading it. No application business gate changed.

UI and database suites use separate build directories and generated, ignored TypeScript configurations. Preflight checks Node, Chromium and the database connection when required. Both suites retain first-failure traces and screenshots. The two discovered UI failures produced both artifacts before their assertions were corrected.

Local results on 2026-11-02:

| Check | Result |
| --- | --- |
| Publication UI suite | 10 passed, no retries |
| Submission database suite | 12 grouped scenarios passed |
| Batch database suite | All 9 format/outcome combinations and image reconciliation passed |
| Current composer browser integration | Passed: actual text Server Action, one publication, one job, batch audit and reload persistence |
| TypeScript and changed-file Biome | Passed |
| Full repository validation and diff checks | Passed |

The database runner uses only the dedicated loopback database and rejects external fetches inside its suites. Its text, image and video receipts are synthetic. The new authenticated browser test covers text submission; it does not prove browser media upload or image/video Server Action success. Existing media database tests cover the domain transaction separately.

## Remaining boundaries

Live publishing remains outside automatic acceptance. The guide defines the existing application as the live entrypoint, requires per-post confirmation and routes uncertain outcomes to reconciliation without resubmission. This change did not send any post or message.

Run suites sequentially in one checkout because Next.js still generates shared `next-env.d.ts`. Separate checkouts are required for concurrent builds. The existing Partial Prefetching configuration warning remains; this change preserves Cache Components, both React Compiler settings and default Turbopack.

The [writing review](writing-audit-20261102.md) covers 224 Markdown files by structural scan and selected current-document review. It is not a sentence-by-sentence semantic review or a new verification of historical facts. Historical reports were not rewritten.
