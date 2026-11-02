# Sandbox cleanup cost guard (#811)

## Evidence and scope

[Official pricing](https://vercel.com/docs/sandbox/pricing) meters provisioned
memory throughout VM lifetime, including idle time, with a one-minute minimum.
CPU is metered by active CPU time. No account-wide measured savings are claimed.
The existing implementation attempted deletion once; failed cleanup could leave
a VM running until its ten-minute deadline. This is a failure-path cost risk,
not evidence that every completed task was leaking resources.

## Change

Normal completion still issues one delete request, including orphan snapshots.
Each cleanup request now has a ten-second AbortSignal. After deletion failure,
stop the original Session before retrying deletion. Maximum sequence: delete,
stop, delete. There is no VM resume, command rerun, or cross-provider retry.
A 404 delete response is treated as already absent.

If stopping succeeds but deletion still fails, emit a bounded cleanup warning
without failing a completed business operation: the nonpersistent VM is stopped.
If neither stop nor deletion is confirmed, emit a failure and preserve the
server-enforced ten-minute deadline as the last fallback. Apply the same cleanup
to failed runtime initialization. Application termination can still bypass code;
the deadline remains essential.

Do not reduce heavy render resources or deadlines without workload benchmarks.
The previous real render took approximately 342 seconds. No warm pool, snapshots,
paid monitoring plan or periodic cleanup job is introduced. No budget pause is
configured without an agreed threshold and availability tradeoff.

## Validation

- Failure injection covers initial delete success, retry recovery, successful
  stop with failed delete, total failure, already absent and log privacy.
- Existing provider/session/egress/initialization regressions and TypeScript pass.
- One live one-vCPU synthetic `true` command and cleanup completed in about
  3.35 seconds; no expensive video rerender was used. Minimum billing granularity
  still applies to this short test.
- Production build and changed-file Biome checks passed.

Creative review does not apply: lifecycle and diagnostics only; no composition,
caption, prompt, CTA, facts, media selection or encoding changes.
