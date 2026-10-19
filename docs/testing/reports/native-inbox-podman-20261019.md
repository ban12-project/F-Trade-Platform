# Native inbox Podman verification — 2026-10-19

Issue #618 adds inbox collection to the existing network-none browser-image
fixture before real two-account DM acceptance under #322/#156.

## Local verification

Both official images were pulled again from GHCR, retaining runtime revision
`3afb7bc3cf0917d27642d0f73c11c0d48d6199dd`, workflow run `38682365133`:

| Image | Local Podman config SHA-256 |
| --- | --- |
| Agent | `fd6578d3c98f0b70d98c2fa2dedef4355dfa7aeab3e76c50dec377816658e352` |
| Browser | `910a1533652fd5032d7e3bc1bc821cec2e66398fbfa2df1fcd72f4581ef97831` |

Fresh production configuration readback still selects the corresponding Docker
local IDs documented in the [runtime rollout](sandbox-runtime-rollout-20261015.md).
Docker archive IDs and Podman config IDs remain distinct, with the previously
verified config/RootFS mapping; neither image was rebuilt locally.

The explicit rootful Podman connection and reviewed local restrictive seccomp
policy ran the actual Firefox/Camofox HTTP/evaluate boundary under network-none.
The four inbox scenarios passed: one inbound capture and outbound exclusion;
the same stable message ID after synthetic session replacement; missing ID
refusal; direction ambiguity refusal; and wrong account identity refusal. The
three negative scenarios returned `page_contract_failed`, zero messages and no
completion marker. No click, typing, account profile or external traffic was used.

Kernel checks passed with 671,772,672 bytes peak memory and 174 peak PIDs;
memory-limit, OOM and PID-limit events were zero. All fixture containers were
removed. The six existing native publication-observation scenarios also passed
before the inbox checks. The first combined run then failed because the new
test omitted required run-scope fields; this was a fixture error. An inbox-only
rerun exposed macOS Bash's empty-array behavior under `set -u`; the runner now
skips the publication loop explicitly. The final four-scenario run passed.

A separate host-side collector → signed loopback HTTP → Podman PostgreSQL
regression passed encrypted storage, concurrent inbound deduplication,
lost-response retry, unassigned routing and human routing. That suite uses
intercepted Chromium; the native image checks above independently verify the
production browser execution boundary and do not claim database persistence.

## Real-account boundary and resources

The authenticated production settings show both newly configured accounts
require login and have no successful inbox check. Local read-only viewer
observations found one account at a video-selfie identity checkpoint and the
other at the login form. The user selected the other account for continued work.
No real message was sent, no login-ready state was asserted, and no inbox
capability or polling was enabled by this verification. Account configuration
alone cannot establish two-account Messenger readiness.

No Vercel Sandbox was created or resumed for this test. Cloud inventory found
two stopped instances, including a bounded account rollback fork, and five
available snapshots before cleanup. The current template and account recovery
snapshots require separate retention from obsolete credential-free templates.
One obsolete credential-free template was deleted after fresh production
selection and instance-reference checks. Readback found four available snapshots
and both instances still stopped; no account snapshot was deleted. Its provider
metadata size was 6,644,202,813 bytes; this is not a measured billing reduction.
Exact resource identifiers and account data remain private.
