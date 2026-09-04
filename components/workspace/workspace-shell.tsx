"use client";
import type { ReactNode } from "react";
import { WorkspaceDirtyProvider } from "./dirty-state";

// The dock is a sibling of page/loading boundaries, not a child of an async page.
export function WorkspaceShell({ children, dock }: { children: ReactNode; dock: ReactNode }) {
  return (
    <WorkspaceDirtyProvider>
      {children}
      {dock}
    </WorkspaceDirtyProvider>
  );
}
