"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useSyncExternalStore, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import {
  type LibraryFilterKey,
  updateWorkspaceLibraryFilter,
  workspaceLibraryEmptyState,
  workspaceLibraryFilterOptions,
} from "@/lib/workspace/library-filters";
import {
  matchesWorkspaceLibrarySearch,
  recordKindLabels,
  recordStateLabels,
  type WorkspaceLibraryRecord,
} from "@/lib/workspace/library-model";
import { librarySearchSchema } from "@/lib/workspace/library-search";
import { type WorkspaceCollection, withWorkspaceReturnTo } from "@/lib/workspace/navigation";
import { workspaceCreationRestriction } from "@/lib/workspace/new-work";
import type { WorkspaceProjectSummary } from "@/lib/workspace/types";
import { useWorkspaceDirtyState } from "./dirty-state";
import { NewWorkButton } from "./new-work";
import { WorkspaceLink } from "./workspace-link";

const subscribeToHydration = () => () => {};
const clientHydrationSnapshot = () => true;
const serverHydrationSnapshot = () => false;

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
  search = "",
  searchError,
  basePath,
}: {
  collection: WorkspaceCollection;
  records: WorkspaceLibraryRecord[];
  projects: WorkspaceProjectSummary[];
  projectId?: string;
  recordType?: string;
  state?: string;
  search?: string;
  searchError?: string;
  basePath?: string;
}) {
  const id = useId();
  const timeZone = useBrowserTimeZone();
  const publicationTimeFormat = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  const searchForm = useForm({
    resolver: zodResolver(librarySearchSchema),
    values: { q: search },
  });
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Native controls must not accept changes before their URL handlers are attached.
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    clientHydrationSnapshot,
    serverHydrationSnapshot,
  );
  const controlsDisabled = !hydrated || isPending;
  const focusAfterNavigation = useRef<{ controlId: string; query: string } | null>(null);
  const { requestNavigation } = useWorkspaceDirtyState();
  const creationIntent =
    collection === "products" ? "product" : collection === "content" ? "content" : "rfq";
  const creationRestriction = projectId
    ? workspaceCreationRestriction(
        projects.find((project) => project.id === projectId),
        creationIntent,
      )
    : undefined;
  const unavailable = !!projectId && !projects.some((project) => project.id === projectId);
  const query = new URLSearchParams();
  if (projectId) query.set("project", projectId);
  if (recordType) query.set("type", recordType);
  if (state) query.set("state", state);
  if (search) query.set("q", search);
  const returnTo = `/workspace/${collection}${query.size ? `?${query.toString()}` : ""}`;
  const { types, states } = workspaceLibraryFilterOptions(records, collection, query);
  const emptyState = workspaceLibraryEmptyState(unavailable, query);
  const queryKey = query.toString();
  useEffect(() => {
    const target = focusAfterNavigation.current;
    if (isPending || !target || target.query !== queryKey) return;
    document.getElementById(target.controlId)?.focus();
    focusAfterNavigation.current = null;
  }, [isPending, queryKey]);
  function navigate(next: URLSearchParams, focusId?: string) {
    requestNavigation(() => {
      focusAfterNavigation.current = focusId
        ? { controlId: focusId, query: next.toString() }
        : null;
      startTransition(() =>
        router.push(
          `${basePath ?? `/workspace/${collection}`}${next.size ? `?${next.toString()}` : ""}`,
        ),
      );
    });
  }
  function filter(key: LibraryFilterKey, value: string) {
    navigate(updateWorkspaceLibraryFilter(records, collection, query, key, value));
  }
  const rows =
    unavailable || searchError
      ? []
      : records.filter(
          (record) =>
            record.collection === collection &&
            (!projectId || record.projectId === projectId) &&
            (!recordType || record.kind === recordType) &&
            (!state || record.state === state) &&
            matchesWorkspaceLibrarySearch(record, search),
        );
  const activeFilters: {
    key: LibraryFilterKey;
    label: string;
    value: string;
    controlId: string;
  }[] = [];
  if (projectId)
    activeFilters.push({
      key: "project",
      label: "归属项目",
      value: projects.find((project) => project.id === projectId)?.title ?? "该项目不可访问",
      controlId: id,
    });
  if (recordType)
    activeFilters.push({
      key: "type",
      label: "类型",
      value: types.includes(recordType as (typeof types)[number])
        ? recordKindLabels[recordType as keyof typeof recordKindLabels]
        : "类型不可用",
      controlId: `${id}-type`,
    });
  if (state)
    activeFilters.push({
      key: "state",
      label: "状态",
      value:
        states.includes(state) && Object.hasOwn(recordStateLabels, state)
          ? recordStateLabels[state]
          : "状态不可用",
      controlId: `${id}-state`,
    });
  if (search)
    activeFilters.push({ key: "q", label: "关键词", value: search, controlId: `${id}-search` });
  return (
    <div className="flex flex-col gap-5">
      <search aria-label="搜索资料库">
        <form
          className="flex items-end gap-2"
          onSubmit={searchForm.handleSubmit(({ q }) => filter("q", q))}
        >
          <Field className="min-w-0 flex-1" data-invalid={Boolean(searchError)}>
            <FieldLabel htmlFor={`${id}-search`}>搜索记录</FieldLabel>
            <Input
              key={search}
              defaultValue={search}
              id={`${id}-search`}
              type="search"
              autoComplete="off"
              placeholder="SKU、OE、产品名称、客户或公司"
              maxLength={200}
              disabled={controlsDisabled}
              aria-invalid={Boolean(searchError)}
              aria-describedby={searchError ? `${id}-search-error` : undefined}
              {...searchForm.register("q")}
            />
            <FieldError id={`${id}-search-error`}>{searchError}</FieldError>
          </Field>
          <Button type="submit" variant="outline" disabled={controlsDisabled}>
            搜索
          </Button>
        </form>
      </search>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field className="w-full sm:w-72">
          <FieldLabel htmlFor={id}>归属项目</FieldLabel>
          <NativeSelect
            disabled={controlsDisabled}
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
            disabled={controlsDisabled}
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
            disabled={controlsDisabled}
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
        {query.size ? (
          <Button
            type="button"
            variant="outline"
            disabled={controlsDisabled}
            onClick={() => navigate(new URLSearchParams(), `${id}-search`)}
          >
            清除全部筛选
          </Button>
        ) : null}
        <NewWorkButton projectId={projectId} returnTo={returnTo} intent={creationIntent}>
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
      {creationRestriction ? (
        <section
          aria-label="新增记录说明"
          className="flex flex-wrap items-center gap-3 rounded-xl border p-4"
        >
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">{creationRestriction}</p>
          <NewWorkButton intent={creationIntent} returnTo={returnTo} variant="outline">
            选择其他项目开始
          </NewWorkButton>
        </section>
      ) : null}
      <div className="flex flex-col gap-2">
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-sm text-muted-foreground tabular-nums"
        >
          {isPending
            ? "正在更新结果…"
            : unavailable
              ? "项目不可访问，请调整筛选。"
              : searchError
                ? "搜索条件无效，请修改后重新搜索。"
                : `${query.size ? "找到" : "共"} ${new Intl.NumberFormat("zh-CN").format(rows.length)} 条记录`}
        </p>
        {activeFilters.length ? (
          <ul aria-label="已选筛选条件" className="flex flex-wrap gap-2">
            {activeFilters.map((item) => (
              <li key={item.key} className="min-w-0 max-w-full">
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11 max-w-full"
                  disabled={controlsDisabled}
                  aria-label={`移除筛选：${item.label}：${item.value}`}
                  title={`${item.label}：${item.value}`}
                  onClick={() =>
                    navigate(
                      updateWorkspaceLibraryFilter(records, collection, query, item.key, ""),
                      item.controlId,
                    )
                  }
                >
                  <span className="min-w-0 truncate">
                    {item.label}：{item.value}
                  </span>
                  <XIcon aria-hidden="true" data-icon="inline-end" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {rows.length ? (
        <ul
          aria-label="资料库记录"
          aria-busy={isPending}
          className="divide-y rounded-xl border bg-background"
        >
          {rows.map((record) => (
            <li key={`${record.projectId}:${record.kind}:${record.id}`}>
              <WorkspaceLink
                href={withWorkspaceReturnTo(record.href, returnTo)}
                className="flex min-h-20 flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{record.title}</p>
                  {record.identifiers?.length ? (
                    <p className="mt-1 break-words text-sm text-muted-foreground">
                      {record.identifiers
                        .map((field) => `${field.label}：${field.value}`)
                        .join(" · ")}
                    </p>
                  ) : null}
                  <p className="mt-1 break-words text-sm text-muted-foreground">
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
                            <span className="min-w-0 flex-1 basis-full break-words sm:basis-auto">
                              {publication.accountLabel}
                            </span>
                            <time
                              dateTime={publication.createdAt.toISOString()}
                              className="basis-full break-words text-xs text-muted-foreground sm:basis-auto"
                            >
                              提交时间：{publicationTimeFormat.format(publication.createdAt)}（
                              {timeZone}）
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
              {emptyState === "unavailable"
                ? "这个项目不可访问"
                : searchError
                  ? "无法执行搜索"
                  : emptyState === "no_matches"
                    ? "没有匹配的记录"
                    : `暂无${collectionLabels[collection]}记录`}
            </EmptyTitle>
            <EmptyDescription>
              {emptyState === "unavailable"
                ? "链接中的项目不存在或你不是成员。请选择可访问项目。"
                : searchError
                  ? "请重新输入关键词，或清除无效搜索后查看当前筛选范围内的记录。"
                  : emptyState === "no_matches"
                    ? "试试其他关键词，或调整项目、类型和状态。也可以清除全部筛选查看所有可访问记录。"
                    : collection === "products"
                      ? "从工厂资料或人工录入开始，核验后才能用于营销与报价。"
                      : collection === "content"
                        ? "先完成产品资料核验，再选择已核验产品制作内容；视频是可选形式。"
                        : "记录客户已经提出的需求，再补齐产品、数量和目的地。"}
            </EmptyDescription>
          </EmptyHeader>
          {searchError ? (
            <EmptyContent>
              <Button
                variant="outline"
                disabled={controlsDisabled}
                onClick={() => navigate(query, `${id}-search`)}
              >
                清除无效搜索
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}
    </div>
  );
}
