import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { productAgentEvalCases } from "../evals/harbor/product-agent/cases";
import { evaluationExpectation } from "../evals/harbor/product-agent/expectations";
import { finalizeProductAgentDraft } from "../lib/product/agent";
import { EvidenceLocatedProductAgent } from "../lib/product/evidence-located-agent";

async function main() {
  const fixtures = [];
  for (const item of productAgentEvalCases) {
    const expected = evaluationExpectation(item);
    const metadata = {
      prompt_version: expected.prompt_version,
      prompt_hash: expected.prompt_hash,
      evidence_mode: expected.evidence_mode,
    };
    const result = await new EvidenceLocatedProductAgent({
      async run({ source }) {
        return {
          draft: finalizeProductAgentDraft(
            {
              record_id: source.record_id,
              source_ref: source.source_ref,
              evidence_refs: source.evidence_refs,
              field_evidence: Object.fromEntries(
                Object.entries(expected.field_evidence).map(([field, refs]) => [field, refs[0]]),
              ),
              verification_status: "review_required",
              optional_missing_fields: [],
              ...item.expected,
              ...(item.expected.commercial?.packaging
                ? { commercial: { packaging: "  Neutral   carton. " } }
                : {}),
            },
            source,
          ),
          metadata,
        };
      },
    }).run({ source: item.source, model: {} as never });
    assert.deepEqual(result.draft.blocking_missing_fields, item.expected.blocking_missing_fields);
    if (item.expected.commercial?.packaging)
      assert.equal(
        result.draft.commercial?.packaging,
        "neutral carton",
        "production and verifier share packaging semantics",
      );
    fixtures.push({ expected, result: { draft: result.draft, _evaluation: metadata } });
  }
  const directory = mkdtempSync(join(tmpdir(), "f-trade-harbor-tests-"));
  try {
    const path = join(directory, "fixtures.json");
    writeFileSync(path, JSON.stringify(fixtures));
    execFileSync("python3", ["scripts/test-harbor-product-agent.py", path], { stdio: "inherit" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  console.log("PASS 20 frozen synthetic expectations traverse the production evidence wrapper");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
