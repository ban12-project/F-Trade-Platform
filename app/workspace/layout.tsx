import { type ReactNode, Suspense } from "react";
import { WorkspaceDockData } from "@/components/workspace/workspace-dock-data";
import { WorkspaceDockSkeleton } from "@/components/workspace/workspace-loading-skeleton";
import { WorkspaceFacebookAttention } from "@/components/workspace/workspace-facebook-attention";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceShell
      dock={
        <Suspense fallback={<WorkspaceDockSkeleton />}>
          <WorkspaceDockData />
        </Suspense>
      }
    >
      <Suspense fallback={null}><WorkspaceFacebookAttention /></Suspense>
      {children}
    </WorkspaceShell>
  );
}
