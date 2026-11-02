import type { ReactNode } from "react";
import { WorkspaceToolbar } from "./workspace-toolbar";
export function RecordFrame({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-testid="record-frame"
      className="workspace-page workspace-layout bg-muted/30"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-5 sm:p-6">
        <WorkspaceToolbar>{header}</WorkspaceToolbar>
        <section aria-label="业务记录">{children}</section>
      </div>
    </main>
  );
}
