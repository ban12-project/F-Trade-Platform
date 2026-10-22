# RFQ product type — 2026-10-22

Issue: #650. All inputs and browser accounts used here are synthetic. DM acceptance remains paused.

## Behavior

New RFQ forms start with product type pending confirmation. Explicit supported customer requests can suggest clutch disc, clutch cover / pressure plate, release bearing or clutch kit, with message provenance. Distinct types, negation and supported ambiguity markers remain manual. Suggestions fill only blank fields, including after an asynchronous response, preserving human choices.

The parser uses a limited English/Chinese vocabulary, not general semantic understanding or verified engineering fitment. Unsupported prose requires human entry; conservative conjunction handling may omit otherwise usable suggestions. No price, delivery, gate or outbound behavior changes.

## Compatibility decision

Persisting blank product types would make those records unreadable to existing application versions. Keep the persisted RFQ contract: the shared form/action schema rejects blank and unknown types. Only the form input permits the pending state. RFQ Ready still requires complete requirements and human confirmation.

## Validation

- Sales tests: explicit MVP1 examples starting without product facts, supported component terms, alternative/negated requests, multi-message conflicts and provenance, unknown type rejected by RFQ Ready.
- TypeScript check passed.
- Dedicated PostgreSQL sales-context suite passed with product type included in authorized inquiry suggestions; no suggestion writes or outbound effects.
- Local Next.js browser: initial pending type; save rejected with field error; three synthetic messages filled six fields including clutch kit; manual change to clutch disc survived another suggestion request.
- Next.js MCP reported no configuration or session errors.
- Extended database-browser CI tests to cover a manual type selected while suggestions are pending, missing-type validation and explicit selection in existing sales/archive flows. Full CI result is tracked on the PR.

The browser used an isolated application copy and local synthetic PostgreSQL. Its Tailwind sources were restricted to that copy to exclude ignored test database files; repository build configuration is unchanged. No RFQ was saved during the local browser check. Local screenshot: `tmp/rfq-history-644/product-type.png` (ignored).
