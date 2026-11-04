import type { TaskRecord, WorkspaceTaskSnapshot } from "../../../lib/workspace/task-model";

export function syntheticFunnelSnapshot(): WorkspaceTaskSnapshot {
  const date = new Date("2026-10-01T00:00:00Z");
  const records: TaskRecord[] = [
    { id: "synthetic-product", type: "product", state: "PRODUCT_READY", payload: {} },
    { id: "synthetic-content", type: "content", state: "CONTENT_PUBLISHED", payload: {} },
    {
      id: "synthetic-rfq",
      type: "rfq",
      state: "RFQ_READY",
      payload: {
        rfq_id: "synthetic-rfq",
        customer: {},
        product: { product_type: "clutch_disc", oe_number: "SYNTHETIC-ONLY" },
        commercial: { quantity: 1, destination: "Synthetic test destination" },
        status: "ready",
        completeness_score: 100,
        missing_fields: [],
      },
    },
    {
      id: "synthetic-quote",
      type: "quotation",
      state: "QUOTE_SENT",
      payload: {
        status: "sent",
        created_by_actor_type: "human",
        approval_ref: "synthetic-quote-approval",
        sent_at: date.toISOString(),
        sent_channel: "synthetic-channel",
        sent_ref: "synthetic-receipt",
      },
    },
    {
      id: "synthetic-opportunity",
      type: "lead",
      state: "OPPORTUNITY",
      payload: { status: "opportunity" },
    },
  ].map((row) => ({
    ...row,
    projectId: "synthetic-project",
    version: 1,
    relation: "owned",
    createdAt: date,
    updatedAt: date,
  }));
  return {
    projects: [
      {
        id: "synthetic-project",
        title: "Synthetic test project",
        kind: "sales",
        status: "active",
        memberRole: "viewer",
        appRole: "user",
        updatedAt: date,
      },
    ],
    records,
    approvals: [
      {
        id: "synthetic-product-approval",
        aggregateId: "synthetic-product",
        gate: "gate_01_truth",
        status: "approved",
        requestedAt: date,
        createdAt: date,
      },
      {
        id: "synthetic-quote-approval",
        aggregateId: "synthetic-quote",
        gate: "gate_02_quote",
        status: "approved",
        requestedAt: date,
        createdAt: date,
      },
    ],
    publications: [
      {
        id: "synthetic-publication",
        projectId: "synthetic-project",
        contentRef: "synthetic-content",
        status: "published",
        createdAt: date,
      },
    ],
    hasActiveChannel: false,
  };
}
