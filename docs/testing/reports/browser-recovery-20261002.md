# Browser snapshot recovery — 2026-10-02

References: #488, #480, #415, #489, #490. Sanitized engineering evidence only.

## Observed failure

At production revision `478021d`, an authenticated interactive request entered the
durable queue at 11:15:53 UTC. Its start operation became `unknown` with no bound
provider session. The request was cancelled through the UI; its ticket was unused
and no lease was acquired. The Workflow completed at 11:58:57 UTC. Provider history
contained no session created after the attempted dispatch.

PR #489 (`016eea0`) added an authenticated read-only diagnostic. In production it
confirmed that ownership, two-vCPU allocation, bounded timeout and network policy
all matched. The selected snapshot was deleted/expired, with expiration
`2026-09-28T16:51:04.901Z`.

The selected snapshot originated from a verification instance with one-day
retention. Setting the receiving instance's future snapshot expiration to 30 days
did not change this existing snapshot's expiration. Snapshot selection must check
the selected snapshot itself; the instance's retention setting is insufficient.

## Recovery safeguards

- Preserve the original instance, independent rollback snapshot and native
  account profile. Never substitute a generic template for a lost account profile.
- Fork an available rollback into a separate deny-all copy with two vCPUs, a
  20-minute session limit and 30-day snapshot retention. Do not start the broker or
  account browser during offline preparation.
- Match the native-profile owner to the database node/account, verify one matching
  profile and a nonempty cookie database, and compare its digest before and after
  preparation. Keep identifiers, profile files and digests private.
- Install the published runtime pair from `dd8240c` (#415). Compare all image layers
  and runtime configuration, including revision, entrypoint, command and environment.
  Docker-archive import can re-encode an image configuration, so use the verified
  imported Docker IDs for deployment configuration.
- Disable the expired automatic-login review for the initial interactive recovery.
  Preserve the private review file. Publishing and inbox capabilities stay disabled.
  Renewing a date alone is not a new page-contract review.
- Stop the copy and inspect the resulting snapshot's actual availability and
  expiration before selecting it on the original instance.
- Before clearing an unbound start fence, require a terminal Workflow, no new
  provider session since dispatch, a stopped owned provider, no queued/live broker
  runs or current leases, and unchanged operation/outbox identifiers. Lock the node
  before the lifecycle row and compare the captured broker-document digest.
  Preserve historical failed/unknown runs and dispatch records; add an operator
  audit event. A stopped provider alone does not justify replaying a resume.

## Preparation results and retained failures

The rollback copy contained exactly one matching native Firefox profile and a
nonempty cookie database. Its cookie digest remained unchanged during preparation.
The existing automatic profile was version 2, observe-only, with an expired review.
Initial recovery therefore uses interactive-only mode.

The first two-image archive command omitted Podman's multi-image option and
incorrectly tagged the nine-layer Agent image as the browser image. Layer-count
verification rejected it before production selection. The archive was regenerated
with `--multi-image-archive`. A whole-buffer upload exited without completion;
bounded chunk uploads were used for the validated archive. A transient transfer error
was recovered from retained chunks. Import initially found the Docker daemon stopped
after the preparation copy had been restarted; starting that daemon allowed import.
All 9 Agent and 28 browser layers and the runtime configuration then matched. These
preparation failures are distinct from application acceptance.

The resulting stopped copy had an available snapshot expiring at
`2026-11-01T13:05:52.258Z`. A guarded selection and lifecycle reconciliation preserved
the original name, node/account binding, restricted policy, historical broker runs
and dispatch history. Both deployment image IDs were read back exactly:

- Agent: `sha256:3dc3a70a276d8e2f825d763b5f0d4cff73437ef62c9a603a833fcffe0f741af0`
- Browser: `sha256:54798df6243eb08f5b2771fc5b35a507cde1fa8b88e55a54abee5d4b19800950`

Production redeployment `dpl_6Jn4phQH6xmVa7K5r8iNVD78kERs` is READY at application
revision `016eea0`, with the production domain assigned. The authenticated UI at
13:09:45 UTC showed stopped, all four preflight checks matching, and snapshot
available. A new UI request was queued at 13:10:01 UTC.

## Acceptance status

The 13:10:01 UTC request reached a bound running Sandbox and Agent at 13:12:34 UTC.
It then failed before viewer admission. The Agent exited and the provider stopped
automatically. A second request at 13:17:13 UTC reproduced that later failure;
read-only observation found the expected browser image created/removed, without
an OOM or recorded container-state error. The copied stopped filesystem was
inspected in an isolated deny-all instance, which was then stopped.

Browser-container logging is deliberately disabled. Attempts to read those logs
produced logging-driver errors only; those errors are not the cause of startup
failure. The existing launch catch discarded the actual stage and response status.
#490 tracks this separate runtime boundary. No ticket was consumed and no viewer
was established. #480 remains open, including automatic login-ready and retirement
after a real viewer connection. No login credential, factor, post or DM was submitted.

## Bounded launch diagnostics

The Agent now logs fixed launch-stage/request enums and a numeric HTTP status. For
a rejected browser response it accepts only an exact allowlisted native-profile
error code; bodies, URLs, stack traces, account identifiers and arbitrary errors
are never logged. JSON inspection is limited to 2 KiB and 250 ms. Failure outcome,
lease enforcement, cleanup and browser-container logging policy are unchanged.

Regression coverage includes private-data canaries in response details, errors and
request paths; malformed/unrecognized responses; oversize and stalled streams; and
the existing read-only hover exception. Type checking passed. The first local
browser regression command omitted the existing browser-cache mount and failed to
launch Chromium; that environment error was corrected before the successful rerun.
