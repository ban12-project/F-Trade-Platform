# VPS publication submission regression — 2026-11-01

Issue #765. Main `ce8e5f2` reproduces the original
`vercel_sandbox_retired_use_vps` failure at the fixture's `create-sandbox` call.
The supported VPS agent polls durable queued jobs; it does not create a cloud
startup intent for each publication. Merely swapping fixture creation while
retaining outbox assertions would test the retired execution model.

The existing PostgreSQL regression now creates a normal node through the owner
command and registers its installation/capabilities via the real node handler.
Its synthetic account-ready state is test setup, not live account evidence.
The test explicitly confirms retired Sandbox creation remains rejected.

For text, image and video it verifies:

- A trigger rejects the final submission audit after business/job/manifest
  inserts, and the complete relevant snapshot remains unchanged.
- Three concurrent submissions return the same result and persist one job and
  publication, with no Sandbox lifecycle row or cloud outbox intent.
- A node row held by a separate PostgreSQL connection does not block submission;
  queued demand survives and a normal VPS claim recovers it after lock release.
- A failed reservation insert rolls the node and job state back to the submitted
  snapshot. A subsequent real node claim can consume that same durable demand.
- Three concurrent node polls yield exactly one claim/reservation. Replaying its
  request ID returns the same run; a new poll cannot duplicate the live run.
- Known diagnostics receive their expected safe label; private/unrecognized
  codes and prototype keys never appear as raw diagnostics in client results.

The existing CI command remains unchanged. The gate now tests the supported
VPS lifecycle without restoring cloud execution, skipping the suite, or changing
production implementation. Global fetch is rejected; media bytes are synthetic.
No actual proxy, account, browser, publication or customer data is involved.

Validation completed on isolated loopback PostgreSQL 17.11: all 12 grouped
scenarios passed, including the final retired-provider and manifest assertions.
TypeScript, targeted Biome, full repository validation and diff checks passed.
The pre-change failure remains in the local baseline log. Local checks satisfy
the temporary CI policy in #711; this report does not claim deployed business
publication acceptance.
