# Isolated dual-stack observation on the deployed VPS image — 2026-11-01

Related to #675. Extends the earlier [local IPv4 observation](browser-stun-isolated-20261101.md)
with the actual VPS Docker host, its currently selected browser artifact and an
IPv6 target/STUN receiver. This is still synthetic network characterization,
not acceptance of the actual authorized proxy or all production traffic.

## Environment and boundaries

Read-only Docker inspection found one running Agent selecting browser image
`sha256:d8e51086a29a42fa3c280cbc6c48410a7952dc96fbf4025fc6868cce9e40f657`.
Independent local image inspection matched that ID and revision label
`de7d77864020358a6ea1cbdd32b42be143484b36`. No live browser-task containers were
present before testing. No account configuration, credentials or profile volume
was read or mounted.

Each disposable network was read back as Internal=true and EnableIPv6=true,
with an isolated ULA IPv6 subnet. Containers used the selected immutable image,
read-only root, no published ports, all capabilities dropped, no-new-privileges,
2 GiB memory/swap cap, two CPUs, 512 PIDs, 256 MiB shared memory and bounded
runtime tmpfs. No custom seccomp override was used. An independent 150-second
container timeout bounded each four-case test. Both successful containers exited
zero and reported OOMKilled=false.

Capacity was admitted under the existing shared lock and adaptive budget checks.
The helper's container path `/run/ftrade-capacity` was mapped to its configured
host source `/opt/ftrade-vps/capacity`; no production file was modified. Test
containers carried a synthetic compute label so the existing monitor accounted
for them. Current production admission and network settings were unchanged.

## Observations

The fixture selects IPv4 or IPv6 through `SYNTHETIC_IP_FAMILY` (default IPv4),
rejects other values, and requires exactly one non-link-local interface of that
family. It uses an IPv4 synthetic HTTP proxy in both cases, matching the
production proxy-host input contract. The target HTTP server and independent
STUN receiver use the selected family. This verifies IPv6 target traffic, not
an IPv6-literal proxy endpoint. The proxy never forwards arbitrary destinations.

The same results were observed for IPv4 and IPv6:

| Mode | Target HTTP | Proxy HTTP | Received UDP / STUN | Peer observation |
| --- | --- | --- | --- | --- |
| Direct default | 2 | 0 | 6 / 6 | available; 4 candidates; gathering after 5 seconds |
| Proxy default | 0 | 2 | 0 / 0 | available; 0 candidates; complete |
| Proxy unreachable | 0 | 0 | 0 / 0 | available; 0 candidates; complete |
| Proxy, explicit WebRTC disable | 0 | 2 | 0 / 0 | peer API absent |

Independent UDP observer controls and actual Firefox STUN positive controls
passed. Unreachable-proxy HTTP navigation failed as expected; no direct target
fallback was observed. Counts come from receiver events, not only ICE strings.
Each run's container and network were removed and absence independently queried.

## Preserved unsuccessful attempts

1. The first harness used the controller-container capacity path on the host;
   the missing lock stopped it before creating a browser container. Its temporary
   network was removed. Mapping the path to the documented host bind source
   retained the same lock and budget checks.
2. IPv4 passed, but the subsequent IPv6 allocation was refused with
   host_capacity_exhausted. It was not run or counted as passed. After cleanup,
   a separate admission request allowed the IPv6 test.
3. The first IPv6 fixture also used an IPv6-literal proxy host. Direct IPv6
   navigation worked, but proxied navigation returned NS_ERROR_UNKNOWN_HOST.
   Production accepts IPv4/hostname proxy hosts, not colon-containing literals.
   The final fixture uses the supported IPv4 proxy transport and retains IPv6
   targets. The original failure is not called a production leak or repaired
   production defect.

## Remaining acceptance

GeoIP is deliberately disabled only in this isolated fixture; no external lookup
is allowed. Destinations are literal isolated addresses, so DNS was not exercised.
There was no packet capture of unrestricted production egress, no actual proxy
credential use, and no proof of all interfaces/destinations or public IPv6 routing.
The launcher is invoked directly, not through a live account's full service flow.
Keep #675 open for authorized proxy/GeoIP, independent DNS and production packet
attribution. Do not promote these results to leak-free certification or restore
real publishing/DM. Production runtime source and configuration are unchanged.

## Delivery validation

The final shared fixture was executed separately for IPv6 and then IPv4, with
all four cases passing in each family. Each result was checked using its
container exit code and fixture JSON, not merely the remote harness exit code.
The final IPv4 rerun also confirmed container/network removal.

`node --check scripts/fixtures/browser-network/observe-stun.mjs`, targeted Biome,
`git diff --check` and the complete `scripts/validate_repository.py` passed.
General automatic CI remains temporarily paused under #711; these applicable
local checks and actual isolated VPS runs supply this fixture/report delivery's
validation. They do not constitute final MVP acceptance. No application build
or new real-account operation was needed for this test-only change.
