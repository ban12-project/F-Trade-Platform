# VPS browser base build architecture — 2026-11-01

Issue #739, related #718. Release 41267525693 for main `0e7e6d2` failed
before promotion. Its private host log shows the pinned base Dockerfile failing
at `TARGETARCH: parameter not set`. The saved receipt is
`failed / release_failed_before_promotion`; this is a terminal failure, not an
observation timeout, and the unchanged revision was not retried.

The release driver intentionally uses the legacy Docker builder to retain its
2 GiB / 2 CPU build bounds. That builder does not automatically provide BuildKit
platform arguments. The driver now validates Docker daemon architecture,
explicitly passes TARGETARCH, and uses the same architecture for the existing
image smoke tags/environment. Only amd64/x86_64 and arm64/aarch64 are recognized;
unknown values fail before any build. Build resources, exact-image checks,
drain, rollback and latest-main checks are unchanged.

Two new test methods fail on baseline (missing architecture argument and missing
unsupported-architecture refusal). All ten release tests pass on the candidate,
covering both architecture aliases through the actual build command builder,
retained CPU/memory limits, same-architecture smoke invocation and existing
rollback/retirement safeguards. These mock the Docker boundary and do not
claim an actual arm64 build. `git diff --check` passes.

The next exact main release must supply actual VPS build/promotion evidence.
The #719 application/local tests do not establish current browser runtime
rollout or production first-use. Real publication and DM remain deferred.
