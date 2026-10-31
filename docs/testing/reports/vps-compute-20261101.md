# VPS compute acceptance — 2026-11-01

Scope: reviewed migration implementation on `codex/722-vps-runtime`, Issue #722.
Tests used generated documents and synthetic color-bar video; no customer data.
These are direct application-function and live VPS checks, not proof of a deployed
Vercel Action/Workflow or production private Blob integration.

## Application functions on the VPS

All five paths passed through `https://runtime.ban12.com/v1/compute`:

| Path | Observable result |
| --- | --- |
| Document conversion | Synthetic text converted, source SHA retained |
| Uploaded media probe | 320 × 240, 4 seconds, 30 fps, audio detected |
| Marketing visual sampling | Three JPEG samples extracted |
| FFmpeg marketing render | 1080 × 1920, H.264/AAC, 30 fps, yuv420p, SAR 1:1, 48 kHz stereo, 3.033 seconds |
| Remotion marketing render | 1080 × 1920, H.264/AAC, 30 fps, yuv420p, SAR 1:1, 48 kHz stereo, 3.051 seconds |

The rendered Remotion frame was visually inspected: synthetic color bars and
explicit synthetic-product caption were present. The application Remotion
bundle was built locally and uploaded to the offline job container. The build
reported the existing Zod 4.6.7 / Remotion expected 4.4.3 mismatch; the real render
passed without changing dependency versions.

## Isolation and recovery

Live `docker inspect` proved 2,147,483,648-byte memory and memory-swap limits,
2 CPUs, 256 PIDs, no network, read-only root filesystem, all capabilities dropped,
and `no-new-privileges`. Tools ran as UID 1000; the independent container timer
ran as UID 65534. Attempts to open a public network connection, modify `/etc`,
and stop the timer process were denied. Authentication, second-job admission,
private-source download and file-path escape checks were rejected.

Stop removed the container and its workspace, including a directory made mode
000 by the tool. Restart removed a live orphan and invalidated its capability.
With the broker stopped, the container independently expired after 604.91 seconds
(observation interval 15 seconds); restarting the broker removed its workspace.
Separate startup checks rejected both an absent workspace mount and a directory
on the host root filesystem. The dedicated workspace is a physically allocated
12 GiB ext4 loop filesystem, mounted nodev/nosuid/noexec, with systemd ordering
and admission-time verification.

## Reproduction and evidence

- `python3 scripts/test-vps-compute.py`: 13 tests passed.
- `pnpm exec tsx scripts/test-vps-compute-client.ts`: passed, including VPS by default and no silent fallback.
- `pnpm typecheck`: passed.
- Media parser and Remotion ABCD policy tests: passed.
- `pnpm build:remotion`, then `scripts/smoke-vps-compute.mts` with private runtime configuration and explicit `VPS_SMOKE_SOURCE_URL`.
- Dedicated-host checks: `ops/vps-runtime/smoke-security.py --deadline`.

Synthetic outputs and machine-readable evidence are retained outside Git under
`tmp/vps-compute-smoke-159be6af-b903-4af0-8483-e028a2fd5f04/` locally and
`/opt/ftrade-vps/compute/` on the test VPS. Tokens and signed URLs are not recorded
in this report.

## Remaining production acceptance

Use a synthetic private Blob uploaded through the deployed application to verify
its actual Action/Workflow calling path and deadlines. The fixture download used
a temporary exact hostname allowlist; it does not prove private Blob permissions.
Retire the temporary fixture and allowlist after testing. VPS is the default
provider; missing credentials fail closed. Explicit Vercel provider configuration is rejected. Remove old configuration
and paid Sandbox resources at final retirement.

## Calling platform duration

The installed Workflow Next adapter emits `maxDuration: "max"` for workflow and
step functions. Ordinary media registration is a synchronous Server Action and
inherits its page's duration. The deployment owner verified the production Vercel
team is Pro with Fluid compute enabled and changed the project default function
timeout to 800 seconds via the official API (response confirmed the value).
That setting applies to the next deployment; inspect the resulting deployment
metadata before acceptance. This allows the 600-second job lifecycle plus
transport/cleanup overhead without relying on the default 300-second budget.
