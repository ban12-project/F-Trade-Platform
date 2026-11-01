# VPS compute runtime

The original deployment uses native Docker Compose and systemd for the broker;
OpenShip manages its edge TLS route. In that deployment the broker listens on
`127.0.0.1:9500` with `network_mode: host`; route `/v1/compute` and `/health` to
that address through the trusted edge. Do not publish Docker's socket or port
9500. Access to the broker token or Docker socket is host-level authority.

Build from the reviewed repository revision:

```sh
docker build -f ops/video-sandbox/Dockerfile -t ftrade-media-base .
docker build -f ops/vps-runtime/compute.Dockerfile -t ftrade-compute-runtime .
docker build -f ops/vps-runtime/Dockerfile -t ftrade-compute-broker .
docker image inspect ftrade-compute-runtime --format '{{.Id}}'
```

Configure a private environment file (mode 0600), never Git:

- `FTRADE_DOCKER_GID`: numeric group owning `/var/run/docker.sock`; broker runs
  UID 1000 with only this supplemental socket group and no Linux capabilities.
- `FTRADE_RUNTIME_TOKEN`: random URL-safe token, 48–256 characters.
- `FTRADE_COMPUTE_IMAGE`: exact local `sha256:...` image ID from the build above.
- `FTRADE_COMPUTE_MEMORY_MB`: default 2048, allowed range 1024–3072 MiB.
  Set this together with browser limits to avoid aggregate host overcommit.
- `FTRADE_BLOB_HOSTS`: comma-separated **exact** approved private Blob hostnames.
  The broker resolves all addresses, rejects non-public addresses, pins the
  connection to the checked address with hostname-verified TLS, and refuses
  redirects. Uploaded documents do not use this download path.

Run `prepare-workspace.sh` as root to provision a **physically preallocated**
12 GiB ext4 loop filesystem under `/opt/ftrade-vps/compute/workspaces`, mounted
`nodev,nosuid,noexec`. It refuses to format an existing pool. Place the reviewed
`compose.yaml` and private `.env` in `/opt/ftrade-vps/compute`, then run
`install-service.sh`. The systemd service requires and binds to the mount unit;
Docker's own broker restart policy is disabled so mount ordering is explicit.
The broker checks mount identity, filesystem and capacity before admission and
refuses any fallback to the host root filesystem.

Do not import the original `compose.yaml` directly into OpenShip: its importer
cannot preserve all of those host-network and security settings. The separate
`compose.openship.yaml` and `openship.Dockerfile` support native management as
described below. Both paths need only the token and source hostname allowlist,
not database/Blob credentials.

Application variables: `COMPUTE_PROVIDER=vps`, `VPS_RUNTIME_ORIGIN` (HTTPS origin),
`VPS_RUNTIME_TOKEN` (same private token). Invalid provider/configuration or a VPS
failure is an error, never an automatic Vercel retry. VPS is the default even when `COMPUTE_PROVIDER` is absent; missing VPS credentials
fail closed rather than creating paid Vercel compute. `COMPUTE_PROVIDER=vercel`
and all other provider values are rejected, including stale deployment settings.
Remove old Vercel image, template and credentials configuration at retirement;
user acceptance requires deletion of all old Sandbox compute/storage resources. Browser migration uses its separate lifecycle and configuration.

Every compute job is non-root, read-only, network-disabled and limited to one
active job, two CPUs, 2 GiB memory by default, 256 PIDs and a ten-minute independent container
lifetime. The trusted sleep/init runs as UID 65534, tools as UID 1000;
a compromised tool cannot signal/freeze the independent deadline. `/tmp` is size-limited tmpfs; each job receives only its own UID-1000
subdirectory of the bounded disk pool. No other host paths or credentials enter
the job container. Signed sources are streamed by the broker
to the offline container (<1 GiB each, aggregate <3 GiB, matching the existing upload contract). File transport uses 4 MiB chunks with a
<1 GiB output cap. Restarting the broker invalidates capabilities and removes
only its labelled ephemeral containers. Browser volumes are never touched.

