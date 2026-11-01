# VPS services in OpenShip

Issue: #725. This deployment uses stock OpenShip 0.9.5, with no platform fork.

The `ftrade-browser` project owns the persistent `agent` service. The
`ftrade-runtime` project owns the persistent `broker` service. Their containers,
runtime logs, stop/start/restart operations, deployments and release rollbacks
are managed by OpenShip. Browser and compute jobs remain temporary containers
owned by these controllers, not independent OpenShip projects.

## Configuration and ownership

- Build the immutable images using `browser-node/openship.Dockerfile` and
  `vps-runtime/openship.Dockerfile`; register their exact local image IDs in the
  corresponding OpenShip services. An image-ID deployment does not automatically
  build a new version when application source changes. Build and validate the
  new controller image, update the service image, then deploy.
- Use the corresponding `compose.openship.yaml` as the supported configuration
  template. Inject actual credentials through private service configuration,
  never Git. The existing node identity and compute API token are retained.
- Native container bridge networking replaces host networking. Fixed published
  ports are **127.0.0.1:9400** and **127.0.0.1:9500**. Verify actual Docker port
  bindings after every configuration change; do not accept a silently allocated
  replacement port.
- HTTPS remains on the existing persistent OpenShip edge configuration managed
  by `vps-edge/configure.py` and the renewal timer. This is intentionally separate
  from Dashboard-generated domain routes: the browser viewer has credentials in
  its URL path, while the current built-in edge request logger records paths.
  Do not add a duplicate Dashboard domain route or replace the private route
  with the default request logger. Runtime/container logs remain available.
- Preserve the original named state volume, all account volumes, private binds
  and keys. The state volume's verified Mountpoint is bound directly because
  the current importer cannot be relied on to retain external-volume naming.
  Never prune this volume based on a reported lack of named-volume references.
- The bounded compute pool and its enabled mount unit remain infrastructure
  prerequisites. The broker checks the actual filesystem, capacity and identity
  on startup and before writes. It refuses to use an unmounted host directory.

## Explicit differences

The controller root filesystems are writable; controller PID limits and tmpfs
settings are not preserved by this importer. CPU and memory limits are explicit.
Init and process privilege restrictions are baked into the images. Browser
controller capabilities are dropped before Node starts; compute runs as UID
1000 with the host Docker group and no-new-privileges. These process settings do
not apply automatically to independently launched `docker exec`/health probes.
Both controllers intentionally possess Docker host authority. Temporary workers
retain their Docker-level isolation, resource limits, persistent account volume
separation, and independent expiry logic.

## Maintenance and rollback

These controllers are single-instance services, not zero-downtime rolling
replicas. Drain jobs before a restart, upgrade or rollback. Startup invalidates
previous task capabilities and recovers owned unfinished work. Never run two
browser Agents with the same identity or two brokers with the same namespace.

OpenShip's deployment `ready` response can precede container health. Wait for
the container's actual `healthy` state and verify the public HTTPS endpoint
before declaring a successful release. Browser root requests should return 403;
runtime `/health` should return 200. Then verify an authenticated task.

For an image update, use an immutable new image ID and deploy. To recreate the
current release with its saved configuration, use `openship deploy --refresh`;
an ordinary unchanged deploy can correctly report `no_changes`. Release rollback
was tested in independent projects. Do not restore test credentials or test
namespaces to production.

The legacy `ftrade-browser.service` and `ftrade-compute.service` units are stopped
and disabled after successful takeover, with their configuration/images retained
for rollback. To revert, stop the corresponding OpenShip service first, verify
it cannot restart or hold its fixed port, then enable/start the legacy unit.
Never start the old and new controllers simultaneously.

## Acceptance evidence — 2026-11-01

- Independent OpenShip projects ran the actual controller images. Browser used
  a synthetic identity, private test state, and a local TLS mock control plane;
  compute used a separate token and ownership namespace.
- Both native lifecycle paths passed restart, refresh/recreation and release
  rollback. Browser installation identity survived recreation and rollback.
- Real synthetic browsers passed API/VNC connectivity, unauthorized/cross-account
  rejection, cookie/localStorage persistence across two cold starts, unchanged
  job isolation, absence of published job ports, and task-network cleanup.
- SIGKILL of a synthetic previous Agent released its Docker network endpoint;
  deleting the task network succeeded while the exited container record remained.
- Native compute ran real commands with the original worker isolation and
  namespace-specific storage. After production takeover, authenticated HTTPS
  requests created a job, rendered synthetic H.264 video, probed it, ran the
  document Python environment, and removed the job.
- Production browser takeover retained the installation identity and existing
  account storage. A real authorized account opened through the application,
  connected over the HTTPS/WebSocket viewer, and displayed its already logged-in
  Messenger page. The test session was then released; no message was sent.
- The first browser attempt automatically reverted when its immediate public
  probe returned 502 before startup completed. The second attempt waited for
  actual container health before accepting the cutover. Both old system units
  are now disabled; test projects were removed after their lifecycle checks.
- Local regressions: 33 browser tests, 5 network tests, 13 compute tests and
  4 namespace tests passed. Full-host reboot is not part of this acceptance.

Private host receipts and rollback configuration are under
`/opt/ftrade-vps/openship-native`; no credentials or account contents belong in
this document.
