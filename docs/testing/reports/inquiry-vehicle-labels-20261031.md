# Explicit vehicle labels in customer replies

Issue #714, MVP1 sections 16–18. The original extractor recognized a small brand vocabulary and `Toyota Corolla clutch`, but missed separate `Brand: Isuzu` / `Vehicle model: D-Max` replies. A new failing history assertion reproduced that gap before implementation.

Explicit `Brand`, `Vehicle brand`, `Model`, and `Vehicle model` fields now accept bounded customer text at the beginning of a field (message start, newline, comma or semicolon), separated by `:` or `=`. A model can be collected before the brand; it does not by itself satisfy the RFQ vehicle requirement. The values are customer requests, not verified product fitment or factory facts. The existing suggestion response retains field-level message references and separate manual saving.

Conflicting labels, alternatives, unknown/negated values, unsupported punctuation and values over 100 characters remain manual. Recognized but unusable labels mark the field uncertain so an older model is not silently reused. A brand conflict also suppresses its previously collected model. `Product model:` is not interpreted as a vehicle model. Unlabelled unsupported prose remains manual.

Local validation on Node 24.22.1:

- Sales clarification, inquiry history, sales journey, RFQ completeness and synthetic demo scripts passed using `node --import tsx`. The package-script attempt encountered sandbox IPC-listening denial before executing tests; the import runner avoids that CLI socket without changing assertions.
- Coverage includes independent brand/model source references, model-before-brand completeness, mixed labels/newlines, conflicting prose and labels, alternatives, negation, duplicate labels, changed brands and no truncation of long values.
- TypeScript and targeted Biome passed; Biome retains the pre-existing `Record<string, any>` warning. Diff whitespace check passed.

No UI, authorization, database query, persistence or sending boundary changed. This is domain/aggregation verification, not a new browser/database run or real customer/DM acceptance. Automatic CI remains paused under #711; retained tests remain available for final acceptance.
