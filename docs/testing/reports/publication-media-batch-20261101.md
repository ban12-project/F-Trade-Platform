# Publication regression repair — 2026-11-01

Issue #785. PR #780 hard-coded `textOnly: true` in generated setup profiles,
capability reports and platform activation. Its adapter wrapper filtered the
matching original profile out and routed all matching jobs to the setup driver.
UI and media domain guards then blocked image/video submissions. PR #782 only
relaxed historical-post discovery; #784 changes interactive deadlines, not this
routing. These are configuration shadowing and admission regressions, not absence
of the existing media executor.

The generated profile also contained a deliberately unmatched attachment-name
selector. Removing its text-only flag alone would not restore media. Compatibility
now recognizes that exact generated editor/placeholder contract only, retains its
identity and expiry, and uses blob SHA-256 image verification and the existing
captioned-post video receipt path. Other partial profiles retain their restrictions.
Active original media profiles take precedence for both admission and execution.
Platform setup cannot downgrade a live media scope. No grant, pause, allow-publish,
credential, stable account ID or historical post is changed.

New publication uses Public regardless of the old profile's audience. The driver
selects Public in the current composer, clears the "save as default" checkbox,
verifies after upload and again around authorization, and checks Public immediately
before the single click. It does not change account-wide privacy settings. Unknown,
ambiguous or missing controls fail closed. Attachment mismatch, mixed previews,
changed blob bytes, pending video processing and absent receipts retain stop/unknown
semantics. Single image and single video use the existing executor and private media
transport; multi-image/mixed/multiple-video posts are not implemented and are not
split into separate posts.

The content page now has one composer, account multi-selection, exact preview,
public audience and post count. Approved video/caption variants remain linked to
both reviewed versions. Selection survives returning from account recovery. A new
Server Action reauthenticates and validates the shared Zod schema; one database
transaction validates and locks all targets before committing per-account jobs.
The audit stores batch identity, digest and result IDs. Batch receipts preserve the approved source version rather than marking it published after the first account; otherwise the next account would fail the original version guard. Legacy single-target transitions retain their existing behavior. Advisory locks and stable
per-account content identities cover concurrent clicks and lost responses; legacy
job identities are consulted to avoid resending existing work. Only proven unsent
failures can be selected for retry; successful/unknown targets are excluded.

## Validation boundary

No test posts or media uploads to real Facebook accounts. Browser fixtures intercept
all Facebook requests. Historical reports document real read-only page observations
and private editor checks, not this release's live publication acceptance.

Local validation includes the Facebook driver/executor/page suite (113 synthetic
browser cases), generated-profile compatibility and adapter precedence, PostgreSQL
batch text/image/video tests, original VPS submission/rollback/claim suite, setup
activation safety, browser UI selection/preview/recovery tests, TypeScript, Biome,
repository validation and offline agent payload packaging. Exact final results are
recorded in the PR after the final rerun.

The shared authorization fixture had acquired a binding after the old VPS test was
written; that test now removes only its own synthetic node before testing real owner
registration. Admission locks also now wait for a short concurrent account metadata
transaction; the test verifies no premature job and eventual durable queue/claim.
A stale long-running dev process initially served old components; restarting it and
allowing the local Playwright host's dev assets restored current-code testing.
React Compiler remains enabled; reactive form reads use `useWatch`.

Limits: live Facebook behavior, locale/layout variations, video/Reels editor changes,
and actual platform acceptance remain unverified by this release. A generated
captioned-video receipt requires a nonempty approved caption and a matching loaded
post/author/video/canonical Reel link. An empty-history account or unrecognized page
cannot be automatically declared ready. These are system adaptation limitations,
not tasks for users to inspect selectors or invent receipt rules. Existing compatible
private profiles are retained. Runtime still stops for login, CAPTCHA, 2FA, pauses,
revoked authorization and uncertain outcomes.
