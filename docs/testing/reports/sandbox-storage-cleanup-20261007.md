# Sandbox snapshot cleanup — 2026-10-07

Refs #528, #529 and the retained-state requirements in #494 / #495.
The owner requested removal of unused Sandbox resources contributing to Snapshot Storage.

## Verified result

| Resource | Before | After |
| --- | ---: | ---: |
| Project sandboxes | 20 | 1 |
| Created snapshots | 15 | 2 |
| Sum of created snapshot `sizeBytes` | 237,519,343,801 | 47,177,042,518 |

Nineteen stopped, unregistered one-off, verification, maintenance and superseded backup
sandboxes were deleted. Thirteen unused snapshots were then explicitly deleted.
The created snapshots' reported size fell by 190,342,301,283 bytes (190.34 decimal GB,
80.14%). These figures sum provider metadata; they do not establish immediate physical
storage reclamation or a refunded charge for the elapsed billing period.

## Preservation and checks

Read-only application registration identified one active browser node. Provider metadata
and the reviewed installation report identified its selected current snapshot and the
immediately preceding rollback snapshot as resources to retain. A stopped provider alone
was not treated as evidence that its account state was disposable.

The cleanup used an explicit project-scoped inventory. Before deletion, it rechecked
application registration, stopped status, session identity and selected snapshot against
the captured candidates. Each snapshot deletion was preceded by a fresh sandbox-reference
check. Sandboxes were deleted without automatic orphan-snapshot deletion, so protected
snapshots were governed by the explicit retention list.

Final provider reads at 2026-10-07 09:52:57 UTC confirmed one remaining sandbox and exactly
two created snapshots. Every targeted snapshot reported `deleted`. The original sandbox
remained stopped with its captured session, selected snapshot, ownership tags, timeout
and snapshot-retention settings unchanged. Both protected snapshots remained `created`.
No session was resumed and no application or account operation was executed.

Repository validation passed using a temporary Python environment with its required YAML
and JSON Schema dependencies. Raw provider inventories, credentials and account identifiers
are excluded from this report. The temporary production environment export was removed.

## Separate pre-existing risk

Before cleanup, production's `BROWSER_SANDBOX_TEMPLATE_SNAPSHOT_ID` pointed to a snapshot
already marked `deleted`, with expiry 2026-10-01 14:33:11 UTC. This affects the source used
for new-node provisioning; it does not establish that existing-node resume is blocked,
because the retained current snapshot is available. Follow-up #529 records the need for
a reviewed credential-free template and deliberate retention. Template configuration was
not changed by this cleanup.

Lifecycle and deletion behavior were checked against the installed `@vercel/sandbox` 3.2.1
SDK and the current [Vercel snapshot documentation](https://vercel.com/docs/sandbox/concepts/snapshots).
