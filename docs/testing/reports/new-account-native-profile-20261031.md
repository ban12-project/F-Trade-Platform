# New account native-profile startup

Issue #718. A new account could be saved successfully but fail its first browser
start: the Agent created an empty volume while native startup required an owner
manifest. Authorization saved in the application is not an initialized browser
profile, a valid login, or DM acceptance.

## Change

New bindings receive a server-owned first-use grant. Only an interactive claim
can carry it to the native runtime. Before mounting storage the Agent checks
Docker's returned volume ownership, rather than assuming requested labels were
applied to an existing volume. Volume copying is disabled. With a live lease,
the runtime may initialize a completely empty root once; exclusive directory
creation prevents concurrent overwrites. Nonempty, partial and mismatched
profiles continue to fail closed. Existing profiles are reused unchanged.

The first ready heartbeat consumes the grant before viewer admission or login
authorization. Pre-ready failures may retry without granting access; updating an
existing account never reissues first-use permission. Historical bindings lack
this grant and cannot silently recreate missing storage. A volume ownership
failure has a bounded diagnostic code.

## Verification

- 89 node, protocol, fleet and native-profile tests passed. A targeted diagnostic
  assertion additionally verifies the volume mismatch classification.
- TypeScript CLI, offline Agent payload import checks and complete repository
  validation passed. Repository checks used an isolated Python environment with
  PyYAML and jsonschema available to child processes.
- Production Turbopack build (including TypeScript CLI) and production fixture /
  anonymous workspace boundary checks passed with synthetic configuration. The
  first restricted-network build was stopped without a result; the retry with
  network access compiled successfully. Existing partial-prefetch configuration
  warnings remain unchanged.
- Real local PostgreSQL broker regressions passed, including new-grant issuance,
  claim payload, durable consumption before access, and refusal to rearm after
  the same account is saved again. All database inputs were synthetic.
- A local Podman overlay of the deployed amd64 browser image, replacing only the
  changed native-profile module, passed the network-none first-use runtime test:
  empty profile initialization, synthetic Cookie/localStorage and nonextractable
  CryptoKey persistence across session/container replacement, account isolation,
  lease expiry, graceful shutdown and bounded window geometry.
- The existing legacy-migration runtime fixture also passed on the overlay,
  preserving its synthetic Cookie/storage/key across container replacement and
  fitting the seeded oversized window to the remote desktop.
- The same first-use fixture on the unchanged deployed image failed at startup
  (`http_500:runtime_request_failed`). This is a regression reproduction, not a
  production login failure. An early fixture iteration used a session-only
  Cookie; it was corrected to have a persistent expiry before the successful run.

The baseline invocation without the TypeScript loader/local listener permission
was not a passing node test. The final node run uses `node --import tsx --test`.
Biome reports three pre-existing warnings and one pre-existing informational
suggestion in the checked files; no formatting errors remain.

The requested local connection test with the designated disabled account and
its saved proxy is separate and pending secure availability of that proxy. The
production account remains disabled. No local result establishes DM acceptance.
An existing pre-release binding, after the reviewed empty-profile maintenance
initializer, subsequently passed production browser health and viewer admission
and reached the Facebook login form. This supports the initialization diagnosis;
it does not exercise this candidate's automatic first-use grant in production.

The change is not yet deployed: exact image release, Sandbox rollout, automated
new-account initialization in production, and production two-account DM remain
to be verified.

## 2026-11-01 VPS integration checkpoint

Integrated main `ffbb001` into this candidate. The Docker container specification
retains current VPS host/bridge admission, memory limits and the one/two CPU
startup grant. Startup diagnostics and their separate profile/Firefox stages
remain covered alongside first-use initialization.

- 111 browser fleet, node, protocol, startup, egress, viewer and native-profile
  checks passed before the additional failure-recovery case.
- The expanded native-profile suite passed all 14 cases, including a failed
  first Firefox launch followed by a new runtime retaining the exact owner
  manifest and partially written synthetic profile. No rollback deletes data.
- TypeScript CLI and offline Agent payload import/negative control passed.
- The actual PostgreSQL publication/broker suite passed in a dedicated local
  database, including first-use issuance, scoped claims, ready consumption and
  refusal to rearm an existing account. All records were synthetic.
- Targeted Biome checks passed with three pre-existing warnings.

The current deployment target is VPS, not the retired Sandbox provider. Exact
released-image validation and current production first-use behavior still need
their own evidence. The user has deferred publication and DM acceptance because
a sending account is unavailable; this checkpoint sends no messages and cannot
close those acceptance items.

### Current build and container checks

The integrated production Turbopack build and fixture/anonymous-workspace
boundaries passed. Fourteen VPS admission/network checks also passed.

The initial local container test used macOS Bash 3.2, whose nounset handling of
an empty optional seccomp array stopped the script; that invocation is not a
passing test despite its trap exit status. The optional-array expansion now
works with Bash 3.2 as well as newer Bash. A diagnostic retry with the default
Podman policy reached profile validation and stalled at Firefox launch, then
returned HTTP 500; the fixture now reports only sanitized startup enums.

Using the repository's existing restrictive Podman namespace policy, the actual
Firefox first-use fixture passed synthetic Cookie/localStorage and nonextractable
CryptoKey persistence, separate task/container reuse, foreign-account refusal,
lease expiry and 1400 x 860 window geometry. The test used local overlay image
`72da9bd27a24b9317d121f4251d7e3be21c60a2b2f6a6e65ea64b51b22935428`,
based on cached image `ca832ef326d1` with only the current native-profile module
replaced. An unnecessary remote base pull was explicitly cancelled and replaced
by a pull-never build from the verified local image ID; the cancelled build is
not release evidence. The restricted local policy is not installed in production.
