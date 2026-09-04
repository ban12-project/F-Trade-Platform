
import assert from "node:assert/strict";

import { createWorkspaceProjectSchema } from "../lib/workspace/contracts";
import { workspaceTaskHref } from "../lib/workspace/navigation";
import type { WorkspaceTaskSummary } from "../lib/workspace/store";

assert.equal(createWorkspaceProjectSchema.parse({ kind: "marketing", title: "  Synthetic marketing project  " }).title, "Synthetic marketing project");
assert.throws(() => createWorkspaceProjectSchema.parse({ kind: "invalid", title: "x" }));
assert.throws(() => createWorkspaceProjectSchema.parse({ kind: "sales", title: "" }));

const task: WorkspaceTaskSummary = {
  id: "00000000-0000-4000-8000-000000000101",
  projectId: "00000000-0000-4000-8000-000000000102",
  projectTitle: "Synthetic project",
  nodeKind: "content",
  title: "Review content",
  detail: "Waiting for a human",
  priority: "review",
  createdAt: new Date("2026-09-04T00:00:00Z"),
};
assert.equal(workspaceTaskHref(task), `/workspace/${task.projectId}?panel=content&item=${task.id}`);
assert.equal(workspaceTaskHref({ ...task, nodeKind: "video" }), `/workspace/${task.projectId}/video?item=${task.id}`);
assert.equal(workspaceTaskHref(task, "/testing/project-workspace"), `/testing/project-workspace?panel=content&item=${task.id}`);

console.log("PASS workspace project navigation contracts");
