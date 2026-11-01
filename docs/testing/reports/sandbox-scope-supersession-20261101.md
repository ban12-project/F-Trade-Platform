# Sandbox migration scope superseded — 2026-11-01

Issue #332 requested moving the browser worker from VPS to Vercel Sandbox.
Its latest body still describes the October 15 Sandbox checkpoint. That is
historical evidence, not the current runtime target.

The owner-authorized dedicated VPS migration #722, delivered by #723, supersedes
that provider choice. The [VPS compute report](vps-compute-20261101.md) records
production integration and the then-observed removal of named Sandbox instances,
active snapshots and VCR repositories. Those observations are not a new resource
inventory or a guarantee about the present cloud account.

Current main `be08826` independently corroborates the architectural boundary:

- `ownerBrowserCommand` rejects `create-sandbox` before creating a node.
- `provisionBrowserSandbox` always calls `rejectRetiredSandboxExecution`, even
  when a provider is injected. Existing flags cannot restore provisioning.
- `vercel.json` retains the video-retention cron only; no browser cloud dispatch
  cron is scheduled.
- #769 migrated the submission regression to normal VPS registration and real
  node recover/claim handlers. Its isolated PostgreSQL negative control confirms
  retired creation is rejected; queued publication remains durable without a
  Sandbox row or cloud-start outbox.

The [VPS image-chain report](vps-smoke-chain-runtime-20261101.md) records isolated
native-profile persistence, nonextractable keys, replacement-container recovery,
cross-account rejection and viewer dimensions. The later
[live startup report](native-profile-live-startup-20261101.md) separately proves
normal production UI startup on the accepted image, an actual rendered viewer,
retained profile and normal release. It explicitly does not prove a fresh empty
production volume or independently verified current account identity.

## Disposition and retained requirements

Close #332 as **not planned / superseded**, not as fully passed. Continuing to
require Sandbox VM or template acceptance would revive a retired provider. Do
not remove or check off the historical account/business criteria; their current
owners remain open:

| Remaining requirement | Tracking |
| --- | --- |
| Production viewer refusal/revocation and complete retirement matrix | #480 |
| Account/profile continuity, Messenger history and actual inbound persistence | #414, #322, #156 |
| Bounded password/supported 2FA/PIN recovery and current page rules | #423 |
| Proxy/GeoIP, DNS, IPv6 and deployed packet attribution | #675 |
| Historical intermittent browser startup cause | #674 |
| Actual controlled publication and attributable automatic receipt | #383 |
| Formal MVP1 acceptance and human Go/No-Go | #32 |

The [isolated lifecycle tests](browser-lifecycle-isolated-20261101.md) and
[isolated STUN tests](browser-stun-isolated-20261101.md) remain narrower evidence,
not replacements for those production gates. Real publication and DM remain
paused. This reconciliation changes no runtime, credentials, profiles, channel
permissions or business state, and does not authorize new external actions.

Validation: the current VPS restore-inventory and fail-closed inspection-origin
regression passed; full repository validation and Markdown link checks passed.
The migration and live-startup reports are present in merged main (#723/#748/#751).
No live environment was accessed for this documentation reconciliation.
