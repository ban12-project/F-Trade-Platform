# Browser runtime migration to a dedicated VPS

Part of #722. OpenShip manages the public edge. The existing
broker still authorizes every task and issues short-lived viewer tickets. A
resident Agent starts browser containers only for leased work; no Firefox stays
running for an empty queue. The VPS itself remains powered on.

## Required evidence before cutover

1. Verify the database against the actual production deployment. A local env
   file or a historical report is not proof of database identity.
2. Read the node lifecycle, current account IDs, installation ID, all run states,
   outbox claims and provider metadata with `resume: false`. Never start a VM
   just to report its status. Stop the migration if a publication is executing,
   any live/quarantined run exists, or a provider operation is ambiguous.
3. Freeze new dispatch and demand with the node row lock during the final
   staging/cutover operation. Check queued demand too. Do not turn an unknown
   publication into a fresh attempt. Do not hold an unbounded SQL transaction
   while transferring archives: use the existing bounded staging/heartbeat
   pattern and re-read all state under locks immediately before cutover.
4. Preserve an independently observed stopped rollback snapshot. The original
   instance must remain stopped after final export. Never run the old and new
   Agent concurrently with the same identity/key.
5. Inventory **all** `ftbrowser-<node>-<account>` volumes, including accounts no
   longer present in current broker history. The 2026-10-31 production report
   recorded 11 account volumes for only 3 current accounts; this is historical
   evidence, not an inventory to hard-code. Check labels, owner manifests,
   numeric file ownership and a content fingerprint for every volume.
6. Snapshot container metadata may still say `Running=true` even when the
   provider is stopped. Do not call such a snapshot a clean checkpoint. Export
   the entire static profile, including SQLite WAL/SHM and IndexedDB data; never
   delete locks or initialize a replacement profile as part of copying. Check
   SQLite integrity on an additional disposable copy, and prove actual recovery
   through a cold start after byte-level checks.
   Export/import the exact node-state volume (including `installation-id`),
   all account volumes and the operator-owned private Facebook configuration
   directory. Preserve native profiles, IndexedDB and non-exportable key
   storage; a cookie-only export is insufficient. Keep manifests and private
   configuration out of source control and logs. Keep encrypted private
   rollback artifacts outside the public project directory.
7. Freeze source and destination receipts using `browserVpsInventorySchema`;
   `verifyBrowserVpsRestore` rejects missing historical volumes, changed
   fingerprints, browser-image/native-mode drift or a different installation
   identity. An updated Agent image requires its independently reviewed exact
   image ID as `approvedTargetAgentImage`; otherwise Agent drift is refused.
   Physical restore validation is separate from cutover: the drain guard rejects
   quarantined slots until the existing Agent recovery protocol confirms their
   shutdown; historical terminal publication `unknown` records remain intact.
   A matching receipt is necessary, not proof of application behavior. Generate
   receipts from actual stopped storage, not from a copied inventory file.

## Deployment

Run `compose.vps.yaml` through native Docker Compose on the host (or an
OpenShip host action that invokes that exact command). OpenShip 0.9.5's normal
Compose importer rejects host networking and drops several protection fields;
do not import/redeploy this definition through that transformation. Attaching
a running container for visibility does not make a later OpenShip redeploy
equivalent. Preserve the native Compose definition as the runtime authority.

Use reviewed immutable **local image IDs** from the
source runtime. If the registry is private, obtain only the authorized image
read access, or stream the exact reviewed image archives from the source; do
not make packages public or reuse an unrestricted personal credential on the
VPS. Verify loaded image IDs before starting the Agent.

Set these private operator values:

- `BROWSER_NODE_ID`: the existing node ID, not a newly created node.
- `BROWSER_AGENT_IMAGE` / `BROWSER_IMAGE`: verified immutable local image IDs.
- `BROWSER_NODE_STATE_VOLUME`: exact restored external node-state volume name.
- `BROWSER_PRIVATE_DIR`: root-owned directory containing `node-key` (0600)
  and `facebook` (0700, its manifest/configuration files 0600).
