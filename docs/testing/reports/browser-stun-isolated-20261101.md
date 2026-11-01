# Isolated browser STUN observation — 2026-11-01

Related to #675. This adds a real received-datagram observation to the earlier
HTTP-only and ICE-string evidence. It does not complete actual-proxy or
production network acceptance. No account, credentials, messages or existing
profile was used.

## Artifact and environment

- Existing local image config ID:
  `ca832ef326d118be8ec3f1f46f8d51cd005ed7df89129148b25c772a1d8e046f`;
  OCI revision label `b578e3638ab1f7f8266f6e374b0323964e71f4ea`.
- Actual binary: `Camoufox Camoufox 158.0-beta.40`. This cached artifact is not
  claimed to match the currently deployed VPS image.
- Dedicated Podman network independently read back `Internal=true` and
  `IPv6Enabled=false`; no published ports or host network, no account volumes.
- Dropped all capabilities, no-new-privileges, 2 GiB RAM, 2 CPUs, 512 PIDs,
  256 MiB shared memory. Used the repository-generated restrictive local
  seccomp policy; this is not the production Docker policy.
- `geoip: false` is deliberate: no external IP lookup is permitted in this
  fixture. The launcher emitted its expected proxy-without-GeoIP warning.
  Do not copy that choice into production or treat this as GeoIP coverage.

The Node process hosts a fixed-target synthetic HTTP proxy, a distinct HTTP
target, and a UDP receiver on the disposable container's non-loopback IPv4
interface. Proxy requests cannot forward arbitrary URLs or CONNECT traffic.
The receiver counts datagrams and independently recognizes STUN binding
requests by type and magic cookie. It does not rely on browser candidate text.
A synthetic datagram and actual direct-browser STUN traffic are positive
controls for the observer; a disabled-WebRTC browser is a negative control.

## Observed final four-case result

| Mode | Peer API | Target HTTP | Proxy HTTP | Received UDP / STUN | ICE state after bounded observation |
| --- | --- | --- | --- | --- | --- |
| Direct, upstream WebRTC default | Available | 2 | 0 | 6 / 6 | gathering, 2 candidates |
| Synthetic HTTP proxy, default | Available | 0 | 2 | 0 / 0 | complete, 0 candidates |
| Unreachable synthetic proxy, default | Available | 0 | 0 | 0 / 0 | complete, 0 candidates |
| Synthetic proxy, explicit WebRTC disable | Absent | 0 | 2 | 0 / 0 | API unavailable |

All assertions pass, including failed HTTP navigation with the unreachable
proxy and no direct HTTP fallback. Each available peer is observed for five
seconds and closed. Proxy cases must finish ICE gathering and receive zero
datagrams at the independent receiver. This is evidence for these local
IPv4 destinations and options, not proof that no packet can leave over any
interface, protocol, destination or future configuration.

## Reproduction

Fixture: `scripts/fixtures/browser-network/observe-stun.mjs`. It imports the
launcher inside the image and must not run against a real account. First
generate the restrictive policy as described in
[Podman preflight](../podman-browser-preflight.md). Use a unique disposable
network/container name if another run exists; never remove someone else's.

```sh
podman --connection podman-machine-default-root network create --internal ftrade-675-synthetic
podman --connection podman-machine-default-root network inspect ftrade-675-synthetic --format '{{.Internal}} {{.IPv6Enabled}}'
podman --connection podman-machine-default-root run --rm -i \
  --name ftrade-675-stun-observation --network ftrade-675-synthetic \
  --cap-drop ALL --security-opt no-new-privileges \
  --security-opt seccomp=/private/tmp/ftrade-network-policy/restricted.json \
  --memory 2g --cpus 2 --pids-limit 512 --shm-size 256m \
  --entrypoint node ca832ef326d1 --input-type=module \
  < scripts/fixtures/browser-network/observe-stun.mjs
podman --connection podman-machine-default-root network rm ftrade-675-synthetic
```

The policy path above is this local run's generated file, not a repository
artifact. On another host use its newly reviewed policy and full image ID.
Node syntax, Biome and diff checks pass. The final four-case actual-container
run exited zero. No production source or network policy changed.

## Failures and remaining gates

Initial nonpersistent launch attempts reported success but the VM later
stopped. Holding a terminal session allowed subsequent access; causality of
the earlier stops is not established. The default rootless storage reports
an overlay readlink error. The existing separate rootful store was readable;
no store reset, pruning, account-volume inspection or machine reconfiguration
was performed.

The first synthetic browser attempt under default Podman seccomp did not
complete launcher connection and was explicitly stopped. Under the existing
restricted policy, the three-case observation passed, then the added
unreachable-proxy case passed in the final four-case run. Retain that local
policy difference; do not call the first attempt a network leak or pass.

#675 stays open: authorized actual proxy/GeoIP behavior, independent DNS and
IPv6 transport observation, and the actual deployment's packet/policy boundary
still need evidence. The current fixture narrows the gap; it does not equate
an empty candidate list or successful login with complete network isolation.
