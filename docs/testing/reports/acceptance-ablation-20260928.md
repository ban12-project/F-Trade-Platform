# Issue/PR cleanup and control ablation — 2026-09-28

Related: #479, #32. Fixed production-source baseline: `a3d09b2130d5aaba9d5549c0b487802a846084e9`. This report records engineering experiments with synthetic inputs, not formal business acceptance. [Machine-readable observations, source/variant hashes and log hashes](acceptance-ablation-20260928.results.json).

## Cleanup before experiments

The open repository inventory contained 26 Issues and one PR. Every open item was checked against the current acceptance matrix; missing real evidence was retained explicitly.

| Items | Disposition and basis |
| --- | --- |
| #474 | Closed as repaired by #475; #478 proves final-artifact connection preservation, retirement, CI and deployment. Remaining production UI path transferred to #480. |
| #476 | Closed as repaired by #477; bounded-retry regressions, final artifacts and production postflight recorded in #478. Production UI follow-up remains #480. |
| #459 | Closed for the specific egress/configuration risk: #462 barriers and #470/#471/#478 policy, proxy, image, rollback and application-start evidence. Viewer end-to-end follow-up is #480; receipts remain separate. |
| #454 | Closed as `not_planned` administrative consolidation into #32; delivered reports preserved. This does not claim formal MVP completion. |
| #480 | Created to retain authenticated production queue → ticket → viewer → retirement acceptance. Historical ticket consumption and isolated synthetic broker are insufficient. |
| #415 / #378 | Retain independent draft PR/candidate issue. Added a current checkpoint without deleting historical failures. HTTP session/Agent handoff/revocation, compatibility/proxy and full-profile recovery gaps remain. No PR was merged merely to clear the list. |
| #463 | Retain missing original-file recovery and reconciliation. |
| #383 / #322 / #156 | Retain automatic video receipts and independent inbound DM/channel acceptance. |
| #332 / #414 / #423 | Retain broader managed runtime, durable profile and supported factor/recovery requirements; a single login result does not satisfy all of them. |
| #5 / #6 / #268 / #307 / #348 | Retain product/source authorization, original-file readback, catalog/OCR completeness and unreproduced CSV failure. |
| #246 / #126 / #318 | Retain governed video composition, authorized materials and platform-rule provenance. |
| #122 / #11 / #49 | Retain policy/owner/channel decisions and future API risk. #49 is not reinstated as an MVP prerequisite. |
| #391 | Retain physical-device/assistive-technology/performance acceptance. |
| #26 / #32 | Retain parent acceptance and pending Go/No-Go. #32 now links concrete remaining work and supersedes the duplicate execution tracker. |

This closes four existing Issues, retains the sole existing draft PR, and adds #479 for this experiment and #480 for the specific remaining production verification. The six-criterion business summary is unchanged.

## Reproduction and isolation

WSL rootless Podman used the existing locked Node 24.21.0 dependency image `sha256:7f9ac8fb9baf9ee53c4520732c338112faa99734fafb16af7fc4e9b132f2100b`. No dependency or lockfile was changed. Repository mounts were read-only during execution; production modules were copied into disposable temporary directories and their original hashes verified. No production DB, provider key, account profile or model call was used.

The browser experiment runs real Chromium against intercepted synthetic HTML under `--network none`. It executes the actual page program, runtime and login flow. The exact Agent promise-settlement block is extracted with unique anchors and invoked with a recording stop boundary, followed by the production idle policy. Observation sleep uses the flow's injected virtual clock. This measures decisions and bounded retries, **not** real-time latency, full Agent/container execution or a real WebSocket connection; those are separate #478 observations.

Run in the repository with Node 24 and the locked dependencies/installed Chromium:

```sh
REVIEW_REVISION=$(git rev-parse HEAD) node scripts/browser-login-ablation.mjs
node --import tsx scripts/run-product-safety-ablation.ts
REVIEW_REVISION=$(git rev-parse HEAD) node --import tsx scripts/browser-fleet-ablation.mjs
```

The actual local runs used the image above with `--network none`, a read-only Chromium cache, a read-only repository and a dedicated writable output mount. `REVIEW_OUTPUT_DIR` controls output for browser/fleet runners. The PostgreSQL experiment used an ephemeral `postgres:17-bookworm` container (17.11), `--network none`, tmpfs data, no published port, and a second container sharing only its loopback namespace. The repository's `scripts/browser-fleet-ablation-postgres.ts` refuses non-loopback/non-test database addresses. It ran with `--conditions=react-server --import tsx`, `BROWSER_FLEET_TEST_DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:5432/browser_fleet_test`, and a tmpfs repository `tmp` directory. Both containers were removed after success.

