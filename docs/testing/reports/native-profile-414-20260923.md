# Account session continuity: implementation checkpoint

Issue: #414. Recovery work in draft PR #424 does not satisfy session continuity.

## Required acceptance

1. Reuse one account-scoped native Firefox profile and fixed proxy across tasks, browser restarts and container replacement. Preserve the existing account state; migration must be explicit and reversible.
2. Inspect session identity and Messenger readiness before releasing credentials. Loading, network failure and ambiguous observations must not be classified as logout.
3. Enter bounded password/TOTP/PIN recovery only after confirmed session invalidation. CAPTCHA requires human attention and must not trigger another login loop.
4. Record factor prompts at every continuity step. Verify the same real account and Messenger state independently. An empty inbox is not evidence of restored history or successful ingestion.
5. Verify exclusive profile ownership, lease shutdown, graceful browser exit and explicit reset behavior. Separately test authorized inbound-message ingestion and deduplication.

## Local evidence

The opt-in native-profile implementation passed six unit tests covering explicit initialization, ownership, lease checks, symlink rejection, one-time legacy migration and account-volume binding. `git diff --check` passed.

An isolated, network-disabled Podman container used the patched pinned Camofox API to store a synthetic non-extractable AES-GCM CryptoKey in IndexedDB. A second task after closing the first session read the key and completed an encrypt/decrypt round trip. Another account was rejected. After deleting and recreating the container with the same volume, a third task repeated the successful round trip.

This proves synthetic storage continuity through the API; it does not establish Messenger's storage mechanism or real-account continuity. The original shell-wrapped debug launch required SIGKILL after its 20-second stop grace period. A subsequent test using the project watchdog entry point, a read-only root filesystem and the same patched runtime passed with an open browser session: both lease expiry and explicit container stop exited with code 0. Container replacement retained the key. The reusable runtime test asserts these outcomes and is wired into the image workflow. This was a local derived debug image, not the complete release image; release-image CI remains required. A subsequent local runtime test imported synthetic legacy cookies/localStorage before writing the native key; persistent cookies and localStorage survived browser and container replacement. A session-only cookie (`expires: -1`) failed the restart fixture, while a cookie with an explicit future expiry passed. Do not promise persistence beyond website cookie semantics or infer Facebook login validity from profile existence. The fixture now verifies migration ownership metadata and the original snapshot digest as well. The first revision (`b9ee417`) passed both amd64 and arm64 release-image build/smoke jobs; migration-fixture changes require their own CI run.

No fresh Facebook login was attempted for these tests. No production configuration was changed. Real-account migration and continuity, session-first task gating, bounded recovery, CAPTCHA behavior and full release-image regression remain pending. Do not mark MVP1 accepted from this checkpoint.

## Startup timeout ownership

Local proxy-enabled startup exposed an upstream race: `ensureBrowser()` clears its launch promise when the 60-second observation timeout wins, although `launchBrowserInstance()` is still running. A subsequent request can start another launch against the same native profile. Native mode now retains the underlying launch promise until it settles; timed-out observers do not create a second launcher. The independent lease watchdog still terminates stalled runtimes. A regression test makes two observations time out, then verifies a third receives the original launch result with exactly one factory invocation.

The local diagnostic plugin from earlier recovery experiments also wrote a 15-minute lease, which the production watchdog correctly rejected. That private plugin was disabled for continuity testing; the production lease cap was not weakened. Real-account migration metadata reached `imported: true`, but browser readiness and Facebook/Messenger identity have not been independently verified, so this is not session-continuity acceptance.

Revision `61f6b97` passed both release-image build/smoke jobs, including native migration and restart fixtures. A concurrent local run on the loaded development host completed its write task but failed the subsequent `/tabs` request with HTTP 500. This local failure remains unresolved; CI success does not establish real-account continuity. Added bounded error-code reporting to the synthetic client without logging page or account data. Local real-account continuation uses the same migrated volume with the startup ownership fix and a pre-downloaded GeoIP database, avoiding another runtime download.
