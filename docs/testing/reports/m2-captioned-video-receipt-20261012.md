# M2 captioned video receipt contract, 2026-10-12

Issue #596 adds an explicit `captioned_post` video receipt mode for a separately approved, nonempty exact caption. It uses the same post boundary for the acting author, caption, one visible video and a canonical Reel permalink absent from the pre-click baseline. It does not accept an unrelated Reel found elsewhere on the profile.

The default notice mode remains compatible with its reviewed success container, unique link and success text, including captionless videos. Captioned mode rejects mixed/unknown rule objects and empty captions before preparation. Existing same-caption posts, duplicate new matches, wrong authors/bodies, foreign or non-Reel links, missing or multiple videos and changed approved preview bytes cannot yield a published receipt. The receipt projection preserves the original fields. Authorization, audience, blob digest checks, single-click behavior and unknown/no-retry boundaries remain enforced.

## Production observation boundary

A read-only review of the existing persistent account session verified the expected profile identity. The profile initially had no loaded post containers; scrolling loaded the posts. Three observed posts each had one matching author, body and timestamp link. One existing video post also had one video. Hovering that same timestamp resolved one canonical Reel URL; the two text posts resolved story permalinks. The approved new caption matched none of these observed posts. This establishes the reviewed DOM components, not a new post or reconciliation of a historical unknown.

The preceding authorized MP4 editor preview independently passed current ownership/session/project access, approved video/caption version and digest checks. After upload, the acting identity, Only me audience, exact caption and unique blob video bytes/SHA-256 matched. No publish action was available in that diagnostic program. Its final visual/audit request missed the original lease deadline and remains unverified; structured native API evidence is retained privately.

The current production candidate's bytes and expiry remain unchanged, and its publication capability was not enabled. The runtime is stopped with a recovery snapshot available. Raw page rules, account/media/post identifiers, captions, images and credentials are absent from this report and GitHub. Engineering observations were performed by the delegated agent; they are not an independent factory signature.

## Verification

- 48 Chromium driver tests passed against fully intercepted synthetic HTML. Eleven captioned-mode scenarios cover positive delivery, empty/stale captions, duplicate matches, wrong author/body/link, foreign links, missing/multiple media and post-authorization blob substitution. Explicit-mode validation also passes.
- 39 node and page-inspection tests passed with the TypeScript loader. Expired candidate files remain unchanged and confer no capability; mixed/unknown video receipt rules reject.
- Video publication policy regression and project TypeScript CLI check passed.
- Native Firefox HTTP fixtures now exercise scoped caption/author/video/link projection, foreign author, multiple videos, tracking removal and unchanged legacy receipt projection. Both architecture image checks must pass in CI before deployment.
- Local Podman is running, but image inventory failed with an overlay storage readlink error. No VM reset, storage deletion or successful native-local result is claimed. The initial node test invocation omitted the TypeScript loader and failed to resolve an existing extensionless import; the corrected invocation passed. Two initial browser failures were stale click-count assertions in the changed fixture, corrected to preserve the original pre-click no-effect cases; the complete rerun passed.

Code merge and synthetic/native checks do not activate production scope or complete M2. The approved one-post authorization remains subject to fresh page review, final pre-click media/audience verification, application-managed submission and a persisted signed receipt. Independent inbound acceptance remains deferred by the user; retention and other open M2 requirements keep their existing evidence boundaries.
