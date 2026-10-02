# Current-runtime gateway reconnect — 2026-10-02

Decision #484 narrows PR #415 to the existing runtime. Firefox 155 candidate acceptance is cancelled, not passed. The candidate service, image build and input-control changes are absent from the final diff against main `0ab3288`.

Local Node 24.21.0 checks:

- 92 scheduler/protocol/node/egress/HTTP/WebSocket/lease tests pass. The real loopback gateway rejects another slot's Origin, closes the old tunnel and denies its assets on fresh admission, and preserves the new connection despite late old-socket cleanup.
- PostgreSQL 17.11 with full migrations passes eight assertion groups, including original owner session, expired ticket/lease, missing session, revoked account, replaced/consumed tickets and one successful concurrent consumption. The existing three paired locking experiments retain their expected 2 distinct leases versus 7 duplicate deliveries without the row lock.
- Paired gateway control ablations pass their expected outcomes: full 7/7; removing admitted-run Origin or WebSocket Origin each exposes one failure; removing active tunnel expiry exposes two. The harness count was corrected from the stale six-test expectation to seven.
- TypeScript and changed-file Biome pass (existing warnings only). Production Next.js/Turbopack build succeeds after network access is available for the existing Google Font dependency.
- Both production-build settings-page browser tests pass, including fresh iframe ticket delivery, old-ticket rejection, fresh-ticket admission and the existing saved-login flow (2/2, no retries).

Initial local setup failures are retained separately from application behavior: the package-manager wrapper attempted to alter the read-only dependency mount; the offline build could not fetch Geist; the first browser launch lacked the existing Chromium cache mount. The local runner then invoked the same installed Next.js directly and mounted the existing browser cache. No production settings, dependencies or lockfile were changed.

The first reconnect UI assertion read the old iframe immediately after clicking; the test now waits for a nonempty, changed ticket before admission. It does not extend product lease deadlines or reuse consumed tickets. The settings-page regression uses real application authentication, Server Actions and broker HTTP endpoints with synthetic principals and a simulated viewer. It does not establish real production VNC acceptance (#480), account recovery or inbox behavior.
