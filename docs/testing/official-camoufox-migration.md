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

## Initial adapter evidence

The official launcher adapter and its synthetic tests cover fixed-proxy GeoIP,
native-profile ownership and lease checks. They do not implement the HTTP
service, VNC, or any end-to-end acceptance gate above. The adapter is not wired
into the production image.

An isolated read-only image test failed before browser launch: the official
package needs its profile directory and pinned fpgen model provisioned before
the filesystem becomes read-only. Its default add-on also attempts a runtime
download when absent. The eventual image must provision and verify its required
assets during the build, and explicitly decide its add-on policy; a writable
runtime filesystem or silent download failure is not proof of readiness.
