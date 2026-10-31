# VPS compute runtime

Native Docker Compose and systemd manage the broker; OpenShip manages the edge
TLS route. The broker listens on
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

Use native Compose with all supplied security settings. OpenShip v0.9.5's normal
Compose import does not preserve every security field; do not redeploy this stack
through a parser that drops host networking, read-only, capabilities or limits.
Route the loopback broker through OpenShip's edge; it needs only its token and
source hostname allowlist, not database/Blob credentials.

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
