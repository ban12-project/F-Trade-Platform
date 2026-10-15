# MVP1 Podman-first receipt isolation — 2026-10-15

Issue #611 aligns the native synthetic receipt check with the production browser isolation in `ops/browser-node/docker.mjs`. It adds dropped capabilities, no-new-privileges, init, memory/swap limits, the production temporary-directory budget and single-session/four-tab limits. Effective kernel capabilities and cgroup v2 limits/events are checked after the workload; a limit event or OOM fails verification. An explicit optional `OBSERVATION_SECCOMP` supports the documented local Podman namespace diagnostic; Docker CI and Sandbox retain their engine policy.

Enforcing the single-session limit exposed a fixture lifecycle defect: deleting a tab retained its session, causing the next synthetic user to fail with HTTP 503 `admission_rejected`. The fixture now deletes the whole synthetic session and checks the cleanup response. This is a test-harness correction, not a real-account login failure.

## Local first

The rootless store returned `readlink .../storage/overlay: invalid argument`. The existing explicit rootful connection was used without resetting storage or deleting any existing profile/volume. Host/VM UTC agreed before the 90-second lease tests. The installed seccomp profile was exported and the existing restrictive generator/tests passed.

Both native amd64 artifacts have revision `a3f4d6e90c3b8db9b9f236f508515d7d236ff8fd`, from successful image workflow run `38498645722`:

- Agent image config: `sha256:faf81d39de71cddef460d24def23c6fa911c9c704509d9db574b5e89e8f4810a`.
- Browser image config: `sha256:b16bf1e3279952a1bbdd5e58f9f1b4a27f750eab6e4cd65d6e65aa0bc1b7640d`.

Six real Firefox/native-HTTP scenarios passed under network-none and the explicit local restriction: stale feed refresh succeeds; missing exact post, baseline-only link, wrong author, missing video and non-Reel link fail with their distinct bounded diagnostics. The successful case uses two navigations; negative cases use three navigations and the existing 20-read ceiling. Every case records zero external effects.

Post-workload checks confirmed zero effective/bounding capabilities, no-new-privileges, 2 GiB memory/no swap, two CPUs and 512 PIDs. Local peak memory was 551,243,776 bytes and PID peak 171. Memory-limit, OOM and PID-limit events were zero. All fixture containers were removed. Initial admission failure evidence is retained separately from the successful rerun.

## Same-image Sandbox

A fresh temporary Sandbox installed Docker and pulled the same pair by immutable OCI index digests. Its initial pull with the CLI's separate authentication returned HTTP 403; the retry used the existing working registry authentication and removed its temporary files before testing. The first image comparison also failed because Docker exposes an OCI index ID while Podman exposes the config ID. The final check verified the index → amd64 platform manifest → config mapping, including a SHA-256 check of each raw registry platform manifest, plus identical root filesystem layer chains, architecture and source revision. Initial failures were retained; their temporary Sandboxes were deleted.

| Artifact | OCI index → amd64 manifest |
| --- | --- |
| Agent | `22d988e4…ca24d0` → `b4f53cbe…5d482` |
| Browser | `b54fe126…2646b` → `19b3bfac…c4ad` |

After image verification, the Sandbox network policy was set to `deny-all` and independently read back. No account volumes or broker configuration existed. All six scenarios then passed with the same classifications, navigation/read counts and zero external effects, using the actual Docker seccomp policy without the local Podman override. Effective isolation and cgroup checks passed: memory peak 552,157,184 bytes, PID peak 164/512, zero memory-limit/OOM/PID-limit events.

The fixture left no containers or volumes. The temporary Sandbox and orphan snapshots were deleted. No production instance, runtime configuration, account profile or channel was changed. Local raw evidence and registry authentication remain outside Git; temporary local production environment export was deleted after verification.

## Acceptance boundary

This check uses synthetic DOM, an ephemeral data directory and no account, proxy, media upload, authorization, publish click, DM, credential claim or application receipt write. It verifies receipt observation and kernel isolation, not actual Facebook delivery, an existing unknown receipt, a new production broker run, session continuity, snapshot recovery or real inbound capture. #383/#322/#156 and the formal MVP1 business acceptance remain open. Existing real-account unknown receipts and paused-channel state are untouched. Rootless local storage repair and template-expiration risk #529 remain separate.