The new browser runner is included in the existing Playwright workflow, with JSON evidence uploaded even when a later step fails. Existing product/fleet runners remain unchanged.

## Browser login ablation

Five variants × four scenarios × three deterministic repetitions = 60 observed rows. A fresh browser context is used per row. Repetitions are consistency checks, not independent population samples. Each variant starts from the same source, and mutation anchors must match exactly once. The first four variants form a 2×2 experiment; task cleanup is a separate ablation.

| Variant | Already-ready input | Transient oversized bootstrap | Persistent oversized bootstrap | Late conflicting identity | Post-ready lifecycle |
| --- | --- | --- | --- | --- | --- |
| Full | ready, 1 read | ready, 2 reads | refused, 21 reads | refused, 2 reads | Connected/pending behavior preserved; idle and disconnect retirement allowed |
| Without ready preservation | ready, 1 | ready, 2 | refused, 21 | refused, 2 | Immediate completed stop despite successful login |
| Without observation repair | ready, 1 | refused, 1 | refused, 1 | refused, 1 | Clean ready is preserved; transient hydration cannot recover |
| Without both | ready, 1 | refused, 1 | refused, 1 | refused, 1 | Clean ready immediately stops; transient case fails earlier |
| Without task cleanup | ready, 1 | ready, 2 | refused, 21 | refused, 2 | Settled task remains set; idle/disconnect policy cannot retire the successful run |

All three repeats matched this table. Credential claims and submissions were zero throughout. Persistent overflow and conflicting identity never became ready. Removing one fix does not reproduce every symptom: observation readiness and interactive lifetime are separate outcomes. The combined variant masks the lifetime issue on transient input because observation fails first; the clean-ready positive control reveals it.

The complete implementation passed on the first functional run (60 rows); subsequent metadata/formatting and pending-viewer assertion rechecks each passed 60 rows. A Biome callback-return diagnostic was corrected with a block body; no production behavior changed. Initial and final result hashes are preserved.

## Product safety controls

The existing runner exercises the production product draft/evidence and approval functions. Ten fixed records are reused across four variants; two are valid and eight unsafe. All variants accepted both valid records.

| Variant | Unsafe accepted / 8 |
| --- | --- |
| Full controls | 0 |
| Without field/source-location check | 2 |
| Without human-actor check | 2 |
| Without both | 6 |

The combined removal additionally admits records with both defects. Unknown evidence and invented OE retain independent guards. This is source-control causality on synthetic records, not a measured real-model factual error rate or permission to skip formal business approvals.

## Fleet, gateway and PostgreSQL controls

Across 30 deterministic workload permutations, the full fleet baseline violated none of the tested invariants. Removing each of capacity, configured memory, current free memory, same-account exclusion, claim idempotency, unconfirmed-stop quarantine, credential version, account revocation, priority aging, installation binding or credential AAD protection violated its targeted invariant in all 30 trials. Removing only the poll fast path caused **zero** violations in this workload: downstream controls still protected it. This is a limited equivalence result, not proof the fast path can be deleted globally.

Real loopback HTTP/WebSocket tests: full gateway 5/5; removing Origin checks caused the wrong-Origin test to fail (4/5); removing active-tunnel expiry caused expiry and stopped-run socket tests to fail (3/5). These expected mutant failures were retained rather than relabeled as product failures.

Actual migrated PostgreSQL/production broker, three forced-overlap repetitions:

| Variant | Requests | Configured slots | Leases issued | Unique jobs | Duplicate deliveries |
| --- | --- | --- | --- | --- | --- |
| Full row lock | 8 | 2 | 2 | 2 | 0 |
| Without row lock | 8 | 2 | 8 | 1 | 7 |

All three pairs matched. Migration columns, outsider/installation rejection, retry lease reuse, one-use interactive tickets, revocation heartbeat fencing and the legacy disable/owner barrier also passed. The synchronization barrier deliberately forces an adverse interleaving; 7/8 duplicates is **not** a production incidence estimate.

The first fleet container attempt failed before experiment execution because the dependency image lacks `git`. The runner already supports `REVIEW_REVISION`; passing the independently read exact baseline SHA resolved setup without modifying the runner or inventing a revision. Both logs are hashed in the result index.

## Interpretation and remaining work

The measured controls prevent distinct failures. Keep ready preservation, settled-task cleanup, bounded structured observation, source-location/human checks, row locks and gateway authorization/expiry. No production control is removed by this PR, and no new runtime feature flag exists. The one equivalent fast-path experiment warrants only its narrow result.

Issue cleanup and synthetic causal evidence do not supply missing factory originals, independent inbound messages, current per-post authority, physical-device results, production UI session evidence or formal business decisions. #32 remains pending and #480 remains unverified.
