# MVP1 Firefox runtime parity checkpoint — 2026-09-23

Issue #414; branch `codex/414-sandbox-profile-parity`. This is a runtime gate, not production acceptance.

The managed Sandbox compose file now forwards `BROWSER_NATIVE_PROFILES`, defaulting to `0`. The Agent already checks the image's native-profile label, and a missing account manifest prevents a fresh-profile fallback. The browser container now states `PROXY_PROTOCOL=http` explicitly; the pinned Camofox default was already HTTP. This removes an implicit dependency on that upstream default. Neither change enables a production account by itself.

The native-profile runtime fixture now starts Firefox with the same capability drop, no-new-privileges, memory, CPU and PID limits as `containerSpec`. This test still uses a synthetic account and `--network none`; it cannot prove the approved proxy, Facebook login, or Messenger history.

Local Podman differential with the reviewed image `localhost/ftrade-browser:session-parity`:

| Synthetic configuration | Result |
| --- | --- |
| Previous fixture constraints | Write, task reuse, container replacement and read all passed |
| `no-new-privileges` only | Same fixture passed |
| `cap-drop ALL` without no-new-privileges | First `/start` returned HTTP 500 |
| `cap-drop ALL` with no-new-privileges | First `/start` returned HTTP 500 |
| `cap-drop ALL` plus SETUID/SETGID and no-new-privileges | First `/start` returned HTTP 500 |

Private synthetic diagnostics for the combined constraints recorded repeated `uid_map: EPERM`, child exit on signal 11, and `native_profile_launch_timeout`. These observations identify an incompatibility in this Podman environment; they do not yet establish the same failure or its exact cause in Vercel's Docker engine. The failed runs were on isolated synthetic volumes. The existing real-account profile was not opened or modified. No Firefox sandbox setting or production capability policy was weakened.

Next gate: run the new fixture in CI's actual Docker engine on both architectures. If it fails there, isolate the minimum compatible runtime configuration on synthetic storage and repeat under the final production policy. If it passes in Docker, retain the stricter policy and treat local Podman as a divergent diagnostic environment. Only then repeat the session-first real-account test using the production image and same profile, with zero factor claims required for ready.
