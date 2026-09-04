import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { WorkspaceActionDock } from "@/components/workspace/workspace-action-dock";
import { WorkspaceDockSkeleton } from "@/components/workspace/workspace-loading-skeleton";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { navigationProject } from "./data";
export default function Layout({ children }: { children: ReactNode }) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <WorkspaceShell
      dock={
        <Suspense fallback={<WorkspaceDockSkeleton />}>
          <WorkspaceActionDock
            projects={[navigationProject]}
            tasks={[]}
            basePath="/testing/workspace-navigation"
          />
        </Suspense>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
