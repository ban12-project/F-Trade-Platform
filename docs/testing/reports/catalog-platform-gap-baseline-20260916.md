# Cross-platform catalog gap baseline — 2026-09-16

Issue #350 follows the bounded acceptance in #346. No original identifiers, reference images or raw OCR are published here.

The original five-page baseline remains 26/26 locally and in the pinned cloud image. Comparing the full first-document output found four local-only identifier/page pairs and one cloud-only pair. No candidate from the earlier pre-#346 baseline was absent from the cloud output. The aggregate difference of three candidates therefore concealed five disagreements.

Read-only inspection of complete rendered physical pages 24, 29 and 32 confirmed 18 visible kit headings. These literal values and the original source hash were frozen privately before further extraction changes. Both environments also miss headings that the other environment misses, so agreement alone is not a sufficient correctness test.

| Physical page | Visually expected | Native output | Pinned cloud output |
| --- | ---: | ---: | ---: |
| 24 | 6 | 4 | 5 |
| 29 | 6 | 5 | 2 |
| 32 | 6 | 6 | 5 |
| Total | 18 | 15 | 12 |

Baseline source: `c4c2b28`; cloud image digest: `sha256:cd20c8d265c1292c864b081a698202f0d4c98490142aca2ed62f0470098f6613`. These are additional verified extraction gaps, not invented product facts or grounds for automatic factory approval. The original files remain unchanged. Existing cloud cleanup remains valid; this investigation initially uses retained local outputs and read-only local rendering.

Acceptance requires the new frozen 18-heading baseline and the earlier 26-heading baseline to pass in both environments, with synthetic regressions and preserved original text/location evidence. Engineering facts must not be inferred from nearby components to make a candidate pass. Full-catalog visual coverage is still incomplete.

## Repair and completed acceptance

Source commit `5cd72cd` fixes two observed causes. The Tesseract TSV reader now treats quotes as literal token characters; unmatched image-noise quotes can no longer consume later physical rows. A damaged `Kit` label with digits may locate a bounded reread region, but is accepted only when that region independently yields a complete, confident literal `Kit No.:` heading. Blank headings remain excluded; component facts and neighboring digits are not borrowed.

The unchanged eight-page frozen baseline passed with 44/44 headings, in expected order and without extras, both locally and in the newly pinned cloud image. The complete first-file candidate multisets (identifier plus physical page, including occurrence counts) match exactly at 72 entries. Cross-platform agreement alone still does not constitute complete visual ground truth.

All four original PDF hashes and all 122 physical-page markers remained unchanged. Relative to #346's local outputs, candidate counts changed from 68/111/62/0 to 72/115/62/0 with zero lost prior identifier/page occurrences. Existing page-19 component source blocks remained identical. The additional unfrozen candidates require source review.

Synthetic regressions passed for literal quotes, bounded damaged-label rereads, wrong/missing labels, confidence and ambiguity rejection, component isolation and no-lost-identifier fallback. Native/mixed/scanned PDF preprocessing and source-only image-context tests passed. Local and deny-all cloud container tests passed for document processing and synthetic subtitle H.264/AAC rendering; installed script hashes matched this source commit.

Private image tag: `ocr-350-5cd72cd`.

Image digest: `sha256:6e1c7717608c80787748a71a0f018c95330164edce5ceaffa8166421c9231cf6`.

The complete original first PDF passed cloud preprocessing at 2 vCPUs with the existing 600-second limit. Sandbox creation, file transfer, processing and validation took 261 seconds. Both the synthetic-test and actual-reference Sandboxes were stopped and deleted. Temporary registry credentials were removed and the initially stopped local VM was stopped again. No new Blob upload was needed for this repair's tests; #346's two test uploads were already deleted and verified absent.

This repair changes Python preprocessing only. It does not claim a new browser/model approval run or a new Next.js production build. Prior #346 browser/Gate and build evidence remains separately scoped. No actual factory approval, production image-pin change, remote CI pass or deployed-runtime acceptance is claimed. GitHub delivery remains pending its credential scope correction.
