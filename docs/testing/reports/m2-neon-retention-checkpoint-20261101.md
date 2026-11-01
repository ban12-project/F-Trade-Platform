# M2 retention checkpoint — 2026-11-01

Related to #122. The existing GitHub sign-in restored the Neon console session.
Read-only inspection of F-Trade-Platform's default `production` branch found
one branch, one database and one compute. The current plan is Launch (the old
Free observation is historical). History retention remains six hours; Backup
& Restore reports no snapshots and no schedule. No configuration was changed.

At approximately 03:15 UTC, two SQL batches used `BEGIN READ ONLY`, a ten-second
local statement timeout and `ROLLBACK`. They selected aggregates only, without
customer contents, IDs, source bytes or credentials. Both batches completed.

| Object class | Count | At least 90 days old | Earliest created_at + 90 days (UTC) |
| --- | ---: | ---: | --- |
| Video aggregate | 6 | 0 | 2026-12-17 06:37:18.745975 |
| Generated video asset | 6 | 0 | 2026-12-17 06:49:21.333500 |
| Working evidence | 9 | 0 | 2026-12-17 06:37:18.684472 |

Working evidence was limited to the existing `marketing-upload:image`,
`marketing-upload:video` and `internet-search:wikimedia-commons:private-test-only`
source labels. These counts do not distinguish real from synthetic objects,
assert rights validity or establish Blob byte availability. The cleanup queue
group-by returned no rows. The review-link query found zero links with a video
or evidence older than 90 days, or a parent whose type is not video.

## Evidence limits and next conditions

- There is no naturally 90-day-expired sample in these queried classes at this
  checkpoint. Do not change creation dates to manufacture deletion evidence.
  December 17 is the earliest observed age-based deadline, not a guarantee of
  future queue state or a substitute for earlier rights revocation handling.
- The console project/branch was inspected directly. The current deployed
  application's database endpoint was **not freshly matched** in this check:
  the earlier CLI environment export redacted its database URL and the attempted
  direct SQL connection failed before reading data. The successful console
  queries supersede that failed attempt only for this named database branch.
- No production restore, branch copy, deletion, cleanup endpoint, snapshot or
  retention-setting mutation was executed. Production PITR, post-restore
  enforcement and physical deletion of historical/provider copies remain open.
- A partial SQL typing operation timed out before execution. The full read-only
  batch was pasted and visibly checked before Run; the console confirmed all
  statements including ROLLBACK. It was not recorded as a successful query until
  results were visible.

Private project/branch/endpoint identifiers and raw UI observations remain out
of GitHub. This checkpoint does not close #122 or MVP1 acceptance.
