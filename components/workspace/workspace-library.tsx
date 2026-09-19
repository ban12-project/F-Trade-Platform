"use client";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { recordKindLabels, type WorkspaceLibraryRecord } from "@/lib/workspace/library-model";
import type { WorkspaceCollection } from "@/lib/workspace/navigation";
import type { WorkspaceProjectSummary } from "@/lib/workspace/store";
import { useWorkspaceDirtyState } from "./dirty-state";
import { NewWorkButton } from "./new-work";
import { WorkspaceLink } from "./workspace-link";

export const collectionLabels = {
  products: "产品资料",
  content: "内容与发布",
  customers: "客户与询盘",
};
export function WorkspaceLibrary({
  collection,
  records,
  projects,
  projectId,
}: {
  collection: WorkspaceCollection;
  records: WorkspaceLibraryRecord[];
  projects: WorkspaceProjectSummary[];
  projectId?: string;
}) {
  const id = useId();
  const router = useRouter();
  const { requestNavigation } = useWorkspaceDirtyState();
  const unavailable = !!projectId && !projects.some((project) => project.id === projectId);
  const rows = unavailable
    ? []
    : records.filter(
        (record) =>
          record.collection === collection && (!projectId || record.projectId === projectId),
      );
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field className="w-full sm:w-72">
          <FieldLabel htmlFor={id}>归属项目</FieldLabel>
          <NativeSelect
            className="w-full"
            id={id}
            value={projectId ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              requestNavigation(() =>
                router.push(`/workspace/${collection}${value ? `?project=${value}` : ""}`),
              );
            }}
          >
            <NativeSelectOption value="">全部可访问项目</NativeSelectOption>
            {unavailable ? (
              <NativeSelectOption value={projectId}>该项目不可访问</NativeSelectOption>
            ) : null}
            {projects.map((project) => (
              <NativeSelectOption key={project.id} value={project.id}>
                {project.title}
                {project.memberRole === "viewer"
                  ? "（只读）"
                  : project.status === "archived"
                    ? "（已归档）"
                    : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <NewWorkButton
          intent={
            collection === "products" ? "product" : collection === "content" ? "content" : "rfq"
          }
        >
          {collection === "products"
            ? "录入产品"
            : collection === "content"
              ? "制作内容"
              : "记录询盘"}
        </NewWorkButton>
      </div>
      {rows.length ? (
        <ul className="divide-y rounded-xl border bg-background">
          {rows.map((record) => (
            <li key={`${record.projectId}:${record.kind}:${record.id}`}>
              <WorkspaceLink
                href={record.href}
                className="flex min-h-20 flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{record.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {recordKindLabels[record.kind]} · {record.projectTitle}
                    {record.relation !== "owned" ? " · 引用资料，只读" : ""}
                  </p>
                </div>
                <Badge variant="outline">{record.statusLabel}</Badge>
              </WorkspaceLink>
            </li>
          ))}
        </ul>
      ) : (
        <Empty className="border bg-background">
          <EmptyHeader>
            <EmptyTitle>
              {unavailable ? "这个项目不可访问" : `还没有${collectionLabels[collection]}记录`}
            </EmptyTitle>
            <EmptyDescription>
              {unavailable
                ? "链接中的项目不存在或你不是成员。请选择可访问项目。"
                : collection === "products"
                  ? "从工厂资料或人工录入开始，核验后才能用于营销与报价。"
                  : collection === "content"
                    ? "先完成产品资料核验，再选择已核验产品制作内容；视频是可选形式。"
                    : "记录客户已经提出的需求，再补齐产品、数量和目的地。"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
