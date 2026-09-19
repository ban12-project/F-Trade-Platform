import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { WorkspaceLink } from "./workspace-link";

export function RecordSelection({
  projectId,
  stage,
  selectedId,
  found,
  children,
}: {
  projectId: string;
  stage: string;
  selectedId?: string;
  found: boolean;
  children: ReactNode;
}) {
  if (!selectedId) return children;
  return (
    <div className="flex flex-col gap-4">
      <WorkspaceLink
        href={`/workspace/${projectId}?panel=${stage}`}
        className={buttonVariants({ variant: "outline", className: "self-start" })}
      >
        返回本步骤全部记录
      </WorkspaceLink>
      {found ? (
        children
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>这条记录已不可用</EmptyTitle>
            <EmptyDescription>
              记录可能已更新或不在当前可访问范围。请返回列表选择要处理的记录。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
