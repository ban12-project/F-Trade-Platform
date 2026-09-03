# Evidence-bound product and video foundation

This document describes how product facts and reusable media move through the governed marketing workflow. It is written for product editors, Gate 01 reviewers, and operators investigating an audit record.

## State boundaries

`ProductDraft`, `ProductReady`, `ProductMedia`, and `VideoReady` have different meanings:

1. A `ProductDraft` contains proposed facts and explicit evidence bindings. It is not approved product truth.
2. `ProductReady` means a human Gate 01 reviewer approved the product facts. It does not approve media or authorize video work.
3. `ProductMedia` records one private image or video, trusted technical metadata, semantic description, review status, rights scope, and optional expiry.
4. `VideoReady` is a derived assessment. It requires a current `ProductReady` record plus approved, unexpired media with the permissions required by the requested video use.

None of these states publish content, promise a price or lead time, or enable a video-generation provider.

## Manual product facts

The manual product form places an evidence input beside every supported fact. Core identity fields always require evidence. Optional facts and their evidence must be present or absent together.

Editors may intentionally reuse the same private evidence record for several facts when one source genuinely supports them. The application never copies a single evidence reference to unrelated fields automatically. `field_evidence` is built from the submitted fact/evidence pairs, and `evidence_refs` is the deduplicated set of those bindings.

The governed form covers all fields currently allowed by the `ProductDraft` and `ProductReady` contracts, including clutch-kit composition, weights, package size, MOQ, lead time, packaging, customization, and sample availability. Values that are not stated by an authorized source must remain empty.

## Product Agent evidence locations

Before a production Product Agent call, source text is reduced to explicitly labelled evidence locations:

- `evidence-loc-line-000012-000012-…` identifies one labelled source line.
- `evidence-loc-row-000031-000031-…` identifies one Markdown table row. The model receives the table header, separator, and exactly that row.

The final digest also binds the location to the base evidence reference and excerpt text. Locator IDs use the same private-reference character and length rules as downstream content and video contracts.

Unlabelled narrative is excluded. Images remain non-structural and cannot support product facts. Every populated Product Agent field must cite one supplied location. After model output, the server runs the canonical fact checks again against only the cited excerpt. A citation to another catalog row, an unrelated label, an unknown location, or the whole document is rejected.

Catalog extraction derives locations after candidate scoping. Therefore one candidate cannot use an adjacent candidate row as evidence. Persisted `evidence_refs` contains only locations actually used by populated fields.

## Gate 01 review

A reviewer should verify all of the following before approval:

- the field value matches the cited private source location;
- OE numbers appear under an explicit OE/OEM label rather than a generic part or kit number;
- fitment, dimensions, spline data, friction material, commercial terms, and safety-related statements are not inferred;
- required identity and OE-or-complete-application blockers are cleared;
- revisions preserve or replace each field's own evidence rather than reusing a blanket reference.

Approval changes product truth only. Product media still requires its own review.

## ProductMedia and VideoReady

Product media bytes remain in private evidence storage. Browser-supplied technical metadata is not trusted: Sandbox tooling derives media type, dimensions, duration, frame rate, and audio presence. Human media review is separate from product-fact review.

Rights are explicit and independent: editing, public distribution, paid advertising, image-to-video, and reference-to-video permission are not interchangeable. Expiry and revocation immediately affect `VideoReady`.

Marketing-video creation may select approved ProductMedia by ID. The server reloads and locks the current product and media rows, preserves per-asset rights evidence, and records ProductMedia provenance in the video aggregate. Current rights are checked again before AI-assisted editing, render start, render completion, and final video approval.

The AI editor chooses only server-governed shot candidates. It cannot invent trim points. Verified-fact captions are rendered from current ProductReady claims on the server and are checked again when the final timeline is compiled.

## Operational notes

Production databases must apply the ProductMedia and shot-analysis migrations in order. The configured video Sandbox image must be pinned to an immutable digest containing FFmpeg and ffprobe. Keep video-generation providers and automatic publication disabled unless a separate governed change explicitly enables them.

Useful verification commands:

```bash
pnpm test:product-catalog-entry
pnpm test:product-agent-evidence
pnpm test:product-media
pnpm test:product-media-workflow
pnpm typecheck
pnpm db:check
pnpm build
pnpm test:e2e
```
