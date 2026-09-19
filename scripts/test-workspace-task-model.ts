import assert from "node:assert/strict";
import { workspaceTaskHref } from "../lib/workspace/navigation";
import {
  deriveWorkspacePipeline,
  deriveWorkspaceTasks,
  isActionableTask,
  type TaskRecord,
  type WorkspaceTaskSnapshot,
} from "../lib/workspace/task-model";

const now = new Date("2026-09-19T00:00:00Z");
const project = {
  id: "p",
  title: "Synthetic task model",
  kind: "marketing" as const,
  status: "active" as const,
  updatedAt: now,
  memberRole: "editor" as const,
  appRole: "admin",
};
function record(
  state: string,
  type = "product",
  id = "r",
  payload: Record<string, unknown> = {},
): TaskRecord {
  return {
    id,
    projectId: "p",
    type,
    state,
    payload,
    version: 2,
    relation: "owned",
    createdAt: now,
    updatedAt: now,
  };
}
function snapshot(records: TaskRecord[] = []): WorkspaceTaskSnapshot {
  return { projects: [project], records, approvals: [], publications: [], hasActiveChannel: true };
}
function tasks(data: WorkspaceTaskSnapshot) {
  return deriveWorkspaceTasks(data, now);
}
const review = snapshot([record("PRODUCT_REVIEW_REQUIRED")]);
review.approvals = [
  {
    id: "a",
    aggregateId: "r",
    gate: "gate_01_truth",
    status: "pending",
    requestedAt: now,
    createdAt: now,
  },
];
assert.equal(tasks(review)[0].state, "actionable");
assert.equal(tasks(review)[0].actionLabel, "核实产品资料");
const userReview = { ...review, projects: [{ ...project, appRole: "user" }] };
assert.equal(tasks(userReview)[0].state, "waiting");
assert.equal(tasks(userReview)[0].actionLabel, "查看状态");
assert.equal(tasks(userReview).filter(isActionableTask).length, 0);
const viewerReview = { ...review, projects: [{ ...project, memberRole: "viewer" as const }] };
assert.equal(tasks(viewerReview)[0].state, "waiting");
assert.equal(tasks({ ...review, projects: [{ ...project, status: "archived" }] }).length, 0);
assert.equal(tasks({ ...review, projects: [] }).length, 0);
assert.equal(
  tasks({ ...review, records: [record("PRODUCT_READY")] }).some(
    (task) => task.taskType === "approval",
  ),
  false,
  "Dangling pending approvals cannot override the domain state",
);
assert.equal(tasks({ ...review, approvals: [] })[0].state, "attention");
assert.equal(
  tasks({
    ...review,
    approvals: [
      ...review.approvals,
      {
        ...review.approvals[0],
        id: "newer",
        status: "rejected",
        requestedAt: new Date(now.getTime() + 1000),
      },
    ],
  })[0].state,
  "attention",
  "An old pending request cannot hide a newer decision",
);
for (const [state, type, kind] of [
  ["PRODUCT_REVISION_REQUIRED", "product", "product"],
  ["CONTENT_REVISION_REQUIRED", "content", "content"],
  ["VIDEO_REVISION_REQUIRED", "video", "video"],
  ["QUOTE_REVISION_REQUIRED", "quotation", "quotation"],
]) {
  const [task] = tasks(snapshot([record(state, type)]));
  assert.equal(task.taskType, "revision");
  assert.equal(task.nodeKind, kind);
  assert.equal(task.state, "actionable");
}
const ready = snapshot([record("PRODUCT_READY")]);
assert.equal(workspaceTaskHref(tasks(ready)[0]), "/workspace/p/new/content?product=r");
assert.equal(
  tasks(
    snapshot([...ready.records, record("CONTENT_APPROVED", "content", "c", { product_id: "r" })]),
  ).filter((task) => task.taskType === "create").length,
  0,
);
const sales = snapshot([
  record("RFQ_READY", "rfq", "rfq"),
  { ...record("PRODUCT_READY", "product", "product"), relation: "reference" },
]);
sales.projects = [{ ...project, kind: "sales" }];
assert.equal(workspaceTaskHref(tasks(sales)[0]), "/workspace/p/new/quotation?rfq=rfq");
assert.equal(tasks({ ...sales, records: [sales.records[0]] })[0].actionLabel, "关联已核实产品");
const quote = record("QUOTE_REVIEW_REQUIRED", "quotation", "quote", { rfq_id: "rfq" });
assert.equal(
  tasks({ ...sales, records: [...sales.records, quote] }).filter(
    (task) => task.taskType === "create",
  ).length,
  0,
);
const lead = record("LEAD_RECEIVED", "lead", "lead", { status: "received" });
assert.equal(tasks(snapshot([lead]))[0].taskType, "rfq");
assert.equal(
  tasks(snapshot([lead, record("RFQ_COLLECTING", "rfq", "rfq", { lead_ref: "lead" })])).length,
  1,
);
const overdue = record("FOLLOW_UP", "lead", "overdue", {
  next_follow_up_at: "2026-09-18T00:00:00Z",
});
const later = record("FOLLOW_UP", "lead", "later", { next_follow_up_at: "2026-09-20T00:00:00Z" });
const timing = tasks({ ...review, records: [...review.records, later, overdue] });
assert.equal(timing[0].id, "overdue");
assert.equal(timing.find((task) => task.id === "later")?.state, "scheduled");
assert.equal(timing.filter(isActionableTask).length, 2);
for (const [status, expected] of [
  ["submitted", "processing"],
  ["confirmed", "processing"],
  ["unknown", "attention"],
  ["failed", "attention"],
  ["paused", "attention"],
  ["published", "none"],
]) {
  const data = snapshot([record("CONTENT_APPROVED", "content", "c")]);
  data.publications = [{ id: "pub", projectId: "p", contentRef: "c", status, createdAt: now }];
  const output = tasks(data);
  assert.equal(output[0]?.state ?? "none", expected);
  if (status !== "published")
    assert.equal(workspaceTaskHref(output[0]), "/workspace/p/records/publication/pub");
}
const blockedPublication = snapshot([record("CONTENT_APPROVED", "content", "c")]);
blockedPublication.hasActiveChannel = false;
assert.equal(tasks(blockedPublication)[0].state, "waiting");
assert.match(tasks(blockedPublication)[0].detail, /渠道/);
const rendering = tasks(snapshot([record("VIDEO_RENDERING", "video")]));
assert.equal(rendering[0].state, "processing");
assert.equal(rendering.filter(isActionableTask).length, 0);
for (const data of [
  review,
  userReview,
  viewerReview,
  sales,
  ready,
  snapshot(),
  blockedPublication,
]) {
  const output = tasks(data);
  const summary = deriveWorkspacePipeline(data, output)[0];
  if (output.length) {
    assert.equal(summary.nextActionHref, workspaceTaskHref(output[0]));
    assert.equal(
      summary.nextAction,
      isActionableTask(output[0]) ? output[0].actionLabel : output[0].detail,
    );
  }
}
assert.equal(deriveWorkspacePipeline(snapshot(), [])[0].currentStage, "尚未开始");
assert.equal(
  deriveWorkspacePipeline(snapshot([record("CONTENT_PUBLISHED", "content")]), [])[0].currentStage,
  "当前工作已处理",
);
console.log(
  "PASS task decision matrix: permissions, revisions, dependencies, timing, publication receipts and shared summaries",
);
