# Main-to-OpenShip releases

`vps-release.yml` validates each main push, then requests that exact SHA through a
restricted SSH key. The host builds images, drains workers, updates the browser
OpenShip service and checks their health. OpenShip `autoDeploy` stays false:
its direct deployment path would bypass this transaction. Vercel deployment is
independent; application/service API changes must remain backward compatible.

The host accepts only `release <40-hex-SHA>` and `status <40-hex-SHA>`. It checks
public main before fetching and again before promotion. A superseded revision
cannot replace a newer release. Private service configs, receipts, logs and
rollback journals live under `/opt/ftrade-vps/release` (0700), outside Git.
The GitHub `vps-production` environment permits only main and holds the dedicated
SSH secret and pinned host-key variables. This key cannot open a shell, upload
files or forward ports. The fixed host bootstrap is provisioned separately;
changes to bootstrap.py require a deliberate host update.

## Release behavior

- Relevant tracked inputs are hashed. Unrelated main changes get a successful
  `runtime_inputs_unchanged` receipt without restarting services. Worker images
  are rebuilt only when their Dockerfile, copied payload or pinned browser build
  inputs change. The browser controller is rebuilt for relevant releases. Compute is hosted in Vercel Sandbox and is never built or deployed by this driver.
- Native builds read and validate the Docker daemon architecture (amd64/arm64),
  explicitly pass `TARGETARCH` to the browser base, and use the same architecture
  for image smoke tags. The resource-limited legacy builder does not supply
  BuildKit automatic platform arguments. Unknown architectures fail before builds.
- Builds reserve 2 GiB in shared admission and use the legacy Docker builder's
  2 GiB / 2 CPU limits. CPU and available memory are checked before building.
  Root-disk headroom must be at least 4 GiB (12 GiB for worker rebuilds).
  The release does not prune other images to create space.
- Image smoke tests and controller/admission contract tests run before draining.
- `drain.json` is installed under the existing shared admission lock. Both
  controllers reject new allocations while existing tasks continue. After two
  empty worker observations, the services and monitor are updated as one bundle.
  A 20-minute drain timeout cancels the update without killing workers.
- The one-time upgrade from pre-drain controllers stops telemetry and waits for
  its existing fail-closed freshness guard. Later releases use the drain marker
  directly. The monitor resumes even if the first drain times out.
- Acceptance requires OpenShip's deployment to be ready, the exact immutable
  image to be running and healthy, fresh host telemetry, and the public browser
  gateway to reject an unauthenticated request with 403 (with valid TLS). Failed promotion restores both previous service
  configs/images and monitor files. Failed rollback retains the journal and drain
  marker for investigation; it must not admit jobs into a partially restored pair.

The version-2 host contract permits only the browser target. It has no compute
pool, quota marker, compute image or broker health dependency. The build-capacity
reservation uses the existing browser Agent image. Old two-service config or
recovery journals fail closed before any attempt to restart the retired broker.

After owner-authorized cleanup (#803), the VPS compute broker/project, 12 GiB
workspace image, its mount/service units and compute-only image tags are removed.
`ops/vps-runtime/retire.py` first performs a dry-run; `--apply` requires the release
lock, no active workers, matching healthy browser configuration and a verified
edge. It archives small recovery metadata privately, reconciles the old failed
compute rollback, and clears its drain only after browser/telemetry verification.
No Docker volume, browser image, native profile or browser backup is deleted.
A partial failure retains the drain for operator reconciliation; do not blindly
restore archived two-service state or clear the drain before health checks.

## Operations and recovery

The SSH request starts a serialized systemd unit, independent of the Actions SSH
connection. A cancelled runner does not interrupt promotion. Receipts expose only
revision, state, timestamp and a generic reason; detailed errors stay in private
host logs. Re-running Actions retries failed/rolled-back revisions. A failed
unit start is recorded as failed instead of leaving a queued receipt forever.

A power loss or forced process kill can leave a drain/journal. The next accepted
main release reconciles that state before proceeding. This is not an automatic
boot recovery service. For `rollback_failed`, inspect the private log and journal
first; an administrator can run the reviewed driver on the host under the release
lock to recover, then verify both services and fresh telemetry before clearing a
drain. Never clear a journal or drain merely to make a receipt green.

`state.json`, service configs, candidate configs and rollback journals contain live
credentials. Never print them wholesale into tool output or attach them to an issue.
Read only an explicit allowlist such as revision and image IDs. For ordinary
release status, use the sanitized receipt below. Private logs also require local
redaction before any excerpt is shared.

Normal inspection (using the existing administrator SSH key):

```sh
systemctl status ftrade-release-<SHA>
cat /opt/ftrade-vps/release/receipts/<SHA>.json
# Detailed logs may contain private service configuration; do not paste publicly.
less /opt/ftrade-vps/release/logs/<SHA>.log
```

Only the dedicated browser project ID in private config is mutated. Edge routes
remain separately managed. Deployment rollback restores code/configuration; it
cannot undo arbitrary business data writes. Storage/schema migrations need a
separate reviewed migration and compatibility plan.

### First official-browser cutover

The legacy-to-official browser transition takes a fresh native-profile snapshot
inside the release's owned drain, after all workers have stopped and before any
service configuration changes. It resolves the current node identity using the
Agent's key-file precedence, verifies every selected volume's ownership and
refuses mounted or active volumes. The snapshot helper has no network, read-only
source mounts, one CPU and 256 MiB, with the normal adaptive resource checks.

The private release backup directory contains a `native-profiles-*` directory,
volume mapping, gzip archive and SHA-256 receipt. Failure prevents promotion;
an archive without a receipt is incomplete. Routine upgrades after the official
cutover do not repeat this one-time migration snapshot. Earlier preparation
snapshots remain separate evidence, since an account may change before drain.

For a later manual rollback, retain a private copy of the post-cutover profiles
before restoring any pre-cutover snapshot. Verify its receipt and ownership,
stop account work, and use the retained previous image/configuration. Deployment
health rollback does not automatically overwrite native account data.
