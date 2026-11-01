# Open issue review — 2026-11-01

Reviewed all 25 open issues and their comments against main `2321d02`, merged
delivery reports and current scope decisions. This is engineering reconciliation,
not a new business acceptance batch. The owner confirmed #760 is being handled
in another chat; its uncommitted work was preserved in the original checkout.

## Completed viewer repair: #627

The original four acceptance conditions have engineering evidence:

| Condition | Evidence |
| --- | --- |
| Lost readiness recovers; admission remains single-use | Merged #628; current `test-browser-viewer.mjs` exercises late parent readiness, duplicate ticket delivery and one admission. |
| Bounded failure and authenticated status | Current gateway tests reject wrong origin/source, timeout, rejected admission, module/security failure and page close. No automatic reauthorization. |
| Isolated connection, expiry and actual input/rendering | [Rollout report](sandbox-viewer-rollout-20261022.md) records native noVNC keyboard/mouse input after fitting an oversized saved window, production-build cases, and subsequent top-level transport delivery #635/#637/#638. Current browser tests cover missing first readiness, bounded stalled iframe, source spoofing, independent-window admission/closure, popup blocking and delayed authorization. |
| Preserve profile and audit boundaries | Rollout protected all existing account volumes and node state with matching before/after digests; current native-profile regressions preserve ownership, leases, first-use refusal and saved profile while fitting geometry. |

PR #628 is independently confirmed merged as
`aa9f83ace705c098c125f6e6c94b8bb23418aa82`; its applicable build, repository,
PostgreSQL, Harbor, browser and both image-architecture checks succeeded.
Later real transport observations support delivery but are not required to
invent account readiness. The original #627 asks for isolated engineering
verification; whole production lifecycle and account acceptance remain #480,
#414 and #423. Close #627 after merging this reconciliation. Do not reopen it
merely because those broader conditions remain incomplete.

## Disposition of every remaining issue

| Issue | Disposition and remaining condition |
| --- | --- |
| #760 | Active in another chat, explicitly excluded by owner. |
| #677 | Unselected launcher replacement proposal; draft #678 is not an approved production migration. Do not merge or cut over. |
| #675 | Version restoration and rollout delivered; original packet-level UDP/STUN attribution is still missing. HTTP exit / ICE matching is narrower evidence. |
| #674 | Current retained-profile startup passed in #751, but historical intermittent prewarm failures remain unexplained. Preserve incident observations; no blind live retries. |
| #667 | Account-owner credential/recovery control remains unverified; local runtime credential rotation #749 is a different secret and does not resolve this risk. |
| #664 | Original intermittent draft loss is unexplained; full suite and ten diagnostic passes already recorded. Capture a failing trace on recurrence instead of repeating passing runs or weakening assertions. |
| #623 | Community automation decision remains deferred; explicit scope and applicable permissions are missing. |
| #498 | Fresh production audit: 0 critical / 0 high / 1 moderate / 1 low. Minimatch and deepmerge remain version matches; current patches and scoped reachability evidence are not an upstream fix for every consumer. |
| #480 | Normal viewer/start/stop evidence exists; full production refusal/revocation and retirement matrix remains incomplete. |
| #423 | Saved-session recovery does not prove actual password / supported 2FA / PIN recovery. Do not reset a live session merely to create that test. |
| #414 | Native storage continuity is delivered; complete same-account online restart/recovery and independent inbound persistence/deduplication evidence is still missing. Real DM remains deferred. |
| #391 | Physical devices and VoiceOver/NVDA remain unverified; full-page visual contrast and conditional production performance evidence are also incomplete. Browser zoom was removed from scope, not passed. |
| #383 | Actual application publication and durable receipt remain deferred; do not publish to close an engineering housekeeping task. |
| #348 | Response-to-log diagnostics delivered; historical intermittent pre-run intake cause remains unproven. No reproduced current defect supports another speculative retry change. |
| #332 | Sandbox implementation and isolated migration evidence exist. Its broader online account and transport acceptance is not established by the later VPS startup report. |
| #322 | Worker / signed ingress implementation exists; original “verified gaps” describe the old baseline. Current real publication / incoming-message acceptance remains deferred. |
| #318 | Current rule applicability to selected Personal Profile path and platform acceptance remain unknown. Page API rules cannot substitute. |
| #156 | Aggregate controlled publication and independent inbound acceptance remains deferred. Local simulated sales is separate. |
| #126 | Real composition / private download / project export checks delivered; target-account rule applicability and actual platform acceptance remain #318/#156. |
| #122 | PITR removed by ADR 0011. Retention/deletion and remaining copy evidence still apply; the latest named-branch checkpoint had no naturally 90-day-expired sample, and did not freshly establish deployed endpoint binding. |
| #49 | Official Business/API route is future scope, not a requirement to complete the selected browser experiment. Leave its eligibility risk open. |
| #32 | Final human Go/No-Go pending. Apply the newer scope changes below instead of historical unmet-condition lists; restore automatic CI before final acceptance. |
| #26 | Local simulated sales through OPPORTUNITY delivered in #753. Final integrated acceptance / human decision remains pending; no genuine customer or external-message evidence is implied. |
| #11 | Channel choice is made; accountable actual publishing/inbound path acceptance remains incomplete. Do not repeat channel selection or claim both transport routes are required. |

## Current scope corrections

- [ADR 0011](../../decisions/0011-remove-pitr-acceptance.md) removes PITR and
  restore-specific acceptance from MVP1. This is not a pass or a deferred task.
- #752 / #391 remove browser zoom acceptance; physical-device and assistive
  technology requirements remain.
- [Simulated DM sales](simulated-dm-sales-20261101.md), delivered by #753,
  establishes the authorized local downstream flow. Do not keep demanding a
  real incoming DM as a prerequisite for that already-completed simulation.
- [Current retained-profile startup](native-profile-live-startup-20261101.md)
  supersedes claims that no working viewer/startup has ever been observed.
  It does not independently establish account identity or all historical causes.
- [Latest retention checkpoint](m2-neon-retention-checkpoint-20261101.md)
  supersedes the old Free-plan observation for the inspected named branch;
  its endpoint-binding and deletion limitations remain explicit.

## Local verification

- Frozen offline install in an isolated worktree: passed; lockfile unchanged.
- `node --import tsx --test scripts/test-browser-viewer.mjs scripts/test-native-profile.mjs`:
  19 passed, no failures.
- `node scripts/test-deepmerge-security.mjs`: 4 passed.
- `node scripts/test-braces-depth-guard.mjs`: 6 passed.
- `PLAYWRIGHT_PORT=3137 pnpm exec playwright test tests/e2e/browser-viewer.spec.ts --workers=1 --reporter=line`:
  test-enabled production build and all 9 Chromium cases passed in 57.3 seconds,
  without retries. Only synthetic fixtures and the isolated non-routable test
  database setting were used. Build retained the existing warning about an
  unspecified `partialPrefetching` option; no compiler/cache setting changed.
- `pnpm audit --prod --json`: exit 1 for the two retained advisories above.
  This is an observed residual risk, not a passing security audit. Existing
  [minimatch call-site review](shadcn-zod4-security-20261101.md) explains the
  scoped default-option paths; a major-version override is not presumed compatible.

No source behavior, dependencies, production settings, account profiles,
business approvals, publications or messages changed. General automatic CI
remains paused per #711; this report does not constitute final MVP acceptance.
