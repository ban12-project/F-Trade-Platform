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

Next gate: finish the current CI run containing the WebRTC preference and opt-in marker, then test the approved proxy in Vercel Sandbox under the production image and security limits. Repeat the session-first real-account test using the same migrated profile, with zero factor claims required for ready. Retain the strict container policy; local Podman is a divergent diagnostic environment for this pinned Firefox runtime.
