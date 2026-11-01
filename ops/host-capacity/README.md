# VPS workload profiles and adaptive admission

OpenShip manages one browser Agent and one compute broker. Controllers, image
layers and the 12 GiB compute filesystem remain shared. Account profiles,
compute directories, deadlines and same-account browser leases stay isolated.
This scales task admission within the VPS; it does not provision machines or
replicate controllers.

## Profiles and measured load

| Work | Memory hard limit | CPU burst cap | Disk hard quota |
| --- | --- | --- | --- |
| Media metadata probe; .txt/.md input up to 1 MiB | 512 MiB | 0.5 core | 1.25 GiB |
| OCR, other documents, video processing, unknown compute work | 2048 MiB default | 2 cores | 5 GiB |
| Browser | Existing 2048 MiB account-run limit | 2 cores | Existing isolated persistent profile |

Profiles are selected by server-side callers and validated by the broker.
Clients cannot supply arbitrary resource limits or quota groups. Heavy remains
the backward-compatible default. Oversized/malformed input can fail within its
profile; commands are not automatically replayed into a larger container.

The host monitor samples every two seconds from cgroup v2, /proc/stat,
MemAvailable and memory pressure. It records 30-second worker CPU/memory peaks
and a 10-second host CPU peak. No request, file, URL or credential is sampled.

Admission holds one kernel flock across both controllers through Docker start.
It uses measured CPU plus 25% margin (minimum 0.25 core per existing worker),
current memory plus 25% and recent memory peak plus 10%. A new task starts with
its full profile budget. New workers are charged their complete hard envelope until three samples
exist. A just-started worker may be absent from the snapshot for at most eight
seconds; older missing workers fail closed. Short tasks can therefore start
together when their full budgets fit, without treating startup as zero usage. Recent peaks expire gradually; there is no immediate expand/shrink loop.

Additional hard guards remain:

- Sum of worker memory hard limits cannot exceed total RAM minus the larger of
  2 GiB or 20%. This deliberately does **not** overcommit RAM on the assumption
  that idle browsers will remain idle. Browser runs keep their current budget.
- Available RAM must leave the larger of 1.5 GiB or 10% after a new task.
- CPU admission reserves the larger of 0.5 core or 10% for the host. Individual
  CPU caps remain; already-running tasks share CPU during simultaneous bursts.
- Memory PSI some >5% or full >1% (avg10), worker OOM evidence, absent/invalid
  metrics, or a snapshot older than eight seconds blocks new admissions.
- At most 16 workers, plus platform node/account limits and disk reservations.

Pressure stops new admissions; it does not kill, freeze or shrink running
containers. CPU usage and task mix can increase/decrease the admitted count.
There is no claim that a low instantaneous memory value predicts future demand.

## Host installation and native services

Run `install-monitor.sh` as root on the VPS. It installs the read-only sampler
and its systemd unit, creates/preserves the shared lock inode, and starts the
monitor. It needs the host Docker socket and cgroup v2. The monitor has a
128 MiB / 0.25-core ceiling and restarts with Docker.

Both controllers mount `/opt/ftrade-vps/capacity:/run/ftrade-capacity` and set
`FTRADE_HOST_CAPACITY_DIR=/run/ftrade-capacity`, `FTRADE_HOST_ADAPTIVE=1`.
Adaptive mode without the shared directory fails closed. The directory is
root:docker-group 0750; admission.lock is 0660. Never replace its inode while
controllers run. Snapshots use a separate root-owned, atomic-renamed 0640 file.

The broker needs 512 MiB for its bounded 16 HTTP handler slots; this allows more
than four simultaneous lightweight commands while retaining control endpoints.
Keep Agent MAX_RUNNING_BROWSERS=16, HOST_RESERVE_MB=1536 and the platform ceiling
maxBrowsers=16, memoryBudgetMb=32768, browserMemoryMb=2048. Those ceilings do not
promise that many browsers. Only one Agent may use a node identity.

Browser work stays in its existing queue. Compute retries explicit pre-admission
429 responses for up to 120 seconds. Ambiguous creates and commands never retry.
A missing monitor blocks new work but existing commands and cleanup continue.

## The same 12 GiB shared disk

Drain and stop the broker, then run
`ops/vps-runtime/configure-profile-quotas.sh`. It adds light-job quota groups to
the existing ext4 grpquota mount; it does not resize, remount or format it.
The existing v1 marker and heavy groups remain for rollback. V2 requires its
additional profile marker before creating jobs. First-time hosts still need
`enable-workspace-quotas.sh` before this profile setup.

Heavy groups 20000–20015 have 5 GiB limits; light groups 20100–20115 have 1.25 GiB
limits. Each has 65536 inodes. Workers retain UID 1000, a unique primary group,
no supplementary groups or capabilities, a read-only rootfs and offline network.
The 256 MiB /tmp is memory-backed and charged to each task's memory limit.

The ledger reserves **profile quota bytes**, not 5 GiB for every task. It keeps
1 GiB filesystem headroom; quotas do not physically allocate space per job.
On the current pool this permits up to eight light jobs, two heavy jobs, or
other mixtures that fit both disk and host budgets. These are ceilings, not
throughput guarantees. No automatic disk growth occurs. Reservations release
only after the worker is confirmed absent and its files removed.

## Acceptance and rollback

Test on a separate ephemeral canary pool/controller before changing production.
Mixed encoding/probe/text work, CPU burst/cooldown, memory burst, quota isolation,
stale-monitor rejection and recovery must pass. See the 2026-11-01 adaptive
acceptance report for observed counts and limits.

For rollback, first drain **all** worker sessions. Restore saved OpenShip service
images/environment/resources and the previous application revision. The old
broker cannot read active light-profile ledger records. With the ledger empty,
its old heavy groups and v1 pool marker work unchanged; no reformat or data
removal is needed. Keep profile volumes, shared disk and the lock inode.
