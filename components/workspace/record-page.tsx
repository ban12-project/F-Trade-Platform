import "server-only";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission, type Permission } from "@/lib/authz";
import { recordKindLabels, recordStateLabels } from "@/lib/workspace/library-model";
import {
  createKinds,
  isWorkspaceRecordKind,
  type WorkspaceRecordKind,
  workspaceCollection,
  workspaceRecordHref,
  workspaceReturnTo,
  workspaceTaskHref,
} from "@/lib/workspace/navigation";
import { readWorkspaceProject } from "@/lib/workspace/read-model";
import { readWorkspaceRecord, readWorkspaceRecordTasks } from "@/lib/workspace/record-read-model";
import { RecordFrame } from "./record-frame";
import {
  ContentCreate,
  ContentRecord,
  ProductCreate,
  ProductRecord,
  PublicationRecord,
} from "./records/marketing-records";
import { SalesCreate, SalesRecord } from "./records/sales-records";
import { WorkspaceLink } from "./workspace-link";
import { WorkspacePanelSkeleton } from "./workspace-loading-skeleton";

export type RecordQuery = Record<string, string | string[] | undefined>;
export type RecordPageProps = {
  params: Promise<{ projectId: string; kind: string; recordId?: string }>;
  searchParams: Promise<RecordQuery>;
};
export type RecordContext = Awaited<ReturnType<typeof readRecordContext>>;

const permissionFor: Record<WorkspaceRecordKind, Permission> = {
  product: "product:write",
  content: "content:write",
  video: "video:write",
  publication: "content:write",
  lead: "sales:write",
  rfq: "sales:write",
  quotation: "sales:write",
  delivery: "sales:write",
};
const readRecordContext = cache(
  async (
    params: RecordPageProps["params"],
    searchParams: RecordPageProps["searchParams"],
    mode: "record" | "create",
  ) => {
    await connection();
    const [route, query, session] = await Promise.all([
      params,
      searchParams,
      requirePermission("workspace:view"),
    ]);
    const { projectId, recordId } = route;
    if (!z.uuid().safeParse(projectId).success || !isWorkspaceRecordKind(route.kind)) notFound();
    const kind = route.kind;
    const project = await readWorkspaceProject(projectId, session.user.id);
    if (!project) notFound();
    if (mode === "create" && !(createKinds as readonly string[]).includes(kind)) notFound();
    const expectedKind = ["product", "content", "video", "publication"].includes(kind)
      ? "marketing"
      : "sales";
    if (project.kind !== expectedKind && !(kind === "product" && mode === "record")) notFound();
    const sources = ["product", "rfq", "lead"] as const;
    const givenSources = sources.filter((key) => query[key] !== undefined);
    const expectedSource =
      kind === "content" || kind === "video"
        ? "product"
        : kind === "rfq"
          ? "lead"
          : kind === "quotation"
            ? "rfq"
            : undefined;
    let unavailable =
      query.panel !== undefined ||
      query.item !== undefined ||
      (mode === "record" && (givenSources.length > 0 || !z.uuid().safeParse(recordId).success)) ||
      (mode === "create" &&
        (givenSources.length > 1 ||
          givenSources.some(
            (key) => key !== expectedSource || !z.uuid().safeParse(query[key]).success,
          )));
    const sourceKind = mode === "create" && !unavailable ? givenSources[0] : undefined;
    const sourceId = sourceKind ? (query[sourceKind] as string) : undefined;
    const record =
      mode === "record" && !unavailable
        ? await readWorkspaceRecord(projectId, kind, recordId!, session.user.id)
        : null;
    if (mode === "record" && !record) unavailable = true;
    const source =
      sourceKind && sourceId
        ? await readWorkspaceRecord(projectId, sourceKind, sourceId, session.user.id)
        : null;
    if (sourceId && !source) unavailable = true;
    const returnTo =
      workspaceReturnTo(query.returnTo) ??
      `/workspace/${workspaceCollection(kind)}?project=${projectId}`;
    const canWrite =
      !unavailable &&
      project.status === "active" &&
      project.memberRole !== "viewer" &&
      (!record || record.relation === "owned") &&
      hasPermission(session.user.role, permissionFor[kind]);
    return {
      project,
      projectId,
      kind,
      recordId,
      record,
      sourceKind,
      sourceId,
      source,
      query,
      session,
      canWrite,
      unavailable,
      mode,
      returnTo,
    };
  },
);

