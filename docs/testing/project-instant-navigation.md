# Project workspace instant navigation — #319

Verified locally on 2026-09-05 using Next.js and @next/playwright 16.3.2,
Turbopack production builds, and an isolated synthetic PostgreSQL database.
See [the reproducible rig](../../instant-nav.rig.md).

## Result

`/workspace/[projectId]` now renders the real return control, human-confirmation
badge, header and responsive navigation/panel layout before project reads finish.
Project title/status, members, stage selection, tasks and details stream into
separate boundaries. Title and members no longer wait for default-stage analysis.
Session and project membership checks remain prerequisites for every data slot;
React.cache deduplicates only within a request. No persistent authorization cache.

The route opts into Partial Prefetching with `export const prefetch = "partial"`.
Without that opt-in, a mobile Link navigation could retain the parent workspace
loading screen despite the improved direct-load shell. The workspace link audit
found no explicit full-prefetch links to this destination. Other routes keep their
current behavior; broader Partial Prefetching adoption is outside this change.

## Differential evidence

| Production-build run | Result |
| --- | --- |
| Original page, unlocked direct loads and actual Link clicks | 4 passed: 1280×800 and 390×844 |
| Original page, dynamic content gated with instant() | 4 failed: real return control absent |
| Refactored page, route Partial Prefetching enabled | 4 passed |
| Restore only original page, project-workspace and loading components; keep tests/config | 4 locked tests failed; 4 unlocked baselines and 2 access/error probes passed |
| Reapply fix; delete temporary baseline/error probes; full database-browser suite | 8 passed, including all 4 instant tests and product/sales Server Action workflows |

The initial failure and restored-original failure both reported
`getByTestId('project-back-link'): element(s) not found` under the lock.
The original component carries the same test marker during both comparisons.
There are no artificial delays, hover warming, timing thresholds or retries.
The final tests assert the destination URL for Link navigation, require visible
real UI while the project title is absent, and check it appears after release.
Direct loads are reloaded after release to obtain an unlocked document.

## Visual and behavioral parity

The unlocked full-page screenshots are pixel-identical before and after:
1280×916 and 390×1436, zero changed RGB pixels at both widths. Existing stage
order, forms, status, member controls and panel layout are retained. The tests
also verify no horizontal document overflow, and that the return control keeps
its DOM identity and focus while data streams. Existing database-browser tests
passed the product/content review and RFQ → quotation → delivery → follow-up →
opportunity workflows through real Server Actions.

Unauthenticated and invalid-session requests still redirect to `/auth` without
project data. A nonexistent project throws at the membership check before the
page's `notFound()` branch; this was reproduced on the original implementation
and recorded separately as [risk #320](https://github.com/ban12-project/F-Trade-Platform/issues/320).
This change preserves that existing behavior rather than weakening access checks.

## Loading shell screenshots

These contain only synthetic fixtures. Project data is deliberately gated.

| Width | Before | After |
| --- | --- | --- |
| Desktop | [Original shell](artifacts/project-instant/before-desktop.png) | [Usable header and shared layout](artifacts/project-instant/after-desktop.png) |
| Mobile | [Original shell](artifacts/project-instant/before-mobile.png) | [Usable header and shared layout](artifacts/project-instant/after-mobile.png) |

This proves shell availability, not a production latency percentile or faster
database queries. Live data remains fresh and authorization remains request-bound.

## Additional checks

- TypeScript 7 local CLI check and Biome CI check passed (existing lint warnings remain).
- Workspace stage/default/legacy-link and scoped-query regression checks passed.
- Development runtime inspection used the `next-dev-loop` browser session with
  React DevTools: the target route rendered; Next.js `get_compilation_issues`
  returned no issues and `get_errors` returned empty config/session errors.
  This inspection supplements, and does not replace, the production-build checks.
