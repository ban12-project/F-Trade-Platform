# Adaptive VPS admission acceptance — 2026-11-01

Issue #729. The old uniform 2-core / 2-GiB admission budget prevented lightweight
work from sharing spare capacity. The new broker uses 512-MiB / 0.5-core / 1.25-GiB
light profiles for metadata probes and .txt/.md inputs up to 1 MiB. Unknown work,
OCR, other documents and rendering retain the heavy envelope. Browser limits and
same-account serialization are unchanged.

## Pre-production canary

Testing ran on the same 4-core / 7424-MiB VPS using a separate offline-worker
namespace, loopback-only broker and temporary 12-GiB ext4 filesystem. Production
services kept their previous images/configuration during these tests. Production
storage was not resized or reformatted. The sampler collects resource counters
only; its new guard was first enabled in the canary.

Observed results:

| Scenario | Result |
| --- | --- |
| One real FFmpeg encode + three media-probe loops | All four overlapped; distinct job groups; successful results |
| Small plain-text preprocessing with the actual installed converter | Completed within the 512-MiB profile |
| Eight real media-probe loops | All eight overlapped and completed; ninth creation rejected; no OOM |
| Four workers driven into a CPU burst | New light task rejected at measured host peak about 3.66 cores |
| Burst ends | Immediate creation still rejected; new light task admitted after about 32 seconds as recent peaks expired |
| 1400-MiB allocation in heavy worker | Command completed; another task remained responsive |
| Light worker attempts 1536-MiB file allocation | Kernel EDQUOT at 1.25-GiB quota; neighboring task could still write |
| Stop sampler for >8 seconds | Python and actual Node admission implementations rejected new work; existing commands continued |
| Restart sampler | Admission recovered after fresh samples/peak window; no manual limit adjustment |

During the mixed render/probe sample, host available memory was about 5789 MiB,
measured CPU peak about 2.21 cores, and the sum of worker observed memory peaks
about 254 MiB. These numbers describe the synthetic fixture, not a guarantee for
arbitrary source documents or media. The fixture used a real 720p video encoder
and real ffprobe; no business documents, account messages or publications were
used. All canary sessions and quota reservations were cleaned after each test.

The final immutable broker image was installed in the canary for the mixed-work
rerun before production cutover. Private host receipts retain exact timestamps
and resource samples; credentials and account data are not in this report.

## Deterministic validation

- 43 Node browser/network/admission tests, including 17 decision scenarios shared
  verbatim with Python: pressure, peak history, stale/future/malformed snapshots,
  missing workers, warm-up, OOM evidence and non-overcommitted memory limits.
- 5 Python admission tests, 13 broker tests, 4 namespace/OpenShip tests and 4
  quota-ledger tests, including eight-light and mixed disk budgets independent
  of CPU sampling.
- Agent offline payload/missing-asset negative control; compute client default
  and explicit profile propagation, capacity-only retry and no ambiguous retry.
- TypeScript no-emit, targeted Biome and diff whitespace checks.

## Boundaries

This is adaptive admission, not live memory-limit shrinking or speculative RAM
overcommit. Existing tasks retain their envelopes and are never killed to make
room. CPU demand uses current/recent measured load; memory checks include actual
working set, recent peaks, available host RAM and the sum of hard limits. Slow or
unavailable telemetry fails closed. The host sampler has its own 128-MiB and
0.25-core ceiling and follows Docker restarts.

The retained production 12-GiB pool reserves profile quota bytes plus filesystem
headroom. Eight light tasks is an observed upper-bound scenario, not a promised
fixed count; CPU or memory pressure can admit fewer. Additional memory/CPU does
not silently enlarge the disk. Browser tasks keep their current 2-GiB budget.

The broker HTTP handler ceiling was raised from four to sixteen and its OpenShip
memory limit from 256 to 512 MiB, so handler serialization does not negate light
job concurrency. Authentication, offline networks, fixed images, private job
mounts, non-root tools and the independent 600-second deadline remain intact.

Before rollback, drain all workers: the previous broker does not recognize active
light-group reservations. Once empty, restore saved controller definitions and
previous application revision; existing heavy quota groups/v1 marker still work.
No data deletion or filesystem reformat is required. Automatic CI remains paused
under the existing user instruction; local validation is the merge gate.
