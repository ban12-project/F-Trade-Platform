# VPS business concurrency acceptance — 2026-11-01

Issue: #727. Native OpenShip continues to manage one browser Agent and one
compute broker. No controller replicas, new machine, account-profile reset or
disk expansion were introduced.

## Verified behavior

- Current host: 4 CPU cores, 7424 MiB RAM; shared compute filesystem remains
  12 GiB. A common kernel lock counts both services' Docker worker limits.
- Two real interactive browser tasks for distinct existing accounts reached
  running simultaneously. Both had 2 CPU / 2048 MiB limits. While both ran,
  compute creation returned the explicit pre-admission capacity rejection.
  No Facebook post, message, credential change or account-status confirmation
  was performed. Both acceptance sessions were closed afterward.
- Two compute sessions ran commands concurrently, with distinct primary groups
  20000 and 20001. A third creation was rejected before allocation. Releasing a
  session allowed another to start.
- One browser plus one compute session ran concurrently. The updated TypeScript
  client waited for a busy slot, then successfully created its session after
  the earlier session was released. Ambiguous failures are not retried.
- A 6 GiB allocation exceeded the 5 GiB kernel quota with EDQUOT. Even with
  that job's quota full, the other job could write. Changing primary group and
  attempting foreign-group inheritance through directory setgid could not
  bypass the quota. After cleanup the pool returned to about 2 MiB used.
- Node/Python contention used the same lock; killing its Node holder released
  it so Python could acquire it. No stale application lock remained.
- Both OpenShip controller containers reached Docker healthy; HTTPS runtime
  health returned 200. Existing routes and persistence mounts were retained.

## Local validation

- 41 browser lifecycle/network and shared-budget tests passed using the tsx
  loader, plus the Agent offline payload and missing-asset negative control.
- 3 Python host-budget, 13 broker, 4 namespace/OpenShip and 2 quota-ledger tests
  passed. Compute client tests cover explicit capacity retry and no retry for
  ambiguous creation.
- TypeScript no-emit and targeted Biome checks passed.

The first allocation test correctly reached EDQUOT but then tried another write
before removing the partially allocated file. Its assertion sequence was
corrected: verify the *other* job remains writable while the first quota is full,
then remove the allocation before checking group-inheritance resistance.

## Limits and rollback

This is resource-based admission, not predictive scaling or an SLA load test.
The current host permits two heavy tasks total, with fewer new admissions under
memory pressure. Same-account browser lease serialization is unchanged. Larger
CPU/RAM capacity can raise the host limit, but the retained 12 GiB pool admits
only two compute jobs with worst-case 5 GiB reservations. Increasing that disk
budget requires a separate reviewed change; no automatic disk growth occurs.

Previous service definitions/images and node ceilings were saved privately.
Drain tasks before restoring them. The old broker's GID is unaffected by the
new group quotas, so rollback does not require reformatting or deleting data.
Automatic CI remains temporarily paused under the existing recorded user
exception; local checks are the merge gate and application deployment remains
enabled.
