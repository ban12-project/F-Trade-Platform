import type { ReactNode } from "react";
import type { WorkspaceRecordKind } from "@/lib/workspace/navigation";

export function RecordAccessBoundary({
  canWrite,
  kind,
  mode,
  children,
}: {
  canWrite: boolean;
  kind: WorkspaceRecordKind;
  mode: "record" | "create";
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      {!canWrite ? (
        <p role="status" className="text-sm text-muted-foreground">
          当前为只读视图。写入和审核由有权限的项目编辑者处理。
        </p>
      ) : null}
      {kind === "product" && mode === "record" ? (
        // Product records guard mutation panels locally so evidence navigation stays available.
        children
      ) : (
        <fieldset disabled={!canWrite} className="min-w-0 border-0 p-0">
          {children}
        </fieldset>
      )}
    </div>
  );
}
