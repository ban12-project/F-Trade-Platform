# Synthetic Workflow v5 integration fixtures

Run `node --test scripts/test-workflow-v5-runtime.mjs` after installing the root dependencies.

The test copies all four production workflow source files byte-for-byte into a temporary project and uses the installed v5 SWC/esbuild compiler and combined runtime entrypoint. Fresh runs execute through the real local World, queue, step receipts, durable waits, retry and terminal events. No historical run is replayed in v5. Generated bundles and world data are deleted afterward; the app's `.next` and production storage are untouched.

`runtime.ts.txt` provides minimal synthetic step, sleep, retry and fatal-error workflows. `adapters.js.txt` replaces business infrastructure imports only through the temporary project's TypeScript path aliases. It records calls and provides explicitly synthetic outcomes. Both fixtures use `.txt` extensions to prevent production compiler discovery and are copied to executable extensions only in the temporary project. HTTP fetch is forbidden during execution.

Covered application control flow:

- Human Gate: wait and lazy metadata, duplicate-token ownership, approved/rejected decisions, and rejection of an agent actor.
- Browser sandbox: dispatch, real durable observation sleep, observe stopped/superseded, uncertain-dispatch recovery, and waking queued work only after a running session finishes. The first observation case lets the unchanged 15-second sleep expire naturally and verifies `wait_completed` precedes observe/wake step execution. The SDK's `wakeUpRun` interrupts the wait in the other cases without changing workflow source.
- Catalog: candidate success, rejected output/provider failure/access failure, document parsing/source failure, and duplicate-claim suppression.
- Video: AI draft and render success, real SDK step retry after a transient adapter error, guard invocation, stale draft, retention expiration, failure after entering rendering, and terminal-job idempotent suppression.

These are orchestration tests, not proofs of database transactions, real authorization, retention enforcement, provider compatibility, media quality, schema validation, or factual correctness. Those remain the responsibility of domain/database tests. The video fixtures do not generate or change marketing content, prompts, storyboards, or creative requirements; creative review does not apply to this infrastructure-only test.

A separate transport-contract test calls the actual v5 `resumeHook` with frozen v4 hook/run records and a recording World. It verifies old deployment/spec routing and durable event-before-wake ordering. It does not invoke the v5 executor for the old run or imply that v4 histories are v5-replay-compatible.
