# Field-specific streaming output and twenty-slot follow-up

Issue: [#347](https://github.com/ban12-project/F-Trade-Platform/issues/347).
Source change: `cb47f49`; prompt `1.0.3`.

The saved model now returns OE arrays, canonical kit membership and boolean sample availability
without losing supported facts in the twenty-slot follow-up. The first run's failures remain in
[the earlier report](product-cohort-run01-20260916.md).

## Change and safety boundary

The model-facing schema now ties each field to its value type. The prompt explains exact OE strings,
kit-label-to-enum mapping, explicit yes/no booleans (including false), numeric values, reviewed fitment
labels, and null proposals for missing evidence. The existing wire contract and independent source
and domain validation still reject unsupported facts. There is no runtime coercion of unsupported
model output and no use of images as engineering evidence.

The first typed-schema browser attempt failed before producing fields: the saved provider rejected
Zod's `oneOf`. The final schema uses `anyOf` with distinct literal field values. A regression checks
the actual AI SDK request schema, and the saved provider accepted it. Both failed drafts remain
recorded; neither was promoted.

## Browser/model results

The same frozen twenty CSVs, expected values and original page image hashes from #345 were reused.
No source or expected value changed. These remain **independent MOCK supplements containing literal
reference identifiers**, not proof of factory facts or raw-PDF extraction accuracy.

| Attempt | Browser slots | Correct model imports | Simulated Ready |
| --- | ---: | ---: | ---: |
| run 02: unsupported schema | 2 | 0 | 0 |
| run 03: supported schema | 20 | 19 | 19 |
| run 04: unchanged remaining slot | 1 | 1 | 1 |

Run 03's remaining slot never called the model. Its screenshot showed an empty file input and the
text-source validation errors; the browser waited for a stream response that never occurred. A fresh
project and an explicit interactive model-picker check before file selection completed run 04.
The timing cause is not established. This does not resolve the earlier receipt/start failures in
[#348](https://github.com/ban12-project/F-Trade-Platform/issues/348).

The latest twenty accepted attempts contain **260/260 exact sourced fields**, correct OE and fitment,
and expected blocker detection. Run 03 alone is 240/260 when unavailable output is scored zero.
All twenty reached simulated Ready, with one rejection/revision each in A, B, C and D (four revisions
total). Ten image records passed byte-exact private preview, native browser image rendering, refusal
without explicit image confirmation, and confirmation audit checks. Ten no-image records remained
without image associations. Images remained bound through revision.

The initial A revision did not complete after only some evidence choices were rebound. Selecting the
original document explicitly for every unchanged fact allowed that single revision to pass; B used
the same workaround. The imported location-reference display/retention defect is tracked in
[#349](https://github.com/ban12-project/F-Trade-Platform/issues/349). This workaround is disclosed,
not treated as proof that editing one field preserves all original location refs automatically.

Two image-review checks initially timed out (opening the native preview and a private preview GET).
Their records were retained and the read-only checks were repeated successfully. The first A revision
harness also stopped after a five-second state wait; its later continuation and the evidence rebinding
are preserved. Review durations are browser automation measurements, including continuation time
where applicable, and cannot establish a human review-time target.

[Latest twenty contract records](cohort-347/latest/) and
[three failed import/start attempts](cohort-347/failed-attempts/) validate against ProductAcceptanceResult.
An independent database audit checked final facts, source-image associations, saved model metadata,
approval/rejection counts, exact revision counts, and explicit image-confirmation audits.

## Verification and cleanup

- Streaming regression suite passed: incremental delivery, truncation, cancellation, locked
  authorization, expired/foreign/finished writes, evidence validation and image byte boundaries.
- Added regressions reject string OE, human-readable kit output, string booleans and invalid numeric
  types; valid canonical values remain subject to independent labelled-source checks.
- TypeScript passed; changed-file Biome check has no errors (existing warnings remain).
- Next.js Turbopack compilation probe returned no issues; runtime probe returned no errors. The
  authenticated agent-browser session rendered the import UI and exposed its React tree.
- All **37** temporary private objects from these follow-ups were deleted. Every uncached read after
  deletion returned null. Original reference files and local append-only audit records remain.

There was no actual human/factory approval, live publication, external business message, formal quote
or production deployment. This is success across retained attempts, not a claim of one fault-free
end-to-end run. #346 catalog omissions, #348 diagnosis and #349 revision behavior remain outstanding;
GitHub workflow-scope authentication and PR/CI/squash delivery are also pending. MVP1 is not complete.
