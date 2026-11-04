import assert from "node:assert/strict";
import {
  formatTaskDeadline,
  isTaskOverdue,
  workspaceTaskContext,
} from "../lib/workspace/task-context";
import { deriveWorkspaceTasks, type TaskRecord } from "../lib/workspace/task-model";

const now = new Date("2026-11-04T10:00:00Z");
function record(
  id: string,
  type: string,
  payload: Record<string, unknown>,
  projectId = "project",
): TaskRecord {
  return {
    id,
    projectId,
    type,
    payload,
    state: "RFQ_COLLECTING",
    relation: "owned",
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
const rfq = record("rfq", "rfq", {
  lead_ref: "lead",
  customer: { company: "SYNTHETIC Company", name: "SYNTHETIC Buyer" },
  product: { product_type: "clutch_kit", oe_number: "SYNTHETIC-OE" },
  commercial: { quantity: 25, destination: "SYNTHETIC Destination" },
});
const lead = {
  ...record("lead", "lead", {
    rfq_ref: "rfq",
    next_action: "ask_target_budget_and_escalate",
    next_follow_up_at: "2026-11-04T09:00:00Z",
  }),
  state: "FOLLOW_UP",
};
const quote = record("quote", "quotation", { rfq_id: "rfq" });
const delivery = record("delivery", "delivery_confirmation", {
  related_entity_type: "rfq",
  related_entity_id: "rfq",
});
const opportunityDelivery = record("opportunity-delivery", "delivery_confirmation", {
  related_entity_type: "opportunity",
  related_entity_id: "lead",
});
const records = [rfq, lead, quote, delivery, opportunityDelivery];
for (const row of records) {
  const context = workspaceTaskContext(row, records);
  assert.equal(context.customerLabel, "SYNTHETIC Company · SYNTHETIC Buyer");
  assert.equal(
    context.needLabel,
    "离合器套件 · OE SYNTHETIC-OE · 数量 25 · 目的地 SYNTHETIC Destination",
  );
}
assert.equal(workspaceTaskContext(lead, records).nextAction, "了解目标预算，交由人工销售评估");
assert.deepEqual(
  workspaceTaskContext(quote, [{ ...rfq, projectId: "private-project" }, quote]),
  {},
);
assert.deepEqual(workspaceTaskContext(quote, [{ ...rfq, type: "content" }, quote]), {});
assert.equal(
  workspaceTaskContext(lead, [
    { ...rfq, payload: { ...rfq.payload, lead_ref: "other-lead" } },
    lead,
  ]).customerLabel,
  undefined,
);
assert.equal(
  workspaceTaskContext({ ...lead, payload: {} }, [rfq, { ...rfq, id: "another-rfq" }])
    .customerLabel,
  undefined,
  "Ambiguous reverse links must not guess a buyer",
);
assert.deepEqual(
  workspaceTaskContext(record("empty", "rfq", { customer: null, product: [], commercial: {} }), []),
  {},
);
const product = record("product", "product", {
  product: { product_name: "SYNTHETIC Kit", internal_sku: "SYN-KIT" },
});
assert.equal(
  workspaceTaskContext(record("content", "content", { product_id: "product" }), [product])
    .needLabel,
  "SYNTHETIC Kit · SYN-KIT",
);
assert.deepEqual(
  workspaceTaskContext(record("content", "content", { product_id: "product" }), [
    { ...product, projectId: "private" },
  ]),
  {},
);
assert.equal(isTaskOverdue(new Date("2026-11-04T09:59:00Z"), now.getTime()), true);
assert.equal(isTaskOverdue(new Date("2026-11-04T10:01:00Z"), now.getTime()), false);
assert.equal(isTaskOverdue(undefined, now.getTime()), false);
assert.equal(isTaskOverdue(new Date("invalid"), now.getTime()), false);
assert.match(formatTaskDeadline(now, "Asia/Shanghai"), /18:00/);
assert.match(formatTaskDeadline(now, "America/Los_Angeles"), /02:00/);
assert.equal(formatTaskDeadline(new Date("invalid"), "UTC"), "时间待核对");
const tasks = deriveWorkspaceTasks(
  {
    projects: [
      {
        id: "project",
        title: "SYNTHETIC Project",
        kind: "sales",
        status: "active",
        memberRole: "viewer",
        appRole: "user",
        updatedAt: now,
      },
    ],
    records,
    approvals: [],
    publications: [],
    hasActiveChannel: true,
  },
  now,
);
const task = tasks.find((row) => row.id === "lead");
assert.equal(task?.customerLabel, "SYNTHETIC Company · SYNTHETIC Buyer");
assert.equal(task?.state, "waiting");
assert.equal(task?.actionLabel, "查看状态");
assert.equal(task?.responsibleLabel, "项目编辑者");
assert.equal(task?.priority, "overdue");
assert.equal(task?.nextAction, "了解目标预算，交由人工销售评估");
assert.equal(
  task?.detail.includes("2026-11-04T"),
  false,
  "Raw UTC timestamps must not leak into task prose",
);
console.log(
  "PASS task context: explicit same-project relations, unknown/ambiguous fallbacks, permission waiting, local time and overdue",
);
