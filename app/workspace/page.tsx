import { Suspense } from "react";

import { ConsoleLoading } from "@/components/console-loading";
import { WorkspaceHub } from "@/components/workspace/workspace-hub";
import { requirePermission } from "@/lib/auth-guard";
import { listWorkspaceProjects } from "@/lib/workspace/store";

async function WorkspaceContent() {
  await requirePermission("workspace:view");
  return <WorkspaceHub projects={await listWorkspaceProjects()} />;
}

export default function WorkspacePage() { return <Suspense fallback={<ConsoleLoading />}><WorkspaceContent /></Suspense>; }
