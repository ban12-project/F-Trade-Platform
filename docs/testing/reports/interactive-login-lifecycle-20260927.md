# Interactive takeover after saved-login readiness — 2026-09-27

Related: #474. Baseline application: `f9a1a813dc244cc05d78dd7207d15e41ac34169a`. Runtime source: `b29c3e6`. No credentials, account identifiers or business payloads are included.

## Failure evidence

A production interactive run recorded these UTC events on September 27:

| Event | Time | Meaning |
| --- | --- | --- |
| Lease claimed | 15:11:01.136 | Worker started the run |
| `browser_interactive.connected` | 15:11:24.549 | Broker consumed admission; this does not prove a VNC connection |
| `browser_credentials.login_ready` | 15:11:26.453 | Saved session observation succeeded, without credential claim |
| Lease stopped | 15:11:28.430 | Runtime ended immediately after readiness |

The v2 automatic login policy converted `ready` into `completed`, causing the Agent to close the gateway and container while a viewer could still be loading. A new regression failed against the baseline (`completed` where no stop was expected). This explains premature termination; the generic viewer error alone does not identify its precise failing network request.

## Change

A successful v2 observation leaves the interactive run available. The settled login task is cleared so the existing idle/disconnect grace can retire unused sessions. Existing explicit stop, revocation, lease deadlines and unknown-result failure behavior remain enforced. The broker's saved result prevents a successful observation from claiming credentials again.

## Verification

- WSL Podman, Node 24, pinned project dependency image: 69 browser-node/fleet tests passed; 28 related egress, protocol, native-profile and review gateway/lease tests passed.
- TypeScript check passed with `--noEmit --incremental false` in the same Podman environment.
- First combined test invocation omitted the repository's `tsx` loader and failed module resolution. Retest used the CI loader and passed; dependency versions and lockfile were unchanged.
- Baseline actual browser and Agent gateway images connected locally using synthetic admission.
- An isolated deny-all Sandbox using the same baseline images connected through its external TLS endpoint, with credentials omitted, and through a sandboxed cross-origin iframe using the actual viewer module. The iframe recorded a successful connection and no browser errors. These fixtures used an ephemeral browser profile, synthetic tickets and no production broker.
- These gateway tests establish transport behavior; they do not replace the lifecycle regression or a final updated-image production observation.

## Remaining acceptance

CI, traceable image publication, isolated updated-image verification and production postflight remain required. Do not close #474 solely on unit tests. Publication and inbox remain disabled for this work. A production observation must record admission, actual viewer connection where observable, readiness, and subsequent intended retirement independently.
