# Current migration decision — 2026-11-01

The owner selected #677: remove jo-inc/camofox-browser and camoufox-js,
use the official launcher, preserve existing account data and Viewer capability.
This supersedes the earlier unselected-proposal status. Real publishing and DM
remain deferred. Current production uses VPS; historical Sandbox gates below
must be translated to the current deployment contract, not revived as a dependency.

The new candidate pairs `camoufox@0.5.9-beta.6` with `v158.0.1-beta.41`.
The installed npm package browser-pin.json independently confirms that pairing;
Playwright remains exactly 1.62.0 within its declared peer range. Linux archive
SHA-256 values come from the GitHub release asset metadata and are checked during
build. The immutable candidate must pass new native-profile and Viewer acceptance;
the historical beta.40 results below do not validate beta.41.

Initial integration: 63 launcher/service/native-profile/Agent/startup tests passed using
`node --import tsx --test`. An initial plain-Node invocation passed 57 and failed
two inbox tests on extensionless TypeScript import resolution; the proper project
loader resolved that setup failure without application or assertion changes.
The existing bounded startup-diagnostics health contract is preserved in the new
service, including sanitized failure states. Frozen root install, targeted Biome,
repository validation and the candidate runtime npm audit pass (zero advisories).
The beta.41 native image build and real-browser acceptance are pending.
No production cutover or account profile access has occurred in this checkpoint.

## Historical beta.40 draft evidence

# Official Camoufox runtime migration (#677)

This plan replaces the pinned jo-inc browser service and `camoufox-js` only after
the new runtime has passed the individual gates below. The separate #675/#676
work restores the browser binary first; the two changes must not independently
modify the same production Sandbox or compete for a live account run.

## Evidence and pairing

- The deployed service source is pinned to jo-inc commit
  `79d425be26743883a06613eaa3be5e38e7ab5409` and uses the separate
  `camoufox-js` package. The application currently owns authorization, leases,
  per-account volumes, egress verification, gateway tickets and result handling.