function Unavailable() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>这条记录已不可用</EmptyTitle>
        <EmptyDescription>
          记录、来源或地址不在当前可访问范围。请返回清单重新选择。
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
async function RecordHeader(props: RecordPageProps & { mode: "record" | "create" }) {
  const context = await readRecordContext(props.params, props.searchParams, props.mode);
  const { project, kind, record, returnTo, unavailable } = context;
  const payload = record?.record?.payload;
  const product = payload?.product as { product_name?: string } | undefined;
  const customer = payload?.customer as { name?: string; company?: string } | undefined;
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  const title =
    text(product?.product_name) ||
    text(customer?.company) ||
    text(customer?.name) ||
    (typeof payload?.hook === "string" ? payload.hook : undefined) ||
    (typeof payload?.objective === "string" ? payload.objective : undefined) ||
    recordKindLabels[kind];
  const tasks =
    record?.record && !unavailable
      ? await readWorkspaceRecordTasks(project.id, kind, record.id, context.session.user.id)
      : [];
  const next = tasks[0];
  const href = next ? workspaceTaskHref(next, returnTo) : undefined;
  const currentHref = record
    ? workspaceRecordHref(project.id, kind, record.id, returnTo)
    : undefined;
  return (
    <div className="space-y-3">
      <WorkspaceLink
        href={returnTo}
        className={buttonVariants({ variant: "ghost", className: "min-h-11" })}
      >
        返回清单
      </WorkspaceLink>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold">
            {unavailable
              ? "记录已不可用"
              : context.mode === "create"
                ? `新建${recordKindLabels[kind]}`
                : title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.title} · {project.kind === "marketing" ? "营销项目" : "销售项目"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {record ? (
            <Badge variant="outline">{recordStateLabels[record.state] ?? "状态待核对"}</Badge>
          ) : null}
          {!context.canWrite ? <Badge variant="secondary">只读</Badge> : null}
        </div>
      </div>
      {next ? (
        <Alert>
          <AlertTitle>{next.actionLabel}</AlertTitle>
          <AlertDescription>
            {next.detail}
            {href &&
            href !== currentHref &&
            next.state !== "waiting" &&
            next.state !== "processing" ? (
              <WorkspaceLink href={href} className={buttonVariants({ className: "mt-3" })}>
                {next.actionLabel}
              </WorkspaceLink>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
async function RecordBody(props: RecordPageProps & { mode: "record" | "create" }) {
  const context = await readRecordContext(props.params, props.searchParams, props.mode);
  if (context.unavailable) return <Unavailable />;
  if (context.kind === "video") {
    redirect(
      context.mode === "record"
        ? workspaceRecordHref(context.projectId, "video", context.recordId!, context.returnTo)
        : `/workspace/${context.projectId}/video?new=1${context.sourceId ? `&product=${context.sourceId}` : ""}&returnTo=${encodeURIComponent(context.returnTo)}`,
    );
  }
  if (context.mode === "create" && !context.canWrite)
    return (
      <Alert>
        <AlertTitle>当前项目不可写入</AlertTitle>
        <AlertDescription>请由有权限的项目编辑者处理；已归档项目需要先重开。</AlertDescription>
      </Alert>
    );
  let body: React.ReactNode;
  if (context.mode === "create")
    body =
      context.kind === "product" ? (
        <ProductCreate context={context} />
      ) : context.kind === "content" ? (
        <ContentCreate context={context} />
      ) : (
        <SalesCreate context={context} />
      );
  else
    body =
      context.kind === "product" ? (
        <ProductRecord context={context} />
      ) : context.kind === "content" ? (
        <ContentRecord context={context} />
      ) : context.kind === "publication" ? (
        <PublicationRecord context={context} />
      ) : (
        <SalesRecord context={context} />
      );
  return (
    <div className="space-y-5">
      {!context.canWrite ? (
        <p role="status" className="text-sm text-muted-foreground">
          当前为只读视图。写入和审核由有权限的项目编辑者处理。
        </p>
      ) : null}
      <fieldset disabled={!context.canWrite} className="min-w-0 border-0 p-0">
        {body}
      </fieldset>
    </div>
  );
}
export function RecordPage(props: RecordPageProps & { mode: "record" | "create" }) {
  return (
    <RecordFrame
      header={
        <Suspense fallback={<WorkspacePanelSkeleton label="正在加载记录信息" />}>
          <RecordHeader {...props} />
        </Suspense>
      }
    >
      <Suspense fallback={<WorkspacePanelSkeleton label="正在加载业务记录" />}>
        <RecordBody {...props} />
      </Suspense>
    </RecordFrame>
  );
}