Remotion's renderer and Chrome are installed during the image build, not at task
time. Each render uploads the application's current `.remotion` bundle (no
symlinks, 128 MiB aggregate, 2,000 files), stages approved sources, and serves them
on container loopback. The renderer retains H.264/AAC/yuv420p/bt709/CRF18 and audio
track policy; application ffprobe acceptance still runs. Keep the renderer
package version in the image aligned with the repository Remotion packages.

Run local tests:

```sh
python3 scripts/test-vps-compute.py
pnpm exec tsx scripts/test-vps-compute-client.ts
pnpm typecheck
```

These tests cover protocol and safety contracts, **not** production acceptance.
Before switching production, execute real document parsing, source download,
visual sampling, FFmpeg and Remotion renders on the reviewed image; inspect output
metadata, failed authentication, denied private/redirect downloads, timeout
cleanup and restart cleanup. Also test the actual Vercel-to-VPS path and budgets:
large file transfers and render duration must fit the calling Action/Workflow
limits. Host-wide browser/render capacity coordination is a separate rollout gate.


## Native OpenShip deployment

Build the dedicated broker image on the destination host:

```sh
docker build --build-arg DOCKER_GID="$(stat -c %g /var/run/docker.sock)" \
  -f ops/vps-runtime/openship.Dockerfile -t ftrade-compute-broker-openship .
docker image inspect ftrade-compute-broker-openship --format '{{.Id}}'
```

Import `compose.openship.yaml`, replacing private environment references through
OpenShip's service configuration. Use the immutable image ID above. The image
bakes in UID 1000, the Docker socket group, init, and process-level
`no_new_privs`; its API binds to `0.0.0.0` inside the container. Route through
OpenShip's fixed loopback host port and the existing HTTPS edge route, never a
public Docker socket or directly exposed broker port. See `../OPENSHIP.md` for
the separation between native service lifecycle and the retained edge routes.

The broker's root filesystem is writable and its Docker capability bounding set
and PID limit use platform defaults. This is an explicit control-plane difference
from the original Compose deployment, not an equivalent preservation of all
host-level settings. The broker runs non-root with no effective, inherited or
ambient capabilities, and `no_new_privs` prevents executable privilege elevation.
The API token and Docker socket already grant host-level authority. All ephemeral
worker restrictions (readonly filesystem, no network, dropped capabilities,
`no-new-privileges`, memory/CPU/PID limits and independent deadline) remain set by
the broker itself and do not depend on OpenShip's importer.

Keep the bounded pool mounted at the same absolute path on the host and in the
broker. `FTRADE_WORKSPACE_ROOT` can change that path but never bypasses mount,
ext4, identity-marker or 12 GiB capacity checks. OpenShip may start the broker
before the mount is ready: the broker must fail startup and restart later rather
than using the underlying host directory. Disable the old systemd broker only
at cutover; retain its definition for rollback. Drain jobs before restart,
redeploy or rollback: a new broker process invalidates previous capabilities and
cleans its own unfinished jobs.

For isolated testing set `FTRADE_RUNTIME_NAMESPACE=openship-test` and use a new
random token. This changes container ownership labels and names and places jobs
under `instance-openship-test` within the verified pool. Startup cleanup cannot
select production-labelled containers or production `job-*` directories. The
default `production` retains all existing names, labels and paths. This is test
isolation, not a multi-tenant security boundary. Do not run two brokers with the
same namespace. Schedule synthetic tasks while production compute is idle;
per-process admission locks do not coordinate simultaneous requests across old
and new broker versions.

Run the additional isolation regressions with
`python3 ops/vps-runtime/test-openship.py`. Live acceptance must inspect the
broker's UID, `NoNewPrivs`, capability sets and worker settings, verify real
file/command operations, restart cleanup and OpenShip redeploy/rollback, and
confirm that a missing pool prevents job admission.
