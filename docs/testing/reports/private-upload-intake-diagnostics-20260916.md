# Private upload intake diagnostics — 2026-09-16

Related issue #348. This change adds failure-stage visibility; it does not establish the cause of the historical intermittent failures or introduce automatic retries.

## Evidence and limits

The original cohort recorded two unclaimed, unexpired CSV receipts followed by generic stream-start failures. Later independent private reads returned the expected MIME, size and frozen digest. Those observations do not distinguish transport failure, request validation or another intake boundary. Subsequent empty-file and browser-navigation failures were separately retained, without relabelling them as Blob failures.

During #346 acceptance, two 120-second upload observers timed out, but both uploads subsequently created and completed parsing tasks. These additional observations are test deadline failures, not evidence of server rejection. No frozen expectation was changed.

## Diagnostic behavior

The stream boundary reports a fixed stage: input, project access, model configuration, document, images or run creation. Private Blob reads and catalog intake also report their stage. Diagnostics include only an allowlisted transport code, a validation classification or an unclassified category. Exception messages, stacks, source content, credentials, private URLs and actor/project identifiers are excluded. The client retains its generic error response. Authorization, receipt ownership/expiry, byte validation, database transactions and model execution behavior are unchanged.

No network retry is added on the basis of an unproven historical cause. Future failures can supply a safe stage/code without exposing reference data. Issue #348 remains open for the underlying intermittent failure investigation.

## Validation

- Synthetic regression covers nested transport causes, Zod failures, unknown codes, arbitrary private error content and cyclic causes. Only fixed diagnostic fields are returned.
- PostgreSQL upload regressions passed for bounded bytes, digest/provenance, concurrent claims, content type, purpose, owner/project, expiry and authorization revoked during reading.
- TypeScript and changed-file Biome checks passed with existing optional-chain suggestions.
- An authenticated local HTTP test rejected invalid input and an unrelated project with the unchanged generic 400 response. Server logs showed `input / validation` and `project_access / unclassified`, respectively.
- An actual browser upload of the unchanged frozen full-field CSV, using the saved model in the isolated local database, completed with 20/20 exact fields, no extras and complete evidence references. This is a new successful attempt, not a retroactive pass for the historical failures.
- The single temporary private CSV was deleted after its stream run completed. An uncached read confirmed absence. No model approval or external publication was performed.

Source implementation commit: `968df67`. Remote CI and deployment remain pending.
