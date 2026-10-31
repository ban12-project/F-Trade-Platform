# DM acceptance startup checkpoint — 2026-10-31

Related to #674 and #322. The user resumed DM acceptance. Two normal interactive
starts failed before viewer admission, at browser health; no DM was sent or
captured. The account's stored `ready` label does not prove this batch's readiness.

The second run's independent container observation found a running container,
`OOMKilled=false`, and an HTTP health response with `ok=true`, `engine=camoufox`,
`browserRunning=false`, and `browserConnected=false`. The browser container was
subsequently reclaimed and the application recorded the owned instance stopped.
This narrows the failure stage; it does not establish profile corruption, proxy
failure, or a Firefox crash. The existing watchdog discards browser output and
the container logging driver is disabled. Failed attempts to read container logs
are not evidence of an empty error stream.

## Diagnostic change

The pinned server now exposes fixed startup stages through its existing health
response: display setup, launch-option preparation, native-profile validation,
Firefox launch, and publishing the ready browser. Status and error codes are
allowlisted. No raw exception, URL, proxy, account identifier, path, or page text
is retained. The agent projects the final observed fields again before logging
a failed health wait. A later unreachable response cannot reuse an earlier
startup observation. Strict health, lease, proxy, account and timeout conditions
are unchanged; the fields never authorize a task or trigger a retry.

## Evidence at the implementation checkpoint

- Existing browser-node, egress and native-profile regressions plus diagnostic
  tests pass. The native-profile test additionally distinguishes refused profile
  validation from entry into Firefox launch. TypeScript passes.
- The exact pinned upstream source accepts all guarded replacements and the
  patched server parses. A local diagnostic overlay on the existing reviewed
  browser image passes the actual network-none native-profile fixture: session
  replacement, container replacement, cookie and nonextractable key restoration,
  wrong-account refusal, lease shutdown, and retained window geometry. The
  updated fixture checks the ready startup projection.
- This local overlay is not a newly released production image pair. Exact release
  delivery, production failure-stage observation, actual Messenger readiness,
  controlled messages, persisted inbound capture, repeat-poll deduplication and
  RFQ association remain required. #674 remains open and DM is not accepted.

Private execution evidence remains in the ignored local acceptance directory.
No account-bearing data or message content is included in this report.

## Released runtime and production selection

PR #720 merged as `b578e3638ab1f7f8266f6e374b0323964e71f4ea`.
The complete [image publication run](https://github.com/ban12-project/F-Trade-Platform/actions/runs/41198614254)
passed, including release validation and both architecture jobs. Ordinary CI
remains paused under #712; this result is the separate image release gate.

The amd64 artifact ZIP matches the GitHub-reported SHA-256
`598afc4ef99b7d8a34e9a4d8fc0e43c738d4fac9a6c54c954b7fb45e3bf1c447`.
Inner checksums, source revision, archive config identities, destination config
and ordered root filesystem layers were verified. The initial extraction check
expected three files; inspection of the committed exporter confirmed that its
two additional metadata files were expected. The corrected strict inventory
accepted exactly those five files. Podman's bare image-ID hex was normalized to
the `sha256:` representation; config and layer comparisons were not relaxed.

The exact released pair passed local Agent smoke, actual native-profile
continuity and publication/inbox observation fixtures under the documented
restrictive Podman policy. Synthetic inbox cases included normal capture and
missing-ID, ambiguous-direction and wrong-identity refusals. Local memory peak
was 960,327,680 bytes and PID peak 176, with zero memory-limit, OOM and PID-limit
events. These are synthetic tests, not a real inbound-message result.

The credential-free cloud builder passed the full packaged image smoke and
verified absent account volumes and credentials. Its first invocation failed
before resource creation because the isolated worktree lacked local project
association; linking the existing project context resolved that setup error.
The successful builder retained a bounded 30-day template and was deleted.
A separate provider test passed whole-VM stop/resume with a synthetic volume
and native IndexedDB nonextractable key; the test instance and its temporary
snapshots were deleted.

The verified destination Docker IDs selected in production are:

| Role | Local image ID |
| --- | --- |
| Agent | `sha256:5d919637fb88bfeea508116e95636cac85675e95b6d4a9a54c8f4b9a69500197` |
| Browser | `sha256:a6a8bb170219dc442b4c0734653a20caebb87b2e8886ff33d08d6e36f4425407` |

## Original-instance preservation and inventory decision

An independent deny-all rollback copy with no public ports was verified stopped
with a created snapshot and a 24-hour retention bound. Production staging held
the node dispatch lock with a bounded idle timeout and heartbeat. The first
attempt stopped before image import: the account inventory derived from current
accounts and recent runs was incomplete.

Read-only inspection found eleven retained account volumes plus node-state.
All account volume names, node/account labels and completed owner manifests
agreed, and all three current accounts had matching storage. The full older
history is not represented in the current account/recent-run list. This is an
unresolved historical-inventory limitation, not evidence of foreign ownership
or permission to delete old data. The maintenance decision was to freeze the
exact inspected inventory, preserve every volume and reject subsequent drift.
No volume was deleted, reinitialized, reassigned or enabled.

The subsequent stage imported the same digest-verified artifact directly from
the release service, verified the destination images and installed the four
committed startup files. All eleven account volumes, node-state, node key,
runtime configuration and private Facebook configuration had identical before
and after fingerprints. Old images were retained. Docker was frozen and the
same instance was independently observed stopped with a created snapshot before
production configuration changed.

Only production-scoped image/template settings were changed. The first CLI
process wrote the Agent selection but did not exit; after terminating that
process, independent readback identified the partial selection. Completing the
same intended configuration with stdin closed resolved the CLI lifecycle
problem. A subsequent production redeployment was verified READY, bound to
`ftp.ban12.com`, and attributed to the exact release commit; fresh configuration
readback matched the staged image pair and verified template.

## Real-account observations and remaining gates

One normal application task on the first enabled account reached actual Firefox
startup `publish/ready`, with the selected browser image independently checked.
Its durable automatic-login result was `ready`, with no credential claim, no
factor prompts and `empty_inbox` history evidence. The owner viewer visibly
showed the empty Messenger interface. After manual release, the task became
`failed` with `stopRequested=true`; the existing Agent maps a revoked
interactive lease to that terminal outcome. The readiness result and terminal
task status are separate evidence, not a claim that every task stage succeeded.

The live container's memory peak was 2,147,745,792 bytes and `memory.events max`
was 2705, with zero OOM/OOM-kill events. PID peak was 238 with zero PID-limit
events. This establishes observed memory pressure. It does not prove the cause
of the earlier intermittent health failures, and resource limits were not
increased. #674 remains open.

The next enabled account was queued once during automatic shutdown. The
controller subsequently dispatched that same demand after stop, without another
manual queue action. Its browser started, but automatic account verification
returned `unknown`, with no credential claim or factor prompts and unverified
history. A manual, credential-free navigation showed an empty Messenger page;
the account identity was not independently established, so this does not upgrade
the durable result to `ready`. Further independent-window inspection required
unlocking the owner's Mac.

No DM has been sent and inbox capability remains disabled. Controlled inbound
capture, repeated-poll deduplication, RFQ association and cold-start polling are
still unproven. This rollout and the visible empty inboxes do not close #322 or
establish DM acceptance.
