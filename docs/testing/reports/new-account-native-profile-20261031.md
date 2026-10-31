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
The change is not yet deployed: exact image release, Sandbox rollout, actual
new-account connection, and production two-account DM remain to be verified.
