# ADR 0009: retain gateway authorization fixes, retire Firefox 155 candidate

Decision #484, PR #415. On 2026-10-02 the owner cancelled Firefox 155 and delegated selection of the remaining fixes.

Keep the ticket-selected run's exact Origin check, revoke prior capabilities and tunnels on fresh admission, and make disposal idempotent so delayed old socket events cannot disconnect a replacement. Reconnect tickets rotate under the node row lock, remain single use, and require the original owner's same valid login session. Their validity cannot exceed either the lease or run deadline. The settings page requests a fresh ticket rather than replaying a consumed one.

Remove the candidate archive installer/build entry point, forked service pin and backend control lease integration from the final PR scope. The main branch's pinned service, browser images, native profiles, automatic login and viewer retirement policy remain the baseline. This change does not establish mutual exclusion between human input and automation.

The previous candidate experiments and failures remain historical evidence in Git and the candidate audit. The candidate repository/artifacts were inaccessible during this review; no Firefox 155 acceptance or deployment is claimed. The existing application-driven production session, account recovery and inbox conditions remain tracked by #480, #414, #423 and #322.

Validate the retained changes using real loopback HTTP/WebSocket transport, real PostgreSQL authorization/concurrency tests, and the authenticated settings-page reconnect flow with a simulated viewer. These checks establish gateway and application contracts, not production VNC or business acceptance.
