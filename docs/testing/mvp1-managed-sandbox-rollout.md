# MVP1 managed Facebook Sandbox rollout and acceptance

This runbook applies to the existing, persistent single-account Vercel Sandbox. It does not authorize a new Facebook post, DM, production credential submission, or a change to the account's approved audience. Keep those actions inside their separate reviewed acceptance scopes.

The [current acceptance status](mvp1-acceptance-status.md) maps each gate to its evidence. As of the 2026-10-15 checkpoint, local Podman, the credential-free template, whole-VM synthetic restoration and original-instance staging passed; the live account encountered human verification. The owner deferred that verification and real-account acceptance. Keep that scope paused until resumed, then recheck current snapshots, configuration and review validity before following the sequence below.

## Credential-free template replacement

Replacing an expired new-node template can preserve the current account runtime when the template contains the exact image IDs already selected in production. A source rebuild usually produces different IDs. Do not change the global image settings just to make a new template pass: existing-account resume consumes those settings too.

`scripts/build-browser-sandbox-template.mts` accepts an optional local image-bundle directory. It uses the `manifest.json`, `checksums.sha256` and `tested-images.tar.gz` contract emitted by `scripts/export-browser-image-pair.sh`. Review the bundle's origin and source commit first; adjacent checksums establish transfer integrity, not provenance. Both images must be amd64 and share the declared commit. The source config digest must match the hashed archive config. Docker image stores can expose a different destination-local ID: verify every config field, the ordered RootFS layer digests and platform against the archive, then verify that the destination ID is addressable. Record both IDs and select the inspected destination-local IDs; a matching tag or revision label alone is insufficient. The builder packages committed runtime files and smoke fixtures from that image commit, reports its own builder commit separately, and refuses an archive with additional images. It imports in bounded chunks, removes the archive before snapshotting, runs smoke under deny-all, and verifies that no account volumes or node credentials exist. It always starts from a fresh provider base image; an account-bearing snapshot is never a template source.

Run local Podman verification first. Then run `BROWSER_TEMPLATE_EXPIRATION_DAYS=30 pnpm exec tsx scripts/build-browser-sandbox-template.mts <reviewed-bundle-directory>` with the existing deployment authentication. Retention is explicitly bounded to 1–30 days (default 7). Run `scripts/test-browser-sandbox-template.mts <builder-result.json>` to verify actual provider creation and whole-VM native-profile restoration. Select a template only after its two verified destination-local image IDs match the staged original instance and production configuration and its expiry is recorded. Update the template ID, deploy, and read back the production selection. Plan replacement before expiry. Existing-account image upgrades still require the staged rollout below; template acceptance does not establish the newer runtime, real publication or inbox acceptance.

## Release preflight

1. Select the merged runtime release and verify its required checks, successful image-publishing workflow and final `main` application deployment. Record the runtime image revision separately from the application and template-builder revisions. A green pull-request build does not publish images.
2. Confirm the named production Sandbox is **stopped**, its node tags match the broker record and no running/stopping account lease or unreconciled unknown result remains (preserve original unknown receipts that already have a complete scoped human reconciliation chain). Record its current snapshot ID and the deployment/image IDs without recording credentials or Facebook content.
3. Make a separate, access-restricted backup fork of that stopped Sandbox and verify it is stopped. Its snapshot must retain the original account volume for rollback. Do not make a reusable template from the account's profile, and do not rely on the source Sandbox retaining an older snapshot: its `keepLastSnapshots` policy evicts prior snapshots.
4. Recheck the private publication and login page-review expiry. A successful read-only Messenger ready-path review does not extend an expired password/TOTP/PIN review. Use the explicit `observe-only` login mode for a current ready-path profile; it may return `ready` without releasing credentials but refuses all factor submissions. Leave recovery disabled until every recovery selector is freshly reviewed. The production inbox manifest remains disabled until a separate reviewed inbox profile and controlled inbound-message test exist.

## Network policy deployment gate (#459)

Managed Sandboxes use `allow-all` networking. On resume, the application clears any previously stored allowlist before starting the existing Sandbox. No network-policy environment variable is required. Account proxy configuration and browser-session actual-egress verification remain required.

