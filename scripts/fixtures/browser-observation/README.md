# Synthetic receipt observation

This plugin is mounted only into the network-none image test. It intercepts all
browser requests and never contacts Facebook, imports an account, uploads media,
authorizes an external effect, clicks Publish, or writes an application receipt.

The stale-feed case serves a loaded but outdated receipt page. DOM reads cannot
make the new post appear; a subsequent navigation to the same reviewed page does.
The unmodified driver returns `facebook_video_receipt_not_observed` despite every
request succeeding with HTTP 200. The fixed driver finds the unique synthetic
video/Reel after one bounded refresh. This reproduces a code defect; it does not
prove which condition failed during a historical live observation.

Missing post, baseline-only match, wrong actor, missing video and non-Reel link
remain failures with distinct fixed diagnostics. Two refreshes and the existing
20-read bound prevent indefinite polling. The original baseline is preserved.

Run against exact image references from the repository root:

```sh
CONTAINER_ENGINE=podman FTRADE_PODMAN_CONNECTION=podman-machine-default-root \
  OBSERVATION_SECCOMP=/absolute/shared/path/restricted.json \
  bash scripts/test-browser-observation-images.sh AGENT_IMAGE BROWSER_IMAGE
```

Generate and review the optional local policy using
[`podman-browser-preflight.md`](../../../docs/testing/podman-browser-preflight.md).
Its absolute path must be visible inside the Podman VM. Omitting
`OBSERVATION_SECCOMP` retains the engine policy, including in Docker CI and the
final Vercel Sandbox check. Do not apply the Podman diagnostic policy to production.

The runner uses the production browser's dropped capabilities, no-new-privileges,
read-only root, init, 2 GiB memory with no swap, two CPUs, 512 PIDs, 256 MiB shared
memory and 512 MiB temporary directory. Each case releases its whole synthetic
session before the next case so `MAX_SESSIONS=1` and the four-tab ceiling remain
enforced. After the workload it checks effective kernel capabilities,
no-new-privileges and cgroup v2 limits/events, and emits memory/PID peaks. A limit
hit or OOM fails the check. The synthetic ephemeral `/data` and network-none setup
remain different from an account volume and approved production proxy.

The optional third argument `legacy` verifies the pre-fix stale-feed failure
against an unmodified agent image. CI tests the fixed image pair on both native
architectures. Browser heartbeat renewal and cleanup are limited to these local
synthetic test containers.

The default `fixed` run also executes the inbox collector through the native
Firefox/Camofox HTTP boundary. It captures one inbound message, excludes an
outbound message, and repeats the scan in a new synthetic session to verify the
same stable message ID. Missing message IDs, ambiguous direction and wrong
account identity must return `page_contract_failed` without delivering messages
or a completion marker. Pass `inbox` as the third argument to run only these
four scenarios with the same isolation and resource checks during local iteration.

These native checks do not persist messages. Stable IDs across two scans are
not database deduplication evidence; the separate PostgreSQL roundtrip covers
encrypted storage, lost-response deduplication and human routing. Neither test
establishes real Facebook selectors, account readiness or two-account delivery.
