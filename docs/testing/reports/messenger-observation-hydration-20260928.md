# Messenger observation during hydration — 2026-09-28 (Asia/Shanghai)

Related: #476, #474, #475. Application/Agent baseline: `59d7abb3a184cea68f4a2f627c1f198adbf4a4cf`; isolated browser baseline: `b29c3e6`.

## Evidence and limits

Two published-artifact runs in an isolated copy of the latest authorized account snapshot passed egress and runtime/profile scope checks but refused the initial login observation. Runtime promotion was withheld. An instrumented browser derivative subsequently identified `identity_limit` while the page moved through identity-verified Messenger/loading states. Other diagnostic runs reached ready. Successful observations contained 99 JSON scripts, approximately 2.1 MB of text and approximately 20,000 visited nodes.

The exact counter that exceeded its bound in the first failure was not captured. Later successful counts do not identify that counter. Instrumented derivatives and a later accelerated-poll diagnostic are separate from acceptance artifacts. No passwords or factors were claimed/submitted, and no messages or publications were sent. Raw account/page content is not part of this report.

Source inspection found a concrete contract defect: the page program's exception handler returns scalar `refused` for an observation. The login flow expects structured observations and consequently skips its existing bounded read retries. A transient synthetic bootstrap payload exceeding the text limit reproduces immediate refusal even though the next observation would be ready.

## Change and regression

Observation exceptions now return an explicitly unverified `invalid` state with the current origin check. Existing bounded retries can wait for hydration. All script/text/node/depth limits, identity conflict rejection, deadlines and submission outcomes remain unchanged. Persistent invalid observations still terminate; readiness still requires positively verified identity and restored Messenger state.

Three browser regressions failed on the baseline and then passed:

- Temporary oversized bootstrap data clears: two observations, ready, no credential claim or submission.
- Oversized data persists: 21 observations, refused, no credential claim or submission.
- Data clears but exposes conflicting identity: two observations, refused, no credential claim or submission.

WSL Podman used Node 24 and the existing locked dependency image. All 29 automatic-login browser tests passed. Type checking initially caught an optional test packet; the fixture was corrected to reject absent packets explicitly, and the full TypeScript recheck passed.

## Delivery boundary

Published-image verification and production postflight remain required. #475's published Agent independently passed its actual-entrypoint local lifecycle regression, but its production runtime promotion remains coupled to this browser correction. A diagnostic-only ready result does not satisfy that gate. The production application was deployed at 59d7abb; the previous runtime configuration and independent rollback snapshots remain intact.
