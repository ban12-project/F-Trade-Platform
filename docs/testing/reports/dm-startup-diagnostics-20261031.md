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

## Local evidence and remaining work

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
