# Workspace guide walkthrough — 2026-11-01

Related to #754. The user authorized the reference materials and simulated DM.
Real account publishing and DM receipt remain deferred. Browser zoom and PITR
are removed from MVP1 scope and were not resumed.

## Fresh source and content path

A new reference demonstration project was created through the production UI.
The authorized 32-page catalog was uploaded once. Two preprocessing attempts
failed because the HTTP transport waited only 300 seconds despite a 610-second
request deadline. #757 fixes that mismatch. A synthetic 305-second command
reproduced `UND_ERR_HEADERS_TIMEOUT` at 302.309 seconds; the fixed client converted
the original catalog in 316.7 seconds. The retained production import was then
retried successfully, producing 162 selectable candidates.

One candidate was extracted into a product draft. Its source-bound OE and product
identifier were preserved; missing product name and type were not guessed. The
normal UI return/revise/review path supplied those fields using the original page
heading and row. The resulting product reached `PRODUCT_READY`, version 4.
Unverified specifications, prices, lead times and media remained unset.

Content generation used that approved product. The draft was reviewed and edited
to ask for quantity and destination, then approved through the normal UI. An
independent read confirmed `CONTENT_APPROVED`, version 2. The page showed no enabled
publishing channel; no publication task was submitted. This run follows the
application's primary text-content path. Video is optional at this step; this new
product had no verified reusable media, so this is not new video acceptance.

## Simulated sales path

The newly approved product payload was copied unchanged into the isolated local
PostgreSQL browser-test database. An explicitly labeled synthetic inbound message
started the RFQ suggestion flow. This exposed a spaced-OE truncation defect;
#759 preserves complete supported grouped references and rejects ambiguous tails.
The message and product reference were not rewritten to evade that defect.

The production-build browser journey then passed: persisted message suggestion,
RFQ completion, quotation return/revision/approval/send registration, delivery
confirmation, six follow-up scenarios and explicit opportunity confirmation.
The final guide-enabled rerun passed in 17.3 seconds and also verified RFQ guide
steps against the persisted message without changing the suggested OE.
The test checks that the source product remains unchanged and that outbound jobs
remain queued. All commercial values, approvals and send receipts are simulated;
there is no connected worker and no external delivery.

## Guide and recording

The opt-in `使用引导` entry loads Driver.js only when opened. Steps select visible
controls on the current page and explain source intake, catalog progress and
selection, evidence-backed revisions, product/content review, publication
readiness and downstream sales. Video steps appear only where their controls
exist. Closing or finishing the guide does not submit business forms. Route
changes destroy the current tour, and it can be reopened on each page.

Desktop and mobile-layout browser tests passed, including draft preservation,
no business POST during the tour, focus restoration after an early exit and
mobile menu guidance. Native Chrome inspection confirmed the welcome step,
new-work anchor and focus restoration. TypeScript and repository validation
passed; existing unrelated Biome warnings remain.

Authorized source renders, production screenshots and isolated simulated-sales
captures are stored privately under the ignored `tmp/user-guide-20261101/`
directories. The local material index distinguishes production records from
synthetic sales and local guide previews. No original PDFs, customer data,
private record IDs or unredacted captures are committed with this report.
