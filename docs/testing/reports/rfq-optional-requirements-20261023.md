# RFQ optional customer requirements — 2026-10-23

Issue: #654. Scope follows MVP1 section 16: vehicle year, engine, required specification, packaging requirement, expected delivery and customization. These are optional customer requests, not verified factory facts or delivery promises. DM acceptance remains paused.

## Behavior and compatibility

The RFQ form accepts all six fields with shared server/client Zod validation (trimmed strings, at most 240 characters per field). The collecting and Ready detail views display nonempty requests with their unverified/customer-request meaning. Existing completeness rules and quotation/delivery gates are unchanged.

The quotation form also shows the selected RFQ's core identity, quantity, destination and optional requests, plus a link to its full detail. Switching RFQs switches the summary; customer requested timing does not populate factory lead time or any commercial term.

The existing RFQ Ready contract already allows these fields; no database migration or contract expansion is required. Revisions now retain a stored optional value when an older client omits that field, and remove it when the client explicitly submits an empty string. Only the six named request fields receive this preservation behavior. This protects older clients using the updated server; it does not claim that an old server binary preserves fields its writer never supported.

## Evidence

- TypeScript passed.
- Sales behavior suites passed.
- Dedicated local PostgreSQL sales-context suite passed: all six fields round-trip, oversized values reject, a viewer cannot revise, old-client omission retains stored requests, explicit clearing removes packaging, changed requested timing persists, and the existing Ready contract accepts retained requirements.
- Local Next.js browser saved six marked synthetic requests, displayed them on the detail page, cleared packaging and changed requested timing, then confirmed the synthetic RFQ Ready. Remaining requests stayed visible; the page still required a verified product reference before a formal quote. No quotation, delivery confirmation or outbound message was created.
- Next.js MCP reported no configuration or session errors.
- A separate local browser check switched between two synthetic Ready RFQs. OE, quantity, destination, engine, requested timing and detail link changed together; unit price and factory lead time remained empty. No quote was submitted. This selection isolation has a dedicated database-browser regression.
- Existing database-browser sales journeys now exercise these fields through intake, revision, explicit clearing and RFQ Ready. Full CI result belongs to the final PR head.

The local browser used a separate app copy and dedicated synthetic PostgreSQL. Tailwind sources in that copy exclude ignored test database files; production build configuration is unchanged. Ignored screenshot: `tmp/rfq-history-644/optional-requirements-ready.png`. Synthetic records are not real business acceptance evidence.
