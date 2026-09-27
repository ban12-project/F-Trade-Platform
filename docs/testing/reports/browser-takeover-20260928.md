# Browser takeover verification — 2026-09-28 (Asia/Shanghai)

Classification: sanitized engineering evidence. Related: #472, #474, #476, #453, #414, #423, #32. No account identifiers, profile contents, credentials, tickets, proxy addresses or business messages are included.

## Failures, changes and boundaries

The earlier status-500 fix (#473, `f9a1a81`) remains separate from the premature unauthorized/expired viewer. Production audit for the latter showed lease claim at 15:11:01 UTC, admission consumed at 15:11:24, login ready at 15:11:26 and stop at 15:11:28 on September 27. Admission consumption alone is not proof that VNC connected.

PR #475 (`59d7abb3a184cea68f4a2f627c1f198adbf4a4cf`) keeps an interactive run alive after automatic login observation becomes ready and clears settled login tasks. The published baseline finished three milliseconds after readiness in the actual-entrypoint local fixture; the fixed published Agent followed the existing idle timeout. The 69 + 28 targeted regressions and type checking passed. See [first failure and lifecycle repair](interactive-login-lifecycle-20260927.md).

Two isolated runs then exposed a second defect: an observation exception produced scalar `refused`, skipping existing bounded retries. Diagnostic-only derivatives identified `identity_limit`; the exact bound exceeded in the original failure remains unknown. PR #477 (`efe07e0bd1d6728cbb41d017e85e1140665df138`) returns an explicitly unverified invalid observation and preserves all limits. All three new browser regressions failed before the change, then all 29 automatic-login browser tests and type checking passed in WSL Podman. See [hydration evidence](messenger-observation-hydration-20260928.md). Instrumented images and accelerated timers do not count as acceptance artifacts.

Both PRs passed seven PR checks before squash merge. The final main revision passed production build, repository validation, Playwright and both architecture image publication workflows.

## Final artifact identity

Both published images use revision `efe07e0bd1d6728cbb41d017e85e1140665df138`.

| Artifact | Registry digest | Verified Sandbox Docker image |
| --- | --- | --- |
| browser-node | `sha256:bb2e441aad662d7835faa611058930aa0983df974ff2891e64372826cf120d15` | `sha256:13fa9d4a9f50fc629b0afd2ea292f92d38ca93414764bd2aad9499f73c63f2a6` |
| browser | `sha256:ae34f7b42a684b9d66f4395861e23caf6d8b0a27ffafbba63dc0d3d69cce6c55` | `sha256:777c260aaf3335d4e027f13b9becc730e183ba837370927c6af80dc13741196c` |

OCI repacking changes local image identity. Original config digest, revision and every uncompressed layer were verified (9 Agent layers, 28 browser layers); comparison was not based on a mutable tag. Initial archive-format and reference-index lookup preparation errors were retained privately, corrected and followed by explicit hash verification.

## Local and isolated verification

WSL Podman ran the actual final Agent entrypoint, native browser and viewer gateway. The synthetic lifecycle remained alive until its configured timeout; VNC connected and generated H.264 media decoded. The direct-page local fixture is not the production iframe proof.

The same artifacts in the isolated Sandbox decoded the H.264 fixture. Browser cgroup peak was 148/512 PIDs and 859,516,928/2,147,483,648 bytes; PID exhaustion and all OOM events were zero.

The online test used a copy of the latest existing account snapshot, its existing proxy, and a synthetic broker boundary with normal heartbeat intervals. Actual profile scope, expected identity, origin, fixed egress and Messenger readiness were checked. The real viewer script ran inside an iframe with `allow-scripts allow-same-origin` and TLS/WSS. This exercised the published runtime and viewer, but did not create a production application queue job.

First final-artifact run: ready at `2026-09-27T16:38:18.957Z`, actual viewer connected without errors and remained connected for 75 seconds. After the client closed, the Agent completed once, 140,665 ms after runtime readiness and 127,790 ms after login observation. Credential claims and factor submissions were zero.


Second final-artifact run, after a complete Sandbox stop/snapshot/resume: ready at `2026-09-27T16:47:50.162Z`; actual iframe connected for another 75 seconds with no errors. The Agent completed once after client disconnection, 128,004 ms after runtime readiness and 118,272 ms after observation. Credential claims and factor submissions remained zero. The native profile and verified image pair persisted across restart.

## Remaining acceptance boundary

The desktop browser-control tool cannot initialize in this WSL task (`sandboxCwd is not a local file URI`). No app session was fabricated or borrowed. Authenticated production UI queue → ticket → iframe has therefore not been independently driven in this turn; isolation evidence must not be relabeled as that result.

Runtime improvements do not establish automatic video receipts, inbound DM persistence/deduplication, factory facts, original-file availability or business Gates. Unknown publications were not retried. The [new aggregate summary](mvp1-acceptance-20260928.summary.json) retains six `not_run` criteria and a pending decision. Zero business metrics mean no formal business samples, not zero defects across untested work.

## Production configuration and rollback

After successful final-artifact observation, the existing observe-only profile received a new two-hour review under the owner's explicit test/self-verification authorization. It expires at `2026-09-27T18:47:50.162Z`; readiness does not grant indefinite review validity. Publishing and inbox remain disabled.

Before mutation, a read-only broker transaction found the bound Sandbox stopped, no session/operation and zero queued/running/stopping/quarantined runs. A separate deny-all stopped rollback snapshot preserved the original production snapshot. The initial promotion attempt failed its stopped-snapshot precondition without writing intent or changing production; a fresh read confirmed all three snapshots stopped and the original unchanged, then the guarded promotion succeeded.

The original Sandbox name and account binding were preserved; its selected snapshot now contains the verified final Agent/browser pair. Both Vercel image IDs were updated and read back exactly. The network-policy variable is sensitive and cannot be exported by Vercel; the first combined local environment check therefore failed with the policy absent, not a proven policy change. Metadata shows that variable was not updated during this rollout. SDK readback confirms the actual Sandbox policy exactly matches the previous proxy/app-domain restriction.

Postflight at `2026-09-27T16:52:55.404Z` confirmed production stopped on the selected snapshot, policy unchanged, and both verification and independent rollback copies stopped/deny-all. Rollback requires restoring the preserved original snapshot plus both previous image IDs and redeploying; exact private identifiers are held outside GitHub. Snapshot retention is seven days.

A redeploy CLI invocation using unsupported `--prod` was rejected before deployment; it was corrected to `--target production`. No local working-tree application build was uploaded. The prior ready application deployment at `efe07e0` returned no matching 500 entries in a one-hour filtered log query. Empty logs are not evidence of a fresh authenticated request succeeding.

The corrected redeploy completed: `dpl_3dAxYJuFyT4t4Z3VTc5hwY25pe4g` is READY, targets production at `efe07e0bd1d6728cbb41d017e85e1140665df138`, and has `ftp.ban12.com` assigned. An unauthenticated browser-page request returned HTTP 307 (authentication redirect); it is not counted as an authenticated queue success.
