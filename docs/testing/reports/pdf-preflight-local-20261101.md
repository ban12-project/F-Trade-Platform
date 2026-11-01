# Local catalog preflight restoration — 2026-11-01

Issue #767. Untouched main `9a5500b` reproduced `Catalog Product Agent failed:
Invalid URL` in `scripts/test-pdf-catalog-preflight.ts`. The VPS migration made
`vpsComputeEnabled()` always true for the supported provider; the existing local
conversion branch became unreachable, including the documented CLI preflight.
The fixture intentionally has no VPS configuration.

The catalog CLI now explicitly selects local conversion only for `--preflight`.
The domain function defaults to VPS and accepts the trusted execution choice
separately from document input. Application upload/workflow callers are unchanged;
normal catalog extraction still uses VPS. No retired provider or environment-based
fallback is enabled. Both paths retain shared file limits and conversion validation.

Validation:

- Actual synthetic PDF CLI regression passed: two duplicate-identifier records,
  recovered physical page 1, distinct record IDs, manual-review status and no
  source text/OE values in the report. Remote origin/token are explicitly empty.
- New normal-CLI negative control passed with missing VPS configuration and an
  unusable local Python path: failure occurs at remote configuration, no report.
- Catalog preflight/report, partial-failure and concurrent-report protection tests
  passed. VPS client tests passed, including invalid-provider rejection,
  capacity-only retry and no ambiguous-create retry.
- TypeScript check passed. Targeted Biome check passed with five pre-existing
  non-null-assertion warnings in the catalog CLI. `git diff --check` passed.

Local environment observations: initial Python lacked pdfminer. Installing the
entire development requirements under local Python 3.14 failed because its
onnxruntime dependency had no matching distribution. The declared pdfplumber
0.11.10 and its dependencies then installed successfully in an isolated venv;
this is sufficient for the actual native PDF path used here. No requirements or
lockfile were weakened. CI retains its Python 3.12 full-dependency installation.
These checks use synthetic files only; no production request, real document,
model invocation or business write was made.
