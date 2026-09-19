import { type ReactNode, Suspense } from "react";
import { Sidebar, SidebarHeader } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceFacebookAttention } from "@/components/workspace/workspace-facebook-attention";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { WorkspaceNavigationData } from "@/components/workspace/workspace-shell-data";

function NavigationLoading() {
  return (
    <Sidebar>
      <SidebarHeader className="gap-4 p-4">
        <span className="text-lg font-semibold">F-Trade</span>
        <Skeleton className="h-9 w-full" />
        {["tasks", "products", "content", "customers"].map((key) => (
          <Skeleton key={key} className="h-10 w-full" />
        ))}
      </SidebarHeader>
    </Sidebar>
  );
}
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceShell
      navigation={
        <Suspense fallback={<NavigationLoading />}>
          <WorkspaceNavigationData />
        </Suspense>
      }
    >
      <Suspense fallback={null}>
        <WorkspaceFacebookAttention />
      </Suspense>
      {children}
    </WorkspaceShell>
  );
}
