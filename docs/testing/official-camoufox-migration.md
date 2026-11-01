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
The candidate canonical browser build and VPS release build now use the official
service directly, without an upstream source fetch/base image. The removed source
patching/cache machinery has no production consumer. Existing receipt/inbox and
full-DOM inspection tests run against the new HTTP service; legacy test entrypoints
redirect to that suite. Both pre-initialized and broker-authorized first-use profile
paths remain covered. Ten release/rollback tests and the offline exact Agent-payload
smoke pass. Initial Agent-payload invocation before staging deleted source files
failed on its git-index manifest; staging the intended deletion resolved that setup
failure. The 82-case launcher/service/profile/Agent/Viewer/egress suite passes.

The initial beta.41 image built successfully after checksum verification and asset
preparation. It was created from an earlier context snapshot and is not the final
candidate. The integrated amd64 candidate has now passed native acceptance, including both
pre-initialized and broker-authorized first-use profiles. Synthetic beta.40 profile
copy upgrade and untouched-baseline rollback also pass. Network checks and production
cutover remain pending; synthetic results do not establish live account acceptance.
No production cutover or account profile access has occurred in this checkpoint.

## Integrated candidate failures and limits

The canonical build reached actual binary output `Camoufox Camoufox 158.0.1-beta.41`.
Initial image fixture setup supplied `initializeNativeProfile: false`, which the
existing container contract correctly rejects (only absent or true is valid).
The fixture now omits the field unless explicitly testing first use. A subsequent
local seccomp path used macOS `/tmp` rather than its shared `/private/tmp` realpath;
canonicalizing the path fixed that setup error without disabling the policy.

After a VM restart, Podman reported missing candidate images and invalid overlay
links. Read-only `podman system check --quick` identified 17 damaged image records,
all independently matched to this turn's build logs, with no container references.
Only those exact owned candidates were removed with `--no-prune`; the older image
store and account volumes were not reset. One unaccounted storage-driver layer
remains reported. Rebuild succeeded, but this is not a general Podman repair claim.
An explicit live VM session and `sync` now keep the test environment observable.

Real image testing exposed a packaging defect before browser launch: the prior
flat cache lacked the official compatibility marker, causing attempted cleanup
on a read-only filesystem. Adding only the marker was insufficient: the paired
version resolver also requires an active versioned installation. Preparation now
registers the checksum-verified archive under the official versioned layout,
records its supported interface, calls the official active-version helper, and
asserts both resolved directory and full version before provisioning assets.
The rebuilt candidate passed actual native tests with the runtime root filesystem
protection enabled. The initial codec canvas readback failed under official canvas
randomization; the fixture now checks four pixels from the compositor screenshot
without disabling that protection, and verifies the decoded 128×72 video dimensions.

Actual image coverage includes H.264 pixels, unchanged DOM inspection assertions,
login authentication and lease denial, native storage/keys, first use, noVNC input,
ticket replay/expiry, watchdog shutdown and kernel resource bounds. The dedicated
upgrade fixture creates two disposable volumes: beta.40 writes the synthetic
baseline, beta.41 reads a copy across restarts, then beta.40 rereads the untouched
baseline for rollback evidence. It never accepts an existing account volume.

The tested local amd64 browser image is
`sha256:6cfab22129d64cc96fab27bf46c8ace6eaefda79484b7304d8b2032b2a5cf51d`.
Actual binary output confirms beta.41. Both profile initialization paths pass
H.264 rendering, unchanged full-DOM negative controls, synthetic login/publication/
inbox contracts, storage and non-extractable-key restart, noVNC keyboard input,
ticket replay/expiry, and watchdog shutdown followed by restart. Peak observed
memory was 1,930,506,240 bytes under the 2 GiB limit; no OOM was reported.
Screen and WebGL properties changed across some restarts: this is storage
continuity evidence, not a stable identity guarantee.

The upgrade fixture used cached beta.40 image
`sha256:ca832ef326d118be8ec3f1f46f8d51cd005ed7df89129148b25c772a1d8e046f`.
Beta.41 read its synthetic data copy twice; beta.40 reread the untouched baseline.
That cached image is not asserted to be the exact currently selected VPS image.
Local tests used the reviewed Podman seccomp policy, not Docker's production policy.
A manual-only workflow option now builds and tests native amd64/arm64 Agent/browser
pairs with publication disabled. Automatic CI remains paused; results are pending.

Production remains unchanged. A read-only VPS capacity check found no browser or
compute runs; no production configuration, credentials or profiles were read or
modified. Actual proxy, current account continuity, exact Agent/browser artifact
pair, deployed HTTPS Viewer and protected rollback remain required. Historical
beta.40 native arm64 evidence does not validate beta.41 arm64.

## Independent GeoIP update decision and Docker follow-up

The owner selected independent GeoIP updates, keeping browser access read-only.
The new host helper reserves capacity, downloads and validates public databases
using the pinned official image, atomically publishes a generation, and retains
a validated rollback generation. Failed or interrupted updates deny new browser
launches. Account volumes are never mounted. Installation and initial preparation
remain pending; see [the updater runbook](../../ops/browser-geoip/README.md).
The 40-case GeoIP-store, container and launcher tests pass, including repeated
failure, refusal of expired rollback, preservation of prior data and cleanup.
The actual built-in MMDB passes the new strict freshness check in a read-only image.

Manual run 41291728193 exposed a Docker-specific packaging failure on both native
architectures: renaming a lower-overlay-layer browser directory returned EXDEV.
Extraction now targets the final versioned directory directly. Download, checksum,
extraction and archive removal share one layer, avoiding retention of the 1.2 GiB
archive. Native Docker results for this correction remain pending. The manual
validation job also exposed an outdated idle-test broker response missing the
required memory limit; the fixture now supplies it and explicitly runs the Agent
subprocess only on Linux, where its /proc/meminfo contract is available.

The current VPS has native-profile mode enabled and still selects the legacy
runtime. Its host has no Node executable. Release acceptance now temporarily
extracts Node from the exact Agent image instead of requiring a new host install.
All ten release/rollback tests pass with that path. No deployment has occurred.

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
