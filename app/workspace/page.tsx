import { Suspense } from "react";

import { WorkspaceCanvasSkeleton } from "@/components/workspace/workspace-canvas-skeleton";
import { WorkspaceHub } from "@/components/workspace/workspace-hub";
import { requirePermission } from "@/lib/auth-guard";
import { listWorkspaceProjects } from "@/lib/workspace/store";

async function WorkspaceContent() {
  await requirePermission("workspace:view");
  return <WorkspaceHub projects={await listWorkspaceProjects()} />;
}

export default function WorkspacePage() { return <Suspense fallback={<WorkspaceCanvasSkeleton />}><WorkspaceContent /></Suspense>; }
