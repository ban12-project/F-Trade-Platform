import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  workspaceCreateHref,
  workspaceRecordHref,
  workspaceReturnTo,
  workspaceTaskHref,
} from "../lib/workspace/navigation";
import type { WorkspaceTaskSummary } from "../lib/workspace/types";

const task: WorkspaceTaskSummary = {
  id: "task",
  projectId: "project",
  projectTitle: "Synthetic",
  recordKind: "product",
  title: "Review",
  detail: "Synthetic",
  priority: "review",
  createdAt: new Date("2026-09-04"),
  destination: { type: "record", kind: "product", id: "object" },
};
assert.equal(workspaceTaskHref(task), "/workspace/project/records/product/object");
assert.equal(
  workspaceTaskHref({ ...task, recordKind: "lead", taskType: "opportunity" }),
  "/workspace/project/records/product/object",
  "Display metadata cannot rewrite a destination",
);
assert.equal(
  workspaceTaskHref({
    ...task,
    destination: { type: "create", kind: "rfq", source: { kind: "lead", id: "lead" } },
  }),
  "/workspace/project/new/rfq?lead=lead",
);
assert.equal(workspaceRecordHref("project", "video", "v"), "/workspace/project/video?item=v");
assert.equal(
  workspaceCreateHref("project", "video", { kind: "product", id: "p" }),
  "/workspace/project/video?new=1&product=p",
);
const returnTo =
  "/workspace/content?project=00000000-0000-4000-8000-000000000101&type=content&state=CONTENT_APPROVED";
assert.equal(workspaceReturnTo(returnTo), returnTo);
assert.equal(workspaceReturnTo("/workspace?view=waiting"), "/workspace?view=waiting");
for (const bad of [
  "https://example.org",
  "//example.org",
  "/workspace/settings",
  "/workspace/x",
  "/workspace/content#x",
  "/workspace/content?next=https://example.org",
  "/workspace/content?project=a&project=b",
  "/workspace\\content",
  "/workspace/products/../content",
  "/workspace/%2e%2e/workspace",
  "/workspace/content#",
  "/workspace?view=%00",
  "/workspace?view=%5c",
  ["/workspace"],
])
  assert.equal(workspaceReturnTo(bad), undefined);
assert.equal(
  workspaceTaskHref(task, returnTo),
  `/workspace/project/records/product/object?returnTo=${encodeURIComponent(returnTo)}`,
);
assert.equal(
  workspaceTaskHref(task, "/testing/project-workspace"),
  "/workspace/project/records/product/object",
);
const source = (path: string) => readFileSync(path, "utf8");
assert.match(source("app/workspace/layout.tsx"), /WorkspaceShell/);
assert.match(source("components/workspace/project-page.tsx"), /旧阶段链接已停用/);
assert.doesNotMatch(
  source("components/workspace/project-page.tsx"),
  /ProjectStage|readWorkspaceLibrary|defaultStage/,
);
assert.doesNotMatch(
  source("components/workspace/record-page.tsx"),
  /ProjectStage|readWorkspaceLibrary/,
);
assert.match(source("components/workspace/record-page.tsx"), /readWorkspaceRecord/);
assert.match(source("lib/auth-guard.ts"), /getRequestSession\s*=\s*cache\(/);
assert.doesNotMatch(source("lib/auth-guard.ts"), /["']use cache["']/);
assert.match(source("components/workspace/workspace-link.tsx"), /onNavigate=/);
assert.match(source("lib/action-boundary.ts"), /revalidatePath\("\/workspace",\s*"layout"\)/);
assert.ok(existsSync("app/workspace/projects/page.tsx"));
const packageConfig = JSON.parse(source("package.json"));
const biomeConfig = JSON.parse(source("biome.json"));
assert.equal(
  biomeConfig.$schema,
  `https://biomejs.dev/schemas/${packageConfig.devDependencies["@biomejs/biome"]}/schema.json`,
);
assert.match(packageConfig.scripts.build, /^pnpm check &&/);
console.log(
  "PASS explicit record/create destinations, restricted return context, project management and auth cache boundaries",
);
