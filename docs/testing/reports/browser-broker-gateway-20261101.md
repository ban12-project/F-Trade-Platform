# PostgreSQL broker to gateway admission — 2026-11-01

Related to #480. Earlier [gateway lifecycle tests](browser-lifecycle-isolated-20261101.md)
used real loopback sockets but a synthetic admission broker. This adds a separate
integration using the production `handleBrowserNodeRequest`, migrated PostgreSQL
17.11, production gateway HTTP handler and an actual WebSocket upgrade to a
synthetic loopback upstream. No application source changes were needed.

## Verified boundary

The fixture inserts synthetic owner/session/node/run rows into a dedicated local
`browser_gateway_test` database. Node keys and viewer tickets are generated per
case; their hashes are stored using the production helper. A live local gateway
calls the production broker directly, with its real transaction and row lock.
It does not replace session authorization, ticket checks or audit writes.

- Eight concurrent HTTP admissions with one ticket produce exactly one HTTP 200
  and seven 403 responses, one durable `browser_interactive.connected` audit,
  a consumed ticket and one working upstream WebSocket connection. A later
  ticket replay is denied.
- Expired and deleted sessions, banned and demoted owners, revoked nodes,
  rotated node keys, expired leases, expired tickets and stop-requested runs
  each produce HTTP 403, no connection audit, no upstream upgrade and an
  unchanged broker document. Transactions do not consume denied tickets.
- A local ablation removed only the admission session-validity guard. The
  concurrent positive control still passed, but the expired-session case
  failed because admission incorrectly succeeded. The production source was
  restored byte-for-byte; this ablation is not committed.

All ten integration cases and the existing nine loopback gateway lifecycle
cases pass with the restored source. Typecheck, targeted Biome and full
repository validation pass. The manual Facebook-worker workflow includes the
new test and a separate synthetic database; its workflow-dispatch-only trigger
remains unchanged under #711. No new CI execution or final MVP acceptance is
claimed.

## Reproduction

Against a disposable PostgreSQL instance, create `browser_gateway_test` and run:

```sh
BROWSER_GATEWAY_TEST_DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:5432/browser_gateway_test \
  node --conditions=react-server --import tsx scripts/test-browser-gateway-postgres.ts
```

Only that database name and loopback IP are accepted. The script migrates the
database, removes its mutable fixture rows, and preserves append-only audit.
Drop the dedicated database after inspection; never relax the audit trigger.

## Initial failures and limitations

Initial local setup tried the previous test instance's old port and guessed
roles; connections were refused. That owned instance was stopped and a new
loopback-only cluster with an explicit synthetic role was created. Initial
fixture authoring exposed CommonJS top-level-await and JavaScript-module typing
errors, corrected before execution. The first successful admission then hit
append-only audit protection in test cleanup. Cleanup now leaves those synthetic
audit rows for disposal with the dedicated database. An ablation preflight also
found two session checks rather than one; only the admission check was removed
for the actual controlled experiment.

This does not execute the production HTTP broker adapter, user-facing login,
real VNC/RFB rendering, reverse proxy, Docker stop, or a live account. Revocation
here is established **before admission**; this does not promise immediate
session-revocation delivery to an already admitted tunnel. Existing local lease
and slot-revocation tests remain separate evidence. #480 stays open for its
full deployed refusal/revocation/retirement matrix and account acceptance.
The dedicated local database was dropped after verification and its owned
PostgreSQL server stopped. No credentials, account profiles, customer messages
or production data were used.
