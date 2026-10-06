import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { compileContract } from "../lib/contracts/validator";
import {
  assertMvpAcceptanceDecision,
  type MvpAcceptanceSummary,
} from "../lib/testing/mvp-acceptance";

async function main() {
  const [schemaContents, fixtureContents] = await Promise.all([
    readFile(
      path.join(process.cwd(), "contracts/testing/mvp-acceptance-summary.schema.json"),
      "utf8",
    ),
    readFile(
      path.join(process.cwd(), "data/fixtures/mvp-acceptance-summary.synthetic.json"),
      "utf8",
    ),
  ]);
  const validate = compileContract<MvpAcceptanceSummary>(JSON.parse(schemaContents));
  const fixture = JSON.parse(fixtureContents);
  const validSummary = validate(fixture);
  assert.doesNotThrow(() => assertMvpAcceptanceDecision(validSummary));
  const zeroSamples = {
    ...fixture,
    metrics: { ...fixture.metrics, rfq_total: 0, rfq_ready: 0 },
  };
  assert.throws(() => validate(zeroSamples), /rfq_total must be >= 1/);
  assert.throws(
    () => assertMvpAcceptanceDecision(zeroSamples),
    /at least one RFQ acceptance sample/,
  );
  for (const status of ["pending", "no_go"] as const) {
    const decision = status === "pending" ? { status } : { ...fixture.decision, status };
    const summary = validate({ ...zeroSamples, decision });
    assert.doesNotThrow(() => assertMvpAcceptanceDecision(summary));
  }
  for (const criteria of [
    [...validSummary.criteria, validSummary.criteria[0]],
    validSummary.criteria.slice(1),
    [...validSummary.criteria.slice(0, -1), validSummary.criteria[0]],
  ]) {
    assert.throws(
      () => assertMvpAcceptanceDecision({ ...validSummary, criteria }),
      /every required criterion exactly once/,
    );
  }
  for (const metric of ["factual_error_count", "gate_bypass_count"] as const) {
    assert.throws(
      () =>
        assertMvpAcceptanceDecision({
          ...validSummary,
          metrics: { ...validSummary.metrics, [metric]: 1 },
        }),
      /zero factual errors and gate bypasses/,
    );
  }
  assert.throws(
    () =>
      assertMvpAcceptanceDecision({
        ...validSummary,
        metrics: { ...validSummary.metrics, rfq_total: 2 },
      }),
    /every RFQ to be ready/,
  );
  assert.throws(
    () =>
      assertMvpAcceptanceDecision({
        ...validSummary,
        metrics: { ...validSummary.metrics, blocked_external_dependency_count: 1 },
      }),
    /blocked external dependencies/,
  );
  assert.throws(
    () =>
      assertMvpAcceptanceDecision({
        ...validSummary,
        criteria: validSummary.criteria.map((criterion) =>
          criterion.criterion_id === "content_gate"
            ? { ...criterion, status: "failed" as const }
            : criterion,
        ),
      }),
    /every acceptance criterion/,
  );
  assert.throws(
    () =>
      assertMvpAcceptanceDecision({
        ...validSummary,
        metrics: { ...validSummary.metrics, rfq_ready: 2 },
      }),
    /cannot exceed/,
  );
  console.log("PASS MVP acceptance summary decision gates");
}

void main();
