import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultProjectStage, requestedProjectStage } from "../lib/workspace/stages";
import type { WorkspaceTaskSummary } from "../lib/workspace/store";

assert.equal(requestedProjectStage("marketing", "content"), "content");
assert.equal(requestedProjectStage("marketing", "quotation"), undefined);
assert.equal(requestedProjectStage("sales", "lead", "opportunity"), "opportunity");
assert.equal(requestedProjectStage("sales", "lead", "follow_up"), "follow-up");
assert.equal(requestedProjectStage("sales", "lead", "rfq"), "inbound");
assert.equal(requestedProjectStage("sales", "delivery"), "delivery");
assert.equal(defaultProjectStage("marketing", [], [], false), "product");
assert.equal(
  defaultProjectStage("marketing", [], [{ type: "content", state: "CONTENT_DRAFT" }], false),
  "content",
);
assert.equal(
  defaultProjectStage("marketing", [], [{ type: "video", state: "VIDEO_DRAFT" }], false),
  "video",
);
assert.equal(defaultProjectStage("marketing", [], [], true), "publication");
const task: WorkspaceTaskSummary = {
  id: "task",
  projectId: "project",
  projectTitle: "Synthetic",
  nodeKind: "product",
  title: "Review",
  detail: "Synthetic",
  priority: "review",
  createdAt: new Date("2026-09-04T00:00:00Z"),
};
assert.equal(
  defaultProjectStage("marketing", [task], [{ type: "video", state: "VIDEO_DRAFT" }], true),
  "product",
);
assert.equal(defaultProjectStage("sales", [], [], false), "rfq");
assert.equal(
  defaultProjectStage("sales", [], [{ type: "quotation", state: "QUOTE_DRAFT" }], false),
  "quotation",
);
assert.equal(
  defaultProjectStage("sales", [], [{ type: "lead", state: "FOLLOW_UP" }], false),
  "follow-up",
);
assert.equal(
  defaultProjectStage(
    "sales",
    [],
    [
      { type: "lead", state: "FOLLOW_UP" },
      { type: "delivery_confirmation", state: "DELIVERY_CONFIRMATION_PENDING" },
    ],
    false,
  ),
  "delivery",
);
assert.equal(
  defaultProjectStage(
    "sales",
    [],
    [
      { type: "lead", state: "OPPORTUNITY" },
      { type: "delivery_confirmation", state: "DELIVERY_CONFIRMATION_PENDING" },
    ],
    false,
  ),
  "opportunity",
);
const source = (path: string) => readFileSync(path, "utf8");
assert.match(source("app/workspace/layout.tsx"), /WorkspaceShell/);
assert.match(source("app/workspace/layout.tsx"), /Suspense/);
for (const path of [
  "components/workspace/project-workspace.tsx",
  "components/workspace/workspace-dashboard.tsx",
])
  assert.doesNotMatch(source(path), /WorkspaceActionDock/);
const page = source("app/workspace/[projectId]/page.tsx");
assert.match(page, /StageTasks/);
assert.match(page, /ProjectStagePanel/);
assert.doesNotMatch(
  page,
  /listProjectProductCatalogEntries|listProjectPublicationData|listStoredProductAgentModelSettings/,
);
assert.match(source("components/workspace/project-stage-panel.tsx"), /switch\s*\(stage\)/);
assert.match(source("lib/auth-guard.ts"), /getRequestSession\s*=\s*cache\(/);
assert.doesNotMatch(source("lib/auth-guard.ts"), /["']use cache["']/);
assert.match(source("components/workspace/workspace-link.tsx"), /onNavigate=/);
assert.match(source("lib/actions/workspace.ts"), /revalidatePath\("\/workspace",\s*"layout"\)/);
console.log(
  "PASS workspace stage defaults, legacy task links, persistent shell, and scoped loading contracts",
);

const packageConfig = JSON.parse(source("package.json"));
const biomeConfig = JSON.parse(source("biome.json"));
assert.match(packageConfig.devDependencies["@biomejs/biome"], /^\d+\.\d+\.\d+$/);
assert.equal(
  biomeConfig.$schema,
  `https://biomejs.dev/schemas/${packageConfig.devDependencies["@biomejs/biome"]}/schema.json`,
);
assert.match(packageConfig.scripts.build, /^pnpm check &&/);
console.log("PASS pinned Biome schema and deployment build quality gate");
