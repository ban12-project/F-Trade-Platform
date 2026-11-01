# Shared VPS admission

OpenShip manages one browser Agent and one compute broker. They share code,
image layers and host storage; each browser account retains its own profile and
each compute job receives an isolated directory. This is task concurrency, not
replication of controllers or automatic provisioning of additional machines.

Both controllers mount `/opt/ftrade-vps/capacity:/run/ftrade-capacity` and set
`FTRADE_HOST_CAPACITY_DIR=/run/ftrade-capacity`. Provision `admission.lock` once,
owned by root and the Docker socket group, mode 0660; directory mode 0750. Never
replace this inode while controllers are running. Node's `flock` and Python's
`fcntl.flock` hold the same kernel lock through admission and Docker startup.
Created/running/restarting/paused browser and compute containers all count.
Missing resource limits fail closed. Controller death releases the lock.

The shared budget uses host CPU count, total RAM and Linux `MemAvailable`
(including reclaimable cache). Each current job reserves 2 CPU cores and its
Docker memory limit. Reserve at least 2 GiB or 20% of total RAM outside workers;
also require at least 1.5 GiB or 10% available headroom after a new admission.
The safety ceiling is 16 tasks, not a promise of capacity. On the current
4-core / 7424 MiB host this permits at most two 2 GiB jobs total: two browsers,
two compute jobs, or one of each. Pressure can reduce admissions; existing jobs
are not killed for scaling. Larger hardware increases the calculated limit,
subject to the platform ceiling and compute disk reservations.

Set Agent `MAX_RUNNING_BROWSERS=16`, `HOST_RESERVE_MB=1536` and platform node
limits `maxBrowsers=16`, `memoryBudgetMb=32768`, `browserMemoryMb=2048` together
with the guard. Same-account browser leases remain serialized. Keep only one
Agent per node identity. Browser work stays queued until admission. Compute
returns explicit pre-admission HTTP 429; its client waits up to 120 seconds.
Ambiguous creation failures and commands are never automatically retried.

## Shared compute disk

Keep the existing 12 GiB ext4 pool. After draining and stopping the broker,
run `ops/vps-runtime/enable-workspace-quotas.sh` as root with the host `quota`
package installed. It adds group quotas without formatting or resizing.
Enable `FTRADE_WORKSPACE_QUOTAS=1`, `FTRADE_WORKSPACE_POOL_GIB=12` and
`FTRADE_COMPUTE_MAX_RUNNING=16` in the native broker service.

Each job gets UID 1000 and a unique primary group from 20000–20015, with no
supplementary groups. The kernel limits each group to 5 GiB and 65536 inodes.
The root filesystem is read-only, /tmp is a 256 MiB memory-backed filesystem,
and tools cannot change group identity or gain privileges. Quotas do not
preallocate disk per job. The admission ledger reserves worst-case headroom:
the 12 GiB pool therefore admits two compute jobs even on larger hardware.
Increasing compute concurrency beyond two also requires an explicit reviewed
storage budget change. The system never expands this pool automatically.

Quota reservations persist until the worker is confirmed absent and its files
removed; controller restart reclaims only its own namespace. Keep the host
mount identity checks and independent 600-second worker deadline. A missing
mount, quota marker or valid quota configuration blocks new jobs.

Rollback: drain jobs, restore the previous OpenShip service definitions/images
and node limits. The older broker can still use the unchanged 12 GiB pool;
group quotas for the new worker GIDs do not affect its legacy GID 1000.
Do not remove mounts, account profiles, pool data or the lock during rollback.