Creation passes that explicit policy. Resume first uses `resume:false` and compares returned policy metadata against configuration, normalizing object key order only. Arrays and rule/transform order remain significant; semantically equivalent but differently represented policies require reconciliation. Missing SDK metadata is unknown and refuses resume, even if a historical snapshot was restricted. Returned create/resume metadata must also match before runtime credentials are dispatched. A response mismatch leaves the operation uncertain for existing reconciliation; do not repeat provisioning or automatically rewrite the policy.

Recorded-session monitoring and stop/reconciliation remain available without this new setting. Before merging/deploying, verify the actual SDK returns the reviewed policy in the isolated environment and prepare a coordinated production configuration migration; otherwise existing automatic wakes will fail closed. Do not use `"deny-all"` as a production substitute for unknown policy. It is appropriate only for explicitly offline tests. Do not call a policy update endpoint merely to obtain evidence of the previous policy.

## Stage the original Sandbox

Keep the node's dispatch exclusion active throughout maintenance. If an operator script holds database row locks during a transfer, set and verify a bounded transaction idle timeout for that connection, maintain liveness, handle connection errors and stop only the captured provider session when the exclusion is lost. A database disconnect releases its locks; it must not leave an unobserved upgrade running. After an interrupted transfer, verify the actual stopped session and snapshot before resuming, and reuse a chunk only when its hash matches the same verified local archive.

1. Resume the **same named Sandbox** through the administration channel, without starting its Agent. Start Docker as root using the reviewed cgroup preparation script. Require no running containers. Verify the sole `ftbrowser-<node>-<account>` volume belongs to the expected node and account; also retain `ftrade-browser-sandbox_node-state` with the matching Compose project and volume labels. The account volume is not the only Docker volume. Reject unexpected volumes and preserve them for inspection; never prune to make the inventory pass.
2. From the published final commit, pull the Agent and browser images by their reviewed GHCR digests, or load the exact CI image bundle already verified locally and in the credential-free template. For a bundle, verify its trusted artifact digest, archive checksum, OCI config and all root filesystem layer identities. Inspect each destination-local `sha256:` image ID, architecture and source-revision label; the browser must also carry `io.ftrade.native-profile=1`. Docker's archive-manifest IDs can differ from Podman's config IDs: record the mapping from verified archive bytes, rather than treating unlike IDs as equivalent. Keep the previous local images until acceptance completes. The Sandbox startup contract consumes **local image IDs**, not registry tags.
3. Stage the final `start-sandbox.sh`, `compose.sandbox.yaml`, `native-profile-mode.sh` and cgroup helper from that same commit into `/vercel/sandbox/source/ops/browser-node`; compare their hashes with the reviewed source. A new application deployment does not update scripts frozen in an older Sandbox snapshot.
4. Back up the account volume first. For an already migrated native profile, verify its existing owner manifest, bound node/account identity, permissions and completed import; preserve it without calling `initializeNativeProfile` again. Only a separately reviewed first migration from legacy JSON may call the reviewed browser image's initializer once with `source: "legacy-json"` and the bound identities. Confirm the owner manifest and unchanged legacy JSON digest. Do not choose `empty`, reset the profile, create a new account volume, or retry initialization on a partial result. Fingerprint both persistent volumes and private runtime configuration before and after an image-only stage to verify that their contents remain unchanged.
5. Set the root-owned `0600` `/var/lib/ftrade-sandbox/facebook/native-profile.enabled` marker to exactly `1`. Stage only current, account-scoped private profile files and atomically update `manifest.json` last. Leave `inbox:false`; set `login:true` with `mode: "observe-only"` only when the ready-path review is current and verify factor routes refuse submissions. Do not place private profiles or factors in Git, a generic template, command output, or logs.
6. Freeze Docker, request stop on the captured provider session, and read back that same session until it is stopped with a created snapshot. A returned stop request can still be snapshotting; do not restart staging to resolve that observation. Update the production application's `BROWSER_SANDBOX_AGENT_IMAGE_ID` and `BROWSER_SANDBOX_BROWSER_IMAGE_ID` to the inspected **local IDs** and select the matching verified credential-free template, then redeploy the final `main` build so the controller uses those values. Before queuing a task, verify the deployment, template and staged image IDs agree. A mismatch must fail closed; do not let the controller wake the old Agent.

## First native profile for a new account

