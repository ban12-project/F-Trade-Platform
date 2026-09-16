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
