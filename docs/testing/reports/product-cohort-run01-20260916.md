# Twenty-slot browser acceptance, run 01

Issue: [#345](https://github.com/ban12-project/F-Trade-Platform/issues/345).
Implementation tested: `e03bc21`, stream prompt `1.0.2`, locally running Next.js and isolated PostgreSQL,
with the user-saved model configuration and authorized private Blob uploads.

**Result: 8 passed, 12 failed. MVP1 acceptance remains incomplete.**
The [twenty contract records](cohort-345-run01/) preserve the first attempt, including failures.
A completed stream is not equivalent to a correct product.

| Cohort | Attempted | Exact import and simulated Gate passed | Field extraction failed | No stream run created |
| --- | ---: | ---: | ---: | ---: |
| A: complete fields, image | 5 | 0 | 5 | 0 |
| B: complete fields, no image | 5 | 0 | 3 | 2 |
| C: application identity without OE, image | 5 | 5 | 0 | 0 |
| D: application identity without OE, no image | 5 | 3 | 0 | 2 |

## Inputs and measurement

Twenty distinct identifiers were visually checked on authorized original catalog pages.
Each input is an independent, clearly marked MOCK CSV supplement: only its identifier is copied from
that source; product names, fitment, OE, specifications and commercial values are test inputs, not
factory claims. A/B contain twenty supported fields each; C/D contain six each. Inputs, byte hashes,
expected values, image associations and planned revisions were frozen before model execution.
All twenty passed document-conversion and source/domain-validation preflight before any model call.

A/C use unedited original catalog page images containing the selected row and other products.
They test private image delivery and review controls; they do not establish isolated product photo
quality or actual human confirmation of image identity. B/D have no image association.
No image is used as engineering field evidence. This CSV path does not measure raw PDF extraction.

The final independent audit counted 185 exact fields out of 260 expected (71.15%), including
unavailable outputs as zero. Array comparison treats OE and kit contents as sets; OE preserves all
characters except surrounding whitespace. Blocker detection is recall against expected blockers,
with 1 for an empty expected set. This corrects the private import harness's stricter list-equality
metric without changing its original observations. Unexpected blockers remain in the private audit.
No-run cases score unavailable metrics zero. No-review cases use zero elapsed seconds as a sentinel,
not a claim of instant review. All twenty records validate against ProductAcceptanceResult.

## Browser review evidence

All eight exact imports reached Ready through **automated simulated** Gate 01 decisions. None is a
real human approval. One C and one D slot were rejected, revised using separately uploaded MOCK
packaging evidence, and approved; the other six needed no revision. Failed A/B imports were retained
for diagnosis and never promoted. A/B rejection/revision coverage is therefore still outstanding.

For all five successful image slots, the browser opened the original image in a new tab and verified
native image rendering, authenticated HTTP 200 and exact original byte hash. Attempting approval
without explicit image confirmation was rejected with state unchanged; the later simulated decision
recorded image confirmation. All three successful no-image slots displayed the no-image path and
had no source-image associations. Image bindings survived revision.

Automated review durations were 33, 11, 11, 18, 11, 15, 2 and 3 seconds. These are UI automation
measurements and cannot substantiate a human review-time target. Final database state, expected
facts, revision counts and approved/rejected decisions were independently checked.

## Failures retained for correction

- [#347](https://github.com/ban12-project/F-Trade-Platform/issues/347): eight full-field imports lost
  supported fields. A separate actual-model diagnostic captured human-readable kit labels where the
  domain contract requires enum values. Missing OE and boolean fields also occurred; their individual
  causes are not all proven by that diagnostic. No values were coerced or manually filled to pass.
- [#348](https://github.com/ban12-project/F-Trade-Platform/issues/348): two private CSV uploads left
  receipts but created no stream run. Both subsequent uncached reads returned valid, byte-exact CSVs.
  Two additional slots timed out during browser navigation before upload; neither has a receipt.
  The initial failure stage remains unknown; these later reads do not prove eventual consistency.
- [#346](https://github.com/ban12-project/F-Trade-Platform/issues/346): independent visual comparison
  of five original pages found 26 populated kit labels versus 19 discovered candidates (seven missing).
  The frozen page counts are 6/6, 5/6, 2/4, 2/5 and 4/5 discovered/expected. The earlier full-document
  no-loss regression was not a visual recall measurement. Manually preparing these CSVs does not fix
  the raw catalog parser.

## Cleanup and delivery

All 32 temporary private objects from this batch and its diagnostic were deleted; every subsequent
uncached private read returned null. Local append-only audit records and immutable failure artifacts
remain available. Original reference files were unchanged. Public records include only synthetic
slot IDs, metrics and workflow evidence, with no raw identifiers, source contents, credentials or URLs
to private objects.

No publication, external business message, formal quote, actual human approval or production deploy
occurred. Local delivery is still pending GitHub workflow-scope authentication, PR review/CI and squash
merge. This report neither changes the existing acceptance thresholds nor declares MVP1 complete.