Native-profile mode is enabled per node; storage belongs to each account. Newly
saved bindings receive a server-owned first-use grant. An authorized interactive
claim carries that grant to the native runtime. The Agent verifies the Docker
volume's returned node/account labels; the runtime initializes only a completely
empty volume, with a live lease and exclusive directory creation. It does not
submit credentials or change login-review scopes. The first ready heartbeat
consumes the grant before issuing viewer access or login authorization. Updating
an existing account never reissues it. A pre-ready failure may retain the grant,
but nonempty or partial storage is never overwritten, and a runtime instance
checks initialization only once.

Historical bindings without that grant continue to require an existing profile.
Missing historical storage, mismatched volume labels, partial initialization and
invalid manifests fail closed. Do not reset them or infer a new account solely
from a missing directory. Existing newly added accounts from before this rollout
can use the reviewed maintenance procedure below after independent first-use
checks; they are not automatically reclassified.

For an explicitly new account only, verify ownership, zero prior connected runs,
no live/queued leases, and an existing, empty account volume with matching node
and account labels. A missing volume or any existing contents require separate
investigation or the existing-profile migration procedure. Never infer that an
account is new merely because its profile is absent.

During a bounded maintenance resume of the same owned Sandbox, with Agent and
browser containers stopped, run the reviewed helper as root:

```bash
bash ops/browser-node/initialize-empty-native-profile.sh \
  --new-empty-profile "$NODE_ID" "$ACCOUNT_ID" "$REVIEWED_BROWSER_IMAGE_ID"
```

The helper requires an immutable local native-profile image and an already
existing volume with exact ownership labels. It refuses attached containers and
nonempty storage, uses network-none maintenance with volume copying disabled,
and calls only the image's explicit initializer. It neither starts Firefox nor
changes existing account profiles. Verify the new private owner manifest, retain
before/after fingerprints for existing profiles, then freeze Docker and stop the
captured session. Confirm its completed recovery snapshot before queuing the
account through the normal application UI. Subsequent starts reuse this profile;
do not rerun initialization after any partial or completed result.

## Acceptance order

1. Start only one interactive session for the bound account. The Agent must first check the existing profile, fixed HTTP-proxy egress and account identity. A current reviewed session-first profile should produce a durable `ready` result with **zero broker credential claims** and no password/TOTP/PIN submission. A loading page, network error or CAPTCHA is not evidence of logout; CAPTCHA requires human attention and cannot cause a login loop.
2. End that task, create a new task on the same account and inspect its new container and run IDs. Repeat the zero-claim `ready` result. Then stop the node and Sandbox, resume the **same named Sandbox**, and repeat once more. Verify the account volume/owner manifest, Messenger readiness, proxy egress, absence of factor prompts and each application's run/receipt record. Empty Chats proves readiness only, not history recovery or inbound DM ingestion.
3. Only after the session gate passes, run one separately approved private **text** publication with current account, audience and exact payload review. The application must show the same job moving through authorization, one click, a newly observed canonical permalink and durable `published` receipt. Keep the existing manually confirmed `unknown` run as historical audit data. Never retry an ambiguous click; inspect and reconcile it separately.
4. Keep video and inbox capabilities disabled until their own reviewed contracts exist. Video needs current licensed/approved media, active composer and audience checks after attachment, one click and an application receipt. Inbox needs a controlled inbound message from an authorized sender, a reviewed thread/message identity contract, persisted capture, repeat-poll deduplication and RFQ association. An empty inbox or synthetic fixture is insufficient. Verify the five-minute cold-start wake after the reviewed polling scope becomes due.

## Failure and rollback

If any identity, proxy, image, lease, profile ownership, review expiry or receipt check fails, stop new jobs and preserve the account volume and application evidence. Do not silently fall back to a new Firefox profile or retry a publication click. Disable the affected capability in the private manifest before a new Agent start.

For a runtime rollback, first stop the Agent and all account containers, then restore the prior application deployment and matching previous local image IDs/scripts from the recorded versions. Reconsider the native-profile marker account by account: the retained legacy JSON is a pre-migration snapshot and may be stale, so disabling the marker is not a safe automatic rollback. Use the protected pre-migration backup only after reconciling any activity that occurred since migration. Retain the backup through the session/text rollout window and verify its expiration; a later DM/video rollout requires its own current backup.
