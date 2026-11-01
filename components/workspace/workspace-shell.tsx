"use client";
import { type ReactNode, Suspense } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import type { WorkspaceProjectSummary } from "@/lib/workspace/types";
import { WorkspaceDirtyProvider } from "./dirty-state";
import { NewWorkProvider } from "./new-work";
import { WorkspaceGuide } from "./workspace-guide";
import { WorkspaceNavigation } from "./workspace-navigation";

// The navigation is a sibling of page/loading boundaries and survives page transitions.
export function WorkspaceShell({
  children,
  projects,
  canManage,
  basePath,
  navigation,
}: {
  children: ReactNode;
  projects?: WorkspaceProjectSummary[];
  navigation?: ReactNode;
  canManage?: boolean;
  basePath?: string;
}) {
  return (
    <WorkspaceDirtyProvider>
      <NewWorkProvider projects={projects} basePath={basePath}>
        <SidebarProvider>
          {navigation ?? (
            <Suspense fallback={null}>
              <WorkspaceNavigation canManage={canManage} basePath={basePath} />
            </Suspense>
          )}
          <div className="min-w-0 flex-1">
            <header className="flex h-12 items-center gap-2 border-b px-4">
              <SidebarTrigger
                aria-label="打开导航"
                className="md:hidden"
                data-guide="mobile-navigation"
              />
              <span className="text-sm font-semibold md:hidden">F-Trade</span>
              <Suspense fallback={null}>
                <WorkspaceGuide />
              </Suspense>
            </header>
            {children}
          </div>
        </SidebarProvider>
      </NewWorkProvider>
    </WorkspaceDirtyProvider>
  );
}
