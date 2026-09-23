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

This proves synthetic storage continuity through the API; it does not establish Messenger's storage mechanism or real-account continuity. The original shell-wrapped debug launch required SIGKILL after its 20-second stop grace period. A subsequent test using the project watchdog entry point, a read-only root filesystem and the same patched runtime passed with an open browser session: both lease expiry and explicit container stop exited with code 0. Container replacement retained the key. The reusable runtime test asserts these outcomes and is wired into the image workflow. This was a local derived debug image, not the complete release image; release-image CI remains required. Legacy migration has unit coverage only.

No fresh Facebook login was attempted for these tests. No production configuration was changed. Real-account migration and continuity, session-first task gating, bounded recovery, CAPTCHA behavior and full release-image regression remain pending. Do not mark MVP1 accepted from this checkpoint.
