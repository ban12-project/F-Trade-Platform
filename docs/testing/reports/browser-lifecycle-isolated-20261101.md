# Isolated browser lifecycle checkpoint — 2026-11-01

Related: #480 and #675. Baseline: main `b190572`. The owner requested the
prioritized iteration, excluding parallel #760 work and retaining the pause
on real publications and DMs. Work used a separate clean checkout.

## #480: actual local gateway transport

The existing gateway suite uses actual loopback HTTP servers and WebSocket
upgrade sockets, with a synthetic one-use admission broker. It does not use
Facebook, a production database, account storage, a VNC server or Docker.

Added two regressions: deleting a live slot or replacing it with another
object under the same run ID must close the established old tunnel, deny its
assets, and prevent its websocket capability from reaching upstream again.
Both keep the original lease unexpired, distinguishing identity revocation
from the already-tested expiry and stopping paths.

The complete gateway suite passes 9/9. A temporary local ablation removing
only the slot-object identity check from `allowed()` causes both new cases
to fail because the old sockets stay open. The production file was restored
byte-for-byte; the ablation is not committed. The original seven cases also
cover websocket replay, wrong origin, expiry without Agent polling, revocation
during delayed upgrade, stopped-run assets, cross-slot origin binding and
replacement authorization with late old-socket callbacks.

## Evidence matrix and remaining scope

| Boundary | Current isolated evidence | Still not established |
| --- | --- | --- |
| Grant/credential revocation | Fleet tests reject renewal and claims after invalidation | Production user/session changes through the actual database/broker |
| Active tunnel retirement | Nine real loopback gateway cases, including new slot identity regressions | Exact deployed gateway/proxy/VNC behavior under production refusal/revocation |
| Stop and capacity | Node tests require engine-confirmed stop; fleet quarantines expired capacity | Every real provider shutdown/retirement condition |
| Native profile and account | Existing separate startup report records retained-profile UI use | Complete same-account identity/Messenger continuity and independent inbound acceptance |

`node --import tsx --test scripts/test-browser-fleet.mjs scripts/test-browser-node.mjs scripts/test-browser-fleet-protocol.ts scripts/test-browser-viewer.mjs`
passes 83 tests. `node --test scripts/test-browser-review-gateway.mjs` passes
9 tests. Frozen offline install and targeted Biome check pass. This improves
regression coverage, not a claim that a current production defect was repaired.
#480 remains open for the production evidence above.

## #675: network experiment preflight

The current `proxy-fail-closed.mjs` image fixture explicitly sets
`block_webrtc: true` in both its direct and failed-proxy branches. It proves
HTTP failed-proxy behavior with that setting; it cannot establish default
WebRTC UDP/STUN behavior required by #675. No production setting is changed.

The local Podman VM initially reported successful startup, then inspection
reported stopped and container API requests failed. A second diagnostic
startup reached a guest boot prompt and running state, but SSH returned EOF
and later inspection again reported stopped. These are local environment
observations, not an application startup or network-isolation failure. No
container/account profile was accessed in these attempts.

The next network proof must use a credential-free isolated browser and
controlled HTTP proxy plus STUN receiver. Establish a positive UDP control,
record packets received independently of ICE strings, compare proxy-up/down
and enforced network-policy cases, and record image/launcher identity. Keep
synthetic proxy behavior separate from the authorized actual proxy and actual
deployment policy; neither can silently substitute for the other. Do not
close #675 based on the existing HTTP test or an empty candidate list.

General automatic CI remains paused under #711. No publication, DM, login
factor, business approval or production configuration was changed.
