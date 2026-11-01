"use client";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  recordKindLabels,
  recordStateLabels,
  type WorkspaceLibraryRecord,
} from "@/lib/workspace/library-model";
import { type WorkspaceCollection, withWorkspaceReturnTo } from "@/lib/workspace/navigation";
import type { WorkspaceProjectSummary } from "@/lib/workspace/types";
import { useWorkspaceDirtyState } from "./dirty-state";
import { NewWorkButton } from "./new-work";
import { WorkspaceLink } from "./workspace-link";

const publicationTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

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
  recordType,
  state,
}: {
  collection: WorkspaceCollection;
  records: WorkspaceLibraryRecord[];
  projects: WorkspaceProjectSummary[];
  projectId?: string;
  recordType?: string;
  state?: string;
}) {
  const id = useId();
  const router = useRouter();
  const { requestNavigation } = useWorkspaceDirtyState();
  const unavailable = !!projectId && !projects.some((project) => project.id === projectId);
  const collectionRecords = records.filter(
    (record) => record.collection === collection && (!projectId || record.projectId === projectId),
  );
  const types = [
    ...new Set(
      records.filter((record) => record.collection === collection).map((record) => record.kind),
    ),
  ];
  const states = [
    ...new Set(
      collectionRecords
        .filter((record) => !recordType || record.kind === recordType)
        .map((record) => record.state),
    ),
  ];
  const query = new URLSearchParams();
  if (projectId) query.set("project", projectId);
  if (recordType) query.set("type", recordType);
  if (state) query.set("state", state);
  const returnTo = `/workspace/${collection}${query.size ? `?${query.toString()}` : ""}`;
  function filter(key: "project" | "type" | "state", value: string) {
    const next = new URLSearchParams(query);
    if (value) next.set(key, value);
    else next.delete(key);
    requestNavigation(() =>
      router.push(`/workspace/${collection}${next.size ? `?${next.toString()}` : ""}`),
    );
  }
  const rows = unavailable
    ? []
    : records.filter(
        (record) =>
          record.collection === collection &&
          (!projectId || record.projectId === projectId) &&
          (!recordType || record.kind === recordType) &&
          (!state || record.state === state),
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
              filter("project", event.target.value);
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
        <Field className="w-full sm:w-48">
          <FieldLabel htmlFor={`${id}-type`}>
            {collection === "content" ? "内容类型" : "记录类型"}
          </FieldLabel>
          <NativeSelect
            id={`${id}-type`}
            value={recordType ?? ""}
            onChange={(event) => filter("type", event.target.value)}
          >
            <NativeSelectOption value="">全部类型</NativeSelectOption>
            {recordType && !types.includes(recordType as (typeof types)[number]) ? (
              <NativeSelectOption value={recordType}>类型不可用</NativeSelectOption>
            ) : null}
            {types.map((kind) => (
              <NativeSelectOption key={kind} value={kind}>
                {recordKindLabels[kind]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className="w-full sm:w-48">
          <FieldLabel htmlFor={`${id}-state`}>
            {collection === "content" ? "内容状态" : "状态"}
          </FieldLabel>
          <NativeSelect
            id={`${id}-state`}
            value={state ?? ""}
            onChange={(event) => filter("state", event.target.value)}
          >
            <NativeSelectOption value="">全部状态</NativeSelectOption>
            {state && !states.includes(state) ? (
              <NativeSelectOption value={state}>状态不可用</NativeSelectOption>
            ) : null}
            {states.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {recordStateLabels[value] ?? "状态待核对"}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <NewWorkButton
          projectId={projectId}
          returnTo={returnTo}
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
        {collection === "content" ? (
          <NewWorkButton intent="video" projectId={projectId} returnTo={returnTo} variant="outline">
            按需制作视频
          </NewWorkButton>
        ) : null}
      </div>
      {rows.length ? (
        <ul className="divide-y rounded-xl border bg-background">
          {rows.map((record) => (
            <li key={`${record.projectId}:${record.kind}:${record.id}`}>
              <WorkspaceLink
                href={withWorkspaceReturnTo(record.href, returnTo)}
                className="flex min-h-20 flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{record.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {recordKindLabels[record.kind]} · {record.projectTitle}
                    {record.relation !== "owned" ? " · 来自其他项目，只读" : ""}
                  </p>
                </div>
                <Badge variant="outline">{record.statusLabel}</Badge>
              </WorkspaceLink>
              {record.publications ? (
                <div className="mx-4 border-t pb-3 pt-2">
                  <p className="text-xs text-muted-foreground">
                    {record.publications.length
                      ? `发布情况 · ${record.publications.length} 次`
                      : "尚未发布"}
                  </p>
                  {record.publications.length ? (
                    <ul
                      aria-label={`${record.title}的发布情况`}
                      className="mt-1 flex flex-col gap-1"
                    >
                      {record.publications.map((publication) => (
                        <li key={publication.id}>
                          <WorkspaceLink
                            href={withWorkspaceReturnTo(publication.href, returnTo)}
                            className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-md py-1 text-sm hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            <span className="min-w-0 flex-1 break-words">
                              {publication.accountLabel}
                            </span>
                            <time
                              dateTime={publication.createdAt.toISOString()}
                              title="提交时间（北京时间）"
                              className="text-xs text-muted-foreground"
                            >
                              {publicationTimeFormat.format(publication.createdAt)}
                            </time>
                            <Badge variant="outline">{publication.statusLabel}</Badge>
                            <span className="text-xs text-muted-foreground">查看详情</span>
                          </WorkspaceLink>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Empty className="border bg-background">
          <EmptyHeader>
            <EmptyTitle>
              {unavailable
                ? "这个项目不可访问"
                : `没有符合筛选的${collectionLabels[collection]}记录`}
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
