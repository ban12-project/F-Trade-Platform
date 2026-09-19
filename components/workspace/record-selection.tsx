import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  isWorkspaceRecordKind,
  workspaceCollection,
  workspaceRecordHref,
} from "@/lib/workspace/navigation";
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
        href={`/workspace/${workspaceCollection(stage)}?project=${projectId}`}
        className={buttonVariants({ variant: "outline", className: "self-start" })}
      >
        返回记录列表
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

export function ReadOnlyRecordList({
  projectId,
  stage,
  entries,
}: {
  projectId: string;
  stage: string;
  entries: Array<{ id: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-sm text-muted-foreground">
        当前为只读视图。选择记录查看详情，写入或审核由项目编辑者处理。
      </p>
      {entries.length ? (
        entries.map((entry) => (
          <WorkspaceLink
            key={entry.id}
            href={workspaceRecordHref(
              projectId,
              isWorkspaceRecordKind(stage) ? stage : "lead",
              entry.id,
            )}
            className={buttonVariants({ variant: "outline", className: "justify-start" })}
          >
            {entry.label}
          </WorkspaceLink>
        ))
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>当前还没有记录</EmptyTitle>
            <EmptyDescription>等待项目编辑者创建后即可查看。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