- `BROWSER_NATIVE_PROFILES`: preserve the source's explicit 0/1 opt-in.
- `FTRADE_URL`: the existing HTTPS application origin.
- `HOST_RESERVE_MB`: explicit shared-host headroom (default 3072 MiB).

The Compose file intentionally has no Caddy service and no public ports. The
Agent uses host networking to reach its account containers via random loopback
ports; its viewer gateway listens on `127.0.0.1:9400`. OpenShip's edge currently
uses host networking and can route the browser HTTPS hostname to that loopback
address. Configure that route explicitly; a generic bridge-network service
route cannot reach host loopback. Validate WebSocket upgrade, allowed Origin,
no caching of ticket exchanges and no access logs containing viewer capability
paths. Do not replace this with a public 9400 port.

The VPS Agent permits one browser and rejects a broker allocation above
2048 MiB instead of silently changing its memory allowance. This requires an
Agent image containing the VPS limit check. A source runtime image predating
the check is not equivalent: preserve it for rollback, build the updated Agent
from the reviewed commit, and validate its behavior before switching. The
browser image/profile format should stay unchanged for the migration.

Configure `BROWSER_VPS_GATEWAY_ORIGIN` in the main application to the exact
HTTPS browser origin. Owner-chosen database URLs alone are not an inspection
allowlist. Publication-page inspection uses the same live lease, owner/session
checks and one-use ticket on VPS, and never calls the Vercel provider for a
self-hosted node.

## Cutover transaction and rollback boundary

After independent source-stop and restore verification, lock the existing
`browser_fleet_node` and its `browser_sandbox` row in the established order.
Revalidate no live/queued runs and `phase = stopped`, null session/operation,
no pending dispatch claim. Archive lifecycle/outbox metadata privately first.
Retire that node's outbox records before its lifecycle row (the outbox FK is
`ON DELETE RESTRICT`); removing only the lifecycle row is not valid. Preserve
the fleet node, account bindings, task history and installation ID. Set its
new gateway origin and rotate the node access key so a stale source Agent
cannot authenticate. Stage the replacement key privately; do not place the
application credential-encryption master key on the VPS. Emit the existing
audit-event format for this administrative migration. This is an operator
maintenance action, not a new public owner endpoint.

Old workflows must be unable to create/resume the retired node after cutover.
Confirm the unmanaged broker path produces no Sandbox outbox. Disable the
production Sandbox creation switch when all nodes are migrated; remove the
Sandbox-specific cron only as part of the reviewed application rollout. Keep
old provider credentials/snapshots until recovery verification is complete,
then remove active configuration and retire resources explicitly.

Do not invoke `sandbox-session.ts` to stop the VPS: its VM shutdown path kills
Docker and would stop OpenShip and every other workload on the dedicated host.
Use the Agent's graceful stop and account-container watchdogs instead.

Rollback after new account writes requires first stopping the VPS Agent and
backing up its now-newer profiles; the old Vercel snapshot may be stale. Never
resume the old snapshot alongside the VPS or silently overwrite newer data.

## Acceptance

- Broker sync/recovery with the preserved installation ID and replacement key;
  old key refused, no duplicate leases and no Vercel start calls.
- Actual authenticated viewer: one-use ticket, HTTPS WebSocket, nonblank image,
  keyboard/mouse input and expired/revoked ticket refusal.
- Same account identity and stored session after a VPS Agent/container restart;
  native profile/IndexedDB persistence and cross-account rejection.
- Idle browser termination and preserved volumes, bounded host resource use,
  dispatch after idle, and no interruption of unrelated OpenShip/compute jobs.
- Publication/inbox capabilities remain exactly those previously authorized.
  Moving a browser does not authorize sending messages or publishing content,
  nor prove the outstanding business acceptance gates.

## Reviewed operator tool

`scripts/migrate-browser-vps.ts` uses an explicitly supplied `DATABASE_URL` and
`VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`; it does not discover or
print credentials. Use a private directory (0700), with inventory/plan receipts
0600. The output files must not already exist. Do not run with shell tracing.

Default mode only reads production and writes a private plan:

