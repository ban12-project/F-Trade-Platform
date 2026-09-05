export type MvpAcceptanceCriterionId =
  | "product_import"
  | "content_gate"
  | "rfq_completion"
  | "quotation_handoff"
  | "follow_up_opportunity"
  | "gate_bypass";

export interface MvpAcceptanceSummary {
  criteria: Array<{
    criterion_id: MvpAcceptanceCriterionId;
    status: "passed" | "failed" | "not_run";
  }>;
  metrics: {
    factual_error_count: number;
    rfq_total: number;
    rfq_ready: number;
    gate_bypass_count: number;
    blocked_external_dependency_count: number;
  };
  decision: { status: "pending" | "go" | "no_go" };
}

const REQUIRED_CRITERIA = new Set<MvpAcceptanceCriterionId>([
  "product_import",
  "content_gate",
  "rfq_completion",
  "quotation_handoff",
  "follow_up_opportunity",
  "gate_bypass",
]);

export function assertMvpAcceptanceDecision(summary: MvpAcceptanceSummary) {
  const criterionIds = new Set(summary.criteria.map((criterion) => criterion.criterion_id));
  if (
    criterionIds.size !== REQUIRED_CRITERIA.size ||
    [...REQUIRED_CRITERIA].some((id) => !criterionIds.has(id))
  ) {
    throw new Error("MVP acceptance summary must contain every required criterion exactly once");
  }
  if (summary.metrics.rfq_ready > summary.metrics.rfq_total) {
    throw new Error("RFQ Ready count cannot exceed RFQ total");
  }
  if (summary.decision.status !== "go") return;
  if (summary.criteria.some((criterion) => criterion.status !== "passed")) {
    throw new Error("Go decision requires every acceptance criterion to pass");
  }
  if (summary.metrics.factual_error_count !== 0 || summary.metrics.gate_bypass_count !== 0) {
    throw new Error("Go decision requires zero factual errors and gate bypasses");
  }
  if (summary.metrics.rfq_ready !== summary.metrics.rfq_total) {
    throw new Error("Go decision requires every RFQ to be ready");
  }
  if (summary.metrics.blocked_external_dependency_count !== 0) {
    throw new Error("Go decision requires no blocked external dependencies");
  }
}
