import { notFound } from "next/navigation";

import { WorkspaceHub } from "@/components/workspace/workspace-hub";
import { WorkspaceSettingsPanel } from "@/components/workspace/workspace-settings-panel";
import type { WorkspaceProjectSummary } from "@/lib/workspace/store";

const syntheticProjects: WorkspaceProjectSummary[] = [{
  id: "00000000-0000-4000-8000-000000000197",
  title: "Synthetic project",
  kind: "marketing",
  status: "active",
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
}];

/** Test-only fixture: production canvas access remains protected by requirePermission. */
export default function WorkspaceCanvasTestingPage() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return <WorkspaceHub projects={syntheticProjects} tasks={[{ id: "00000000-0000-4000-8000-000000000198", projectId: syntheticProjects[0]!.id, projectTitle: syntheticProjects[0]!.title, nodeKind: "content", title: "Synthetic content review", detail: "等待人工审核", priority: "review", createdAt: new Date("2026-09-01T00:00:00.000Z") }]} settingsPanel={<WorkspaceSettingsPanel canManage />} />;
}
