"use client";
import { type ReactNode, Suspense } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import type { WorkspaceProjectSummary } from "@/lib/workspace/types";
import { BackgroundTasksIndicator, BackgroundTasksProvider } from "./background-tasks";
import { WorkspaceDirtyProvider } from "./dirty-state";
import { NewWorkProvider } from "./new-work";
import { WorkspaceCommandPalette } from "./workspace-command-palette";
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
      <BackgroundTasksProvider>
        <NewWorkProvider projects={projects} basePath={basePath}>
          <SidebarProvider>
            {navigation ?? (
              <Suspense fallback={null}>
                <WorkspaceNavigation canManage={canManage} basePath={basePath} />
              </Suspense>
            )}
            <div className="workspace-layout min-w-0 flex-1">
              <header className="flex h-12 items-center justify-between gap-2 border-b px-4">
                <div className="flex items-center gap-2">
                  <SidebarTrigger
                    aria-label="打开导航"
                    className="md:hidden"
                    data-guide="mobile-navigation"
                  />
                  <span className="text-sm font-semibold md:hidden">F-Trade</span>
                  <Suspense fallback={null}>
                    <WorkspaceGuide />
                  </Suspense>
                </div>
                <div className="flex items-center gap-2">
                  <WorkspaceCommandPalette basePath={basePath} />
                  <BackgroundTasksIndicator />
                </div>
              </header>
              {children}
            </div>
          </SidebarProvider>
        </NewWorkProvider>
      </BackgroundTasksProvider>
    </WorkspaceDirtyProvider>
  );
}