- The official TypeScript [v158 documentation](https://github.com/daijro/camoufox/blob/v158.0-beta.40/typescript/README.md)
  describes a persistent context and recommends `proxy` with `geoip: true`.
  The official npm package `camoufox@0.5.9-beta.5` declares its paired browser
  as `v158.0-beta.40`; its Playwright peer range and the actual installed
  browser and driver versions must be verified in the built image. Package and
  browser provenance are distinct from the old launcher’s behavior.
- The [v158 browser defaults](https://github.com/daijro/camoufox/blob/v158.0-beta.40/browser/settings/camoufox.cfg)
  include ICE proxy and host-address protections. Source configuration alone
  does not prove a real proxy, DNS, IPv6 or UDP path is leak-free.
- The official `launchServer` does not serve a persistent context and is not a
  visual remote desktop. A bounded local service must hold the context and a
  separate Xvfb/x11vnc/noVNC path must remain behind the existing gateway.

## Contract inventory

| Consumer | Existing interface or invariant | Required replacement evidence |
| --- | --- | --- |
| Agent readiness and egress | `/health`, create/navigate/snapshot tab, exact browser-observed fixed exit, 90-second lease and 10-minute interactive limit | Matching response shapes, account/run binding, prewarm cancellation, proxy failure closed and no direct fallback |
| Human takeover | `/vnc/status`, loopback noVNC WebSocket, one-use gateway tickets, bounded reconnect and viewer retirement | Real viewer input, disconnect and lease-expiry tests; a Playwright socket is not a substitute |
| Login | `/ftrade/login-status`, fill/observe/submit, isolated Playwright pages and reviewed per-account profiles | Same phase and deadline checks, one submission per factor, no credentials in generic events or logs, captcha stop |
| Publication | create/navigate/evaluate, bounded scroll, hover, exact upload selector and type; final action after authorization | Existing identity, audience, attachment and receipt tests, one external submit and unknown-result rules |
| Passive inbox | create/navigate/evaluate and bounded pagination on a scoped account | Existing identity, stable message IDs, direction, completion receipt and deduplication contracts |
| Diagnostics | Interactive scoped event counters, no payloads, headers or full URLs | Same scope, bounds, expiration and zero secret logs |
| Profile lifecycle | Native account/node owner manifest, exclusive Firefox profile lock, isolated volume, private snapshot and watchdog shutdown | No implicit import/reset; wrong owner, symlinks, concurrent access, revocation and restart tests |

The generic service endpoints are not authorization to browse or publish: the
existing Agent remains the caller and continues to enforce the task scope.
Storage-state export at shutdown is a legacy service interaction; the native
profile persists independently and must not be replaced by an incomplete JSON
snapshot.

## Staged implementation and gates

1. Implement a new service behind an explicit non-production opt-in, using the
   paired official package and the existing account ownership and watchdog
   contracts. Retain reviewed login/diagnostics logic without its jo-inc plugin
   dependency. Preserve Xvfb and a separately managed VNC/noVNC process.
2. Exercise the actual replacement HTTP routes and existing drivers with
   synthetic pages and isolated synthetic volumes. Check authorization, timeouts,
   profile locking, single submissions, unsafe paths and shutdown races. No
   real account, proxy secret or message goes into these fixtures.
3. In a native browser, restart the same synthetic profile and verify cookies,
   IndexedDB and non-extractable WebCrypto key continuity. Reject wrong-account
   volumes and simultaneous access. Compare reported identity, timezone,
   language, display, WebGL and other available properties across restarts;
   report changes instead of assuming stability or inventing a fingerprint.
4. Test the paired image with a currently authorized fixed proxy: independently
   record HTTP exit, DNS/IPv6 behavior, ICE/SDP candidates and actual STUN/UDP
   traffic, including a working capture control. GeoIP failure must stop a
   proxied launch. Review current explicit Linux OS, humanization, caching,
   add-on and window choices as separate product decisions.
5. Validate actual VNC/noVNC admission, input, reconnect, disconnect and lease
   expiration under the reviewed Sandbox network policy. Run current login,
   publication and inbox contract suites against the new service, not only a
   fake client or a generic browser launch.
6. Before any production cutover, recheck active tasks and deployments, retain
   a restorable private snapshot, verify the account volumes and image identities,
   and exercise an isolated copy in the real deployment environment. Keep a
   rollback path and make an explicit current-state cutover. Only afterward
   evaluate actual authorized account continuity, Messenger history and DM
   intake separately; none follows automatically from a synthetic pass.

Until these gates have evidence, the existing runtime remains the selected
production implementation. The scope does not include bypassing Facebook
verification, restoring seller-supplied cookies or promising fewer challenges.

## Implementation and current evidence

The draft implements a per-run HTTP service, mandatory fixed-proxy official
launcher, Xvfb/x11vnc/noVNC lifecycle and a standalone image with pinned official
browser hashes. It preserves the existing login/diagnostics integration and
Agent-side task controls. Production still selects the existing image.

The launcher, service, native-profile and Agent unit suites pass (48 tests).
Actual native amd64 and arm64 CI images pass isolated synthetic native-profile
restart (cookies, local storage, IndexedDB and a non-extractable WebCrypto key),
noVNC keyboard input, single-use ticket rejection, expired-tunnel closure and
watchdog expiry followed by another profile restart. The service owns shutdown
ordering instead of competing with Playwright signal handlers.

Additional local standalone-image fixtures exercise the production login flow
through the actual service: password, generated TOTP and stored synthetic PIN
are each submitted once; checkpoint observation, scope rejection, empty inbox
history evidence and wrong identity are checked. The existing publication driver
also prepares text, verifies preview, submits once, rejects replay and observes
its synthetic receipt. Existing inbox/receipt rejection fixtures remain in use.
All pages and credentials here are synthetic, with container networking disabled;
these are not real authentication, publication or DM acceptance.

The initial sampled UA, locale/timezone and window dimensions happened to match
across restarts. A later repeat changed UA and window dimensions. The fixture now
also compares screen geometry, WebGL and WebRTC API availability. The official
launcher generates identity data independently of native storage persistence;
no stable-fingerprint guarantee is inferred and no custom fingerprint is added.
Actual ICE candidates and packet-level behavior still require the authorized
proxy gate.

Correction to the earlier local launch-timeout report: the manual test omitted
the existing production tmpfs mount at `/root/camoufox` (and initially
`/root/.camoufox`). With both mounts restored, the official persistent launcher
works. The image acceptance driver now derives mounts from `containerSpec`
instead of maintaining a drifting manual copy. That earlier timeout is not
reproducible evidence of a production browser defect.

The read-only image must pre-provision the fpgen model, GeoIP database and font
configuration. The implementation excludes the default UBO add-on consistently
with the existing runtime, rather than tolerating an unprovisioned download.
The launcher checks GeoIP freshness before generating options and rejects stale
assets before the official library can attempt a runtime database download.
Refresh requires an image rebuild; a managed rebuild/deployment cadence still
needs to be established before cutover. CI runs 40760771707 and 40761434934 passed
both native architectures. Real fixed-proxy DNS/IPv6/ICE/UDP checks, actual Sandbox
viewer and rollback gates, and separate live account/Messenger/DM acceptance
remain required. CI retains checksummed image pairs for isolated Sandbox tests
without publishing a registry tag or selecting the new runtime in production.

After the validated cutover and acceptance, inventory Vercel snapshots again,
replace old template/recovery references, then delete obsolete snapshots. Do not
infer that a snapshot is obsolete from age alone. Record deleted and retained
storage without exposing private snapshot identifiers in public Issues.
