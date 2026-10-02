# Durable upload reconciliation (#485 / #307)

Server-managed evidence uploads reserve an immutable private path in `evidence_upload_intent` before writing bytes. Evidence and `attached` status commit in one PostgreSQL transaction. Each upload remains independent; hashes do not grant ownership or cross-project access.

| State | Meaning | Maintenance |
| --- | --- | --- |
| upload_pending | Storage write or its bookkeeping has not completed | Report as uncertain; never delete |
| uncertain | Upload/transaction outcome is unknown | Reconcile an existing evidence reference; otherwise retain for operator investigation |
| cleanup_pending | Storage acknowledged; evidence insert definitely rolled back | Under the intent row lock, recheck references, retry idempotent deletion, then mark cleaned |
| attached | Evidence is committed | Preserve bytes |
| cleaned | Definite orphan deletion confirmed | No further deletion |

Unknown outcomes do not become cleanup candidates merely because an object or row is absent on one read. Attachment and cleanup serialize on the same intent. The writer refuses cleanup/cleaned states. Errors contain no provider messages, object keys or credentials in maintenance output. Failed deletion or commit leaves durable retry state; unfinished uploads survive process restarts as pending/uncertain records.

## Operation and rollout

Apply additive migration `0042_evidence_upload_reconciliation.sql` to the verified target database **before** deploying this application revision. Old application versions ignore the new table, so application rollback does not require deleting it. The migration does not read or modify existing evidence or business records.

With the intended environment already selected, preview aggregate counts:

```sh
node --import tsx scripts/reconcile-evidence-uploads.ts --dry-run
```

Explicit maintenance:

```sh
node --import tsx scripts/reconcile-evidence-uploads.ts --apply
```

Each apply processes at most 100 unresolved records last checked at least 30 minutes ago. Errors rotate to the back for later retry. No scheduler is installed. Unknown writes are retained for private investigation; this command cannot authorize their deletion. It never lists or deletes untracked historical objects, recovers missing original bytes, or repairs #463. Existing browser-direct upload receipts remain their own durable protocol and are not swept by this job.

## Verification

`scripts/test-evidence-upload-postgres.ts` invokes the reconciliation fault suite against dedicated loopback PostgreSQL with full migrations and synthetic storage. Coverage includes intent-before-write, lost storage acknowledgement, real PostgreSQL CHECK rollback, delete failure and lost delete acknowledgement, concurrent cleanup, referenced-object protection and maintenance during an unfinished upload. The existing real-commit/lost-response test and cross-project/provenance checks remain required.

Local PostgreSQL 17.11 and Node 24.21.0 passed these checks and TypeScript. The initial TypeScript check caught an overly narrowed status union; the explicit reconciled-state union fixed it before validation. Factory source authorization and real original-file acceptance remain open in #307.
