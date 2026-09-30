import type { ReactNode } from "react";
export function RecordFrame({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-testid="record-frame"
      className="workspace-page bg-muted/30"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-5 sm:p-6">
        <header>{header}</header>
        <section aria-label="业务记录">{children}</section>
      </div>
    </main>
  );
}