```sh
node --import tsx scripts/migrate-browser-vps.ts \
  --node-id NODE_UUID --gateway https://browser.example.com \
  --source-inventory /private/source.json --target-inventory /private/target.json \
  --approved-agent-image sha256:REVIEWED_AGENT_IMAGE_ID \
  --output /private/plan.json
```

Review source snapshot/session, restoration receipts, quarantined run IDs and
all deployment readiness before the explicit mutation:

```sh
node --import tsx scripts/migrate-browser-vps.ts --apply \
  --plan /private/plan.json --key-output /private/new-node-key \
  --rollback-output /private/rollback.json \
  --allow-interactive-quarantine-recovery
```

The recovery acknowledgement is needed only when expired interactive quarantine
exists. Any queued/starting/running/stopping work, live publication quarantine,
provider-operation ambiguity, new outbox claim, or drift from the reviewed plan
is rejected. The transaction preserves the complete fleet document and writes
an audit record; it retires only this node's managed lifecycle/outbox and rotates
the gateway/key. The private rollback archive and new key are flushed to disk
before database changes. An error can leave these private artifacts while the
DB rolls back; inspect the database independently before removing artifacts or
planning another attempt. Never blindly retry an ambiguous commit.

This stage intentionally preserves an expired interactive quarantine. Stage the
new key into the already-restored VPS private directory and start the Agent.
Its existing `recover` protocol must perform the stop confirmation and settle
the old quarantine. No SQL in this tool changes run statuses or releases slots.
Immediately after that normal recovery, before submitting new tasks:

```sh
node --import tsx scripts/migrate-browser-vps.ts --verify \
  --rollback /private/rollback.json
```

Verification checks the new key hash/origin, absence of managed state, changed
Agent boot and fresh heartbeat, unchanged account identities/resource limits,
normal interactive-quarantine completion, preserved historical unknown records
and the original provider still stopped at the retained snapshot. It does not
substitute for browser UI/profile/credential/egress acceptance.

For storage fingerprints on the Linux source/target, use
`scripts/browser-vps-fingerprint.py --root SAFE_LABEL=/private/root`. It emits
only label-to-hash JSON, covers every entry and xattr, does not follow symlinks,
rejects special files/unsupported xattr access and detects modifications while
reading. It includes hardlink topology, numeric owners and modes. Export with
numeric ownership and xattrs preserved; mtime differences do not affect hashes.

## Final provider retirement (required for completion)

The retained source snapshot is a temporary cutover safeguard. The final user
requirement is to remove all Vercel Sandbox resources after successful VPS
acceptance. Passing `--verify` above is an intermediate gate, not completion.

Before deletion, preserve the complete rollback archive, exported profiles and
private configuration, image archives, checksums and migration receipts in
private storage on the VPS and locally. Verify both copies. Once browser and
compute acceptance has passed, remove all production paths and settings that
can create or resume a Vercel Sandbox; check scheduled work and old workflows
as well as direct request paths. Do not remove credentials until the final
resource enumeration and deletion have finished.

Enumerate the full Sandbox and Snapshot lists with pagination for every
in-scope Vercel project/team. Include the original persistent browser, the
migration clone, any temporary compute sandboxes, reusable template snapshots,
and any other snapshots belonging to the migrated project. Inventory resource
IDs privately before deleting; do not rely on a browser-name filter that would
miss templates or clones. Use the provider's explicit deletion operation,
not merely stop, and confirm every deletion result. No production deletion is
performed by `migrate-browser-vps.ts`.

Re-enumerate both complete lists after deletion and save dated private evidence
of zero remaining Sandboxes and zero remaining Snapshots per project/team,
including pagination completion. Confirm no replacement resources appear from
scheduled work, then remove unused Sandbox credentials and template IDs from
active deployment configuration. Keep the local/VPS rollback archive according
to the owner's retention policy. After this step, rollback uses those exported
artifacts; the old cloud snapshot is no longer an available recovery route.

Zero resource lists prove provider-resource retirement. They do not prove a
zero historical invoice or instantaneous billing-dashboard refresh; distinguish
already incurred charges from new usage when reporting completion.
