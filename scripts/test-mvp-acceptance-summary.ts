import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { compileContract } from "../lib/contracts/validator";
import { assertMvpAcceptanceDecision, type MvpAcceptanceSummary } from "../lib/testing/mvp-acceptance";

async function main() {
  const [schemaContents, fixtureContents] = await Promise.all([
    readFile(path.join(process.cwd(), "contracts/testing/mvp-acceptance-summary.schema.json"), "utf8"),
    readFile(path.join(process.cwd(), "data/fixtures/mvp-acceptance-summary.synthetic.json"), "utf8"),
  ]);
  const validSummary = compileContract<MvpAcceptanceSummary>(JSON.parse(schemaContents))(
    JSON.parse(fixtureContents),
  );
  assert.doesNotThrow(() => assertMvpAcceptanceDecision(validSummary));
  assert.throws(
    () => assertMvpAcceptanceDecision({
      ...validSummary,
      metrics: { ...validSummary.metrics, blocked_external_dependency_count: 1 },
    }),
    /blocked external dependencies/,
  );
  assert.throws(
    () => assertMvpAcceptanceDecision({
      ...validSummary,
      criteria: validSummary.criteria.map((criterion) => (
        criterion.criterion_id === "content_gate" ? { ...criterion, status: "failed" as const } : criterion
      )),
    }),
    /every acceptance criterion/,
  );
  assert.throws(
    () => assertMvpAcceptanceDecision({
      ...validSummary,
      metrics: { ...validSummary.metrics, rfq_ready: 2 },
    }),
    /cannot exceed/,
  );
  console.log("PASS MVP acceptance summary decision gates");
}

void main();
