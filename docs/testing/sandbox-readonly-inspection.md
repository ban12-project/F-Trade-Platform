# Authenticated read-only Sandbox inspection

Related to #488 / #480. The production start recorded on 2026-10-02 reached an
unbound unknown state while read-only provider inspection found the existing
instance stopped. No viewer connected. The queued test was cancelled. The cause
was not established and neither issue is closed by adding diagnostics.

The settings panel now offers an explicit read-only check. The Server Action
authenticates the current user and checks settings permission; the domain function
validates the strict shared Zod input and verifies active node ownership and
managed registration before provider I/O. It reads the same configured network
policy and preflight checks used by the actual resume path, then calls only
`Sandbox.get({ name, resume: false })`.

The response contains an observation time, coarse cloud state, and four booleans:
ownership, resources, timeout and exact network-policy match. Invalid settings,
provider authorization failures and unavailable provider results return fixed
categories. No policy contents, node keys, private URLs, session IDs, account
identifiers, raw exceptions or provider responses leave the server. Inspection
does not start/stop compute, reset the lifecycle or claim login credentials.

Further read-only evidence identified the selected current snapshot as deleted,
with expiration at 2026-09-28 16:51 UTC. This is a definite resume blocker; the
original caught exception is still unavailable. The selected snapshot originated
from a verification instance with one-day retention, even though the destination
instance's future snapshots were configured for 30 days. Referencing a snapshot
does not establish a new retention window. Inspection therefore also checks the
selected snapshot's availability and expiry without returning its identifier.
An existing stopped rollback copy has an available snapshot; recovery must retain
account ownership, verify its contents and preserve the original rollback record.

Local validation: TypeScript, 13 provider tests and real PostgreSQL lifecycle tests
pass. Added checks reject foreign/missing/extra-field requests before provider
access; verify no lifecycle writes, policy mismatch and secret-safe failures.
The first type check identified missing node IDs in the synthetic UI fixture;
the fixture was updated and the check passed. CI also exercises an unauthenticated
inspection request through the actual Server Action and keeps the unknown-state
warning visible. A production inspection is still required after deployment.

First CI passed the new inspection browser check and 48 database browser cases,
but an existing legacy-link assertion found both a hidden retained page and the
visible page. Its assertion now requires exactly one visible warning, preserving
the user-facing requirement while accounting for retained navigation state.
