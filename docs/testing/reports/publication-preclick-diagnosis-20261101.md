# Publication preparation failure diagnosis — 2026-11-01

Issue #794. The executor stopped in preparation before requesting its internal
publication permit. The reconciliation code reported this as missing authorization,
which incorrectly suggested the human's publish confirmation was absent.

A read-only comparison against the same live audience picker returned false with
the original program and true with the corrected program. The observed native
radio label contains both `Public` and `Anyone on or off Facebook`. The previous
exact match against `Public` alone therefore never became ready. Private account
identifiers and page evidence remain outside the repository.

The page program accepts the exact observed complete Public label, as well as an
exact simple accessible name. It also resolves unique in-dialog aria-labelledby
references. It never accepts a prefix, missing/duplicate reference, or ambiguous
radio. Radio selection and clearing the default-audience checkbox are separate
steps, with a read of the updated DOM between them. Final audience, identity,
content, media and one-click guards remain mandatory.

The executor now distinguishes editor readiness and each audience transition.
Fixed stage/code enums travel through the authenticated finish request. Only
reconciliation's existing stopped/no-permit proof can attach an unsent failure
code. Retry still checks the reservation, receipt, stopped run, actor and record
identity; authorized/quarantined runs remain unknown and cannot retry. Old nodes
and old generic failures remain supported. Deploy the web contract before the
new Agent; no schema migration is required.

## Validation

- Browser tests cover the full observed label, exact ARIA references, missing and
  duplicate references, ambiguous options, asynchronous checkbox replacement,
  media resets, identity/content changes, and duplicate-send prevention.
- A dedicated migrated PostgreSQL regression verifies diagnostic/legacy/invalid
  diagnostics, authorized and quarantined reconciliation, and actual retry gates.
- The original broad publication PostgreSQL suite currently stops earlier at its
  stale fixture: it expects a content-version error before creating the required
  publishing-account binding. The same failure was reproduced on unchanged main
  (`90ebdd1`) in a separate checkout. That unrelated suite is not reported as passing.
- TypeScript, targeted Biome, Node syntax, adapter/setup regressions and repository
  validation passed for delivery. The production Turbopack build, including the
  project TypeScript CLI and all 56 static pages, also passed. Automatic validation CI remains paused under
  #711; deployment remains enabled.

The live comparison was read-only: no test post, uploaded media, changed default
privacy preference or real publication receipt is claimed by this verification.
