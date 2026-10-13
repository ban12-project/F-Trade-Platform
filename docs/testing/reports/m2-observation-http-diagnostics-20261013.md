# M2 observation HTTP diagnostics — 2026-10-13

Issue #605 concerns an HTTP error after the publish call, during observation.
`checkedBrowserResponse` retained safe HTTP metadata on the exception, but the
publication executor reduced it to `publication_observe_transport_failed`.
The historical receipt did not retain the status, endpoint category or browser
error code. Those details cannot be reconstructed reliably from a later read.

A read-only check using the native Camofox API and Facebook driver recognized
acting identity, exact caption, one video and a canonical Reel link. Navigation
and evaluation returned HTTP 200. Timestamp hovers returned the already-tolerated
HTTP 422 `element_not_actionable`; subsequent link extraction succeeded. These
later responses do not establish the original failing status or substage.
No upload, publish action or receipt reconciliation was performed. The application
still has one publication/run/authorization and its immutable unknown receipt;
the preceding unknown receipt also remains unchanged. The inspection lease was
released and the managed Sandbox was confirmed stopped. Account, caption, media,
links, screenshots and raw response evidence remain outside the repository.

## Diagnostic contract

Observation HTTP failures now carry a bounded token in the existing signed
`failureCode` field:

`publication_observe_http_<status>__<request>__<step>__<code>`

Status is an integer from 300 through 599. Request and evaluation-step categories
are fixed allowlists; browser codes reuse the pinned server's reviewed allowlist.
Unknown metadata becomes `other`, `unknown` or `unclassified`. Raw errors, response
bodies, URLs, account identifiers and captions are never serialized. The UI parses
the same canonical contract before displaying any token. Existing generic receipts
retain their existing labels. No schema migration or historical receipt update is
needed. Cancellation and non-HTTP fallback behavior remain unchanged.

Synthetic tests inject HTTP 409 at the composer-closed evaluation and HTTP 503
at profile navigation after the single publish click. Both must produce one
unknown receipt, one authorization and one click. Protocol tests bind the diagnostic
to the signature; PostgreSQL fixtures check persistence and exact replay/conflict
behavior for text and video. Untrusted metadata and noncanonical presentation
strings are rejected. This establishes diagnostic preservation, not a fix for an
unidentified upstream HTTP failure and not successful live publication acceptance.
