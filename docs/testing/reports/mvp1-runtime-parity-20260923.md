# MVP1 Firefox runtime parity checkpoint — 2026-09-23

Issue #414; branch `codex/414-sandbox-profile-parity`. This is a runtime gate, not production acceptance.

The managed Sandbox compose file now forwards `BROWSER_NATIVE_PROFILES`, defaulting to `0`. A persistent, operator-owned `native-profile.enabled` marker explicitly opts in after account-volume migration; malformed markers abort startup. The Agent already checks the image's native-profile label, and a missing account manifest prevents a fresh-profile fallback. The browser container now states `PROXY_PROTOCOL=http` explicitly; the pinned Camofox default was already HTTP. This removes an implicit dependency on that upstream default. Neither change enables a production account by itself.

The native-profile runtime fixture now starts Firefox with the same capability drop, no-new-privileges, memory, CPU and PID limits as `containerSpec`. This test still uses a synthetic account and `--network none`; it cannot prove the approved proxy, Facebook login, or Messenger history.

Local Podman differential with the reviewed image `localhost/ftrade-browser:session-parity`:

| Synthetic configuration | Result |
| --- | --- |
| Previous fixture constraints | Write, task reuse, container replacement and read all passed |
| `no-new-privileges` only | Same fixture passed |
| `cap-drop ALL` without no-new-privileges | First `/start` returned HTTP 500 |
| `cap-drop ALL` with no-new-privileges | First `/start` returned HTTP 500 |
| `cap-drop ALL` plus SETUID/SETGID and no-new-privileges | First `/start` returned HTTP 500 |

Private synthetic diagnostics for the combined constraints recorded repeated `uid_map: EPERM`, child exit on signal 11, and `native_profile_launch_timeout`. The same strict synthetic fixture **passed in actual Docker** on both amd64 and arm64 in PR #426's first image run, while failing on local Podman. This supports treating the local result as a runtime-engine difference; it does not prove Vercel Sandbox or the real account. The failed runs were on isolated synthetic volumes. The existing real-account profile was not opened or modified. No Firefox sandbox setting or production capability policy was weakened.

The managed compatibility hook now disables `media.peerconnection.enabled` for the MVP1 text-only browser, preventing WebRTC from opening a separate direct path around the HTTP proxy. This behavior is covered by the launch-hook unit test and a real Firefox profile preference check in the image smoke test. A separate synthetic browser test proves that Firefox can reach an isolated target directly, then configures an unavailable HTTP proxy and verifies navigation fails with zero requests reaching that same target. This negative test passed locally and is wired into both Docker image jobs. It does not yet prove every protocol or the Vercel Sandbox network path; those remain live acceptance gates.

PR #426's image, repository, synthetic, PostgreSQL, Playwright and production-build checks passed at `11f4300`, including the negative proxy test on Docker amd64 and arm64. This is still a synthetic runtime gate.

The 5-minute dispatcher now checks due inbox polls as well as queued publications. A stopped node records a single durable start only when its account is ready, a reviewed inbox scope is current, the binding and inbound channel are active, and polling is enabled. The provider-dispatch and credential-release paths repeat the authorization check. A PostgreSQL regression covers concurrent scheduler calls, missing/revoked review, paused channel and a single provider claim. The existing Chromium-to-inbox-to-database round trip and publication/receipt tests also passed on a dedicated synthetic database. No real DM message was read in this test.

Local Podman real-account attempts uncovered another environment divergence: the Podman VM clock drifted tens of minutes behind the host. Short browser leases then appeared expired before a claim, so those failures are not evidence that the saved Facebook profile logged out. The same profile was retained; repeated clean logins were stopped. This time-sensitive acceptance must run with a stable clock in the actual Vercel Sandbox.

## Vercel Sandbox acceptance checkpoint — 2026-09-24

An isolated fork, `ftrade-mvp1-acceptance-20260924`, was created from the stopped production Sandbox snapshot. The source Sandbox was not restarted or changed. The fork retained the production account Docker volume and restricted Sandbox network policy. The original volume contained legacy JSON browser state but no native Firefox profile. The fork alone received the opt-in marker and the previously approved proxy. No proxy credentials, Facebook credentials, PIN, cookies, or message contents were copied into this report.

The fork's cached browser base had drifted from the pinned upstream `/app/server.js` hash. The native-profile patch correctly refused to build against it. Rebuilding the base from the reviewed `jo-inc/camofox-browser` commit `79d425be26743883a06613eaa3be5e38e7ab5409` restored the expected hash; the patch gate was not weakened. The candidate browser image was `sha256:307a0a79509bb57a93d104e1ed487ce536ff9b41b8ac2dd951d94ef16293b6c1`.

The synthetic native-profile fixture passed inside this actual Sandbox Docker daemon with the production capability drop, no-new-privileges, memory, CPU, and PID limits. It covered account isolation, task reuse, container replacement, and expired-lease shutdown.

The real-account volume was then migrated from legacy JSON to `native-profile-v1`. Firefox launched under the same strict container limits. A browser tab reached the previously verified proxy egress IP. Facebook Messenger loaded the existing account without password or TOTP, then requested one PIN to restore chat history. The already authorized PIN was submitted once; the next observation showed the Chats interface and no PIN error. The browser container was stopped, removed, and recreated from the same volume: Messenger still displayed Chats with no password, TOTP, or PIN prompt and the same proxy egress. The Sandbox was stopped to create a snapshot, then resumed; its image, volume, opt-in marker, and proxy configuration persisted. After starting Docker and recreating the browser container, Messenger again displayed Chats with no factor prompt and the same proxy egress. The one-time PIN was a migration recovery, not a repeated per-task login.

This establishes real-account browser/profile continuity across container replacement and Sandbox stop/resume in an isolated production-derived runtime. It does **not** establish an application-level `ready` receipt, zero credential *claims* through the broker, inbound DM capture, nonempty DM history, text publication receipt reconciliation, video publication, or deployment of PRs #424/#426. The production source Sandbox and app were not changed.

Next gates: run the complete Agent/broker session-first task against the migrated account with zero factor claims, then verify a real inbound DM and publication receipt against app records. Keep the account on the same persistent volume and use factor recovery only after a positively observed expired session. Coordinate production rollout of PRs #424/#426 after those checks and image pinning, then repeat the checks against the production app.
