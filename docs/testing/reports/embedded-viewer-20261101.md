# Embedded Viewer diagnosis — 2026-11-01

Scope: #480, after the official Camoufox migration in #677. Existing profiles,
credentials and publication authorization are retained. No post or DM is sent.

## Observations

The controlled Chrome tab remained at `about:blank`; browser tooling reported a
paused document response. This was insufficient to attribute the user's blank
iframe solely to tooling. The owner corrected an earlier positive response:
their observed embedded view was still blank. No ordinary-browser pass is inferred
from the withdrawn response.

A separate Chrome window, operated through native UI and DevTools, loaded a
temporary, ticket-free iframe from the actual HTTPS gateway to its waiting state.
That diagnostic element was removed. The actual application iframe then loaded
but admission returned HTTP 403 after its task ended. The node logged an egress
navigation failure with HTTP 409. This differs from an observed wrong exit IP.
The official service's navigation route rejects concurrent work with 409; its
single-operation fence must remain intact.

The Agent previously sent login/page observations and heartbeat egress requests
concurrently. The egress module serialized only other egress checks, leaving
these competing operations outside that queue. A deterministic regression against
the actual runtime service reproduced a held observation plus navigation returning
409 instead of 200. This accounts for the observed early task termination and
subsequent denied Viewer ticket. The earlier tooling pause remains a separate
observation; this fix does not claim to repair the browser automation tool.

## Change and validation

The Agent now queues requests per task before HTTP dispatch. The eight-request
bound prevents unbounded backlog; different accounts remain independent. Queue
time consumes the existing request timeout. Abort and lease validity are checked
before dispatch and after completion. Failed or ambiguous operations reject their
already queued successors without dispatch or retry. An observer timeout does not
release ownership of still-pending work. Runtime concurrency, proxy, lease and
single-use-ticket checks remain enabled. Fixed diagnostic enums now preserve
`runtime_busy` and `operation_unknown` without retaining raw errors.

- Before fix: the actual-service contention regression failed with 409 versus 200.
- After fix: 81 targeted service, request-queue, egress, startup, Agent, Viewer and
  gateway cases passed, including timeout, cancellation, lease expiry, backlog
  bounds, cross-account independence and no-retry controls.
- Existing frontend Viewer suite: 9 passed.
- New frontend/gateway integration: 1 passed. It serves the actual HTML, CSP,
  Viewer module, one-use admission and capability-gated assets over loopback;
  only the desktop transport is synthetic. It does not claim real noVNC pixels.
- Biome and repository validation passed.

## Production embedded acceptance

PR #789 deployed as `52ccb4084f3b0f4d4a47cc58603db5517789935b`.
[Deployment run 41303879350](https://github.com/ban12-project/F-Trade-Platform/actions/runs/41303879350)
completed successfully and the VPS receipt reported READY. The healthy Agent
image was `sha256:48c6106899894e2f60de1d5b886232ee2217442783ef8063bd4c99cd6e627183`;
its selected browser image was
`sha256:208638ad62ad71827610b3bba521f9902c78d50a3e3799bf93c095b8d1425008`.

At approximately 11:57–12:00 UTC, an authenticated ordinary Chrome window,
operated through native UI, queued a fresh interactive task. Its actual embedded
HTTPS Viewer displayed the signed-in Messenger desktop and reported connected.
Opening and closing the account menu proved remote input. The existing automatic
identity/Messenger observer passed without requesting password, TOTP or PIN.
The empty inbox is not historical-decryption or DM-ingestion evidence.

The session remained active for more than two minutes across periodic egress
checks, with no new Agent egress-failure diagnostic. Fresh application-issued
authorization reconnected the embedded Viewer. Normal application release removed
the Viewer, and subsequent node inventory contained zero account browser
containers. Local screenshots remain private; no account identifiers, tickets,
credentials or profile contents are included here. No post or DM was sent.

This proves the renewed embedded connection, input, readiness, reconnection and
normal release path. It does not claim the entire production fault/revocation
matrix, credential-factor recovery or historical-message recovery. Earlier local
gateway denial/revocation evidence remains distinct from this live happy path.

## Registry verification

[Run 41300984838](https://github.com/ban12-project/F-Trade-Platform/actions/runs/41300984838)
at `5b24c6dca078868b99cb89b8a48f7e03d26da9b1` completed release validation,
native amd64/arm64 image publication and multi-architecture tag publication.
The subsequent #786
[run 41301349468](https://github.com/ban12-project/F-Trade-Platform/actions/runs/41301349468)
at `d048b5c27b7cb069a4dd4b582607285c419b7bcf` also completed all those stages.
These successful runs are distinct from publication of the present repair.

At the 12:01 UTC acceptance checkpoint, the repair's
[run 41303879356](https://github.com/ban12-project/F-Trade-Platform/actions/runs/41303879356)
had passed release validation; both native architecture publication jobs were
still running. The successful VPS rollout above does not imply this registry
run or its multi-architecture tags have finished.
