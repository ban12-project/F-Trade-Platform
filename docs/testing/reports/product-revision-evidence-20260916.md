# Preserve imported field evidence during a product revision

Issue: [#349](https://github.com/ban12-project/F-Trade-Platform/issues/349).
Source change: `db8811f`.

A streamed product stores opaque references to validated source locations. The revision form displayed
these as unselected, and its write path tried to resolve them as uploaded document IDs. Changing one
field therefore required rebinding otherwise unchanged facts to whole-document evidence.

The form now displays “保留原字段证据” for each original location. A revision may retain that reference
only for the same unchanged field value, product and source. Changed values, moved references and
unrecognized locations must use an authorized uploaded evidence record. Server authorization locks the
product, its current project link, active marketing project, editor membership and non-banned user;
new uploaded references still pass the existing project evidence checks. Competing revisions cannot
both commit. The image confirmation gate remains independent.

## Verification

The isolated PostgreSQL regression covers all twenty supported fields, including OE leading zeros,
false sample availability and zero lead time. It verifies nineteen retained locations when packaging
changes, all-location retention when no facts change, refusal of changed/rebound/unknown/foreign
references, unrelated projects, unauthorized and banned actors, unchanged records after failures,
concurrent-edit serialization, image association preservation and explicit confirmation before Ready.
The test runs in repository CI and uses synthetic database metadata without cloud uploads.

The actual browser/model test reused one unchanged twenty-field MOCK CSV and authorized original
catalog page image from #345. The model produced 20/20 expected fields. After a simulated rejection,
only packaging received a new independently uploaded MOCK CSV reference; the other nineteen choices
were left untouched. All nineteen original field references survived exactly (they share one original
CSV-row location in this example). The database audit recorded that retained location.

Before the successful revision, changing product name while retaining its old location was explicitly
rejected in the browser; an independent database check confirmed no state, version or payload change.
Restoring the name allowed the single planned packaging revision, followed by explicit simulated image
confirmation and approval. Original image bytes, native preview rendering, refusal without image
confirmation, and image associations through revision were checked.

TypeScript, catalog/cohort regressions and the new PostgreSQL test passed. Biome reported no errors.
The isolated Node 24.21.0 / pnpm 11.24.0 production build and production fixture/anonymous-access
boundaries passed at `db8811f`, with Cache Components and React Compiler enabled.
Next.js Turbopack compilation and runtime error probes were clear; agent-browser rendered the saved
product and exposed its React tree. All three temporary private objects were deleted and uncached
reads confirmed absence. Original reference files and local audit artifacts remain unchanged.

This is automated simulated approval, not factory confirmation or a human review-time benchmark.
There was no external business message, publication, formal quote or production deployment.
The raw-catalog gaps in #346, startup diagnosis in #348 and GitHub delivery remain outstanding.
