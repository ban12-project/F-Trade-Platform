import { hasPermission, type Permission } from "@/lib/authz";
import { workspaceTaskHref } from "./navigation";
import { defaultProjectStage, projectStages, taskProjectStage } from "./stages";
import type {
  WorkspacePipelineSummary,
  WorkspaceProjectSummary,
  WorkspaceTaskSummary,
} from "./store";

export type TaskProject = WorkspaceProjectSummary & {
  memberRole: "owner" | "editor" | "viewer";
  appRole: string | null;
};
export type TaskRecord = {
  id: string;
  projectId: string;
  type: string;
  state: string;
  version: number;
  payload: Record<string, unknown>;
  relation: string;
  createdAt: Date;
  updatedAt: Date;
};
export type TaskApproval = {
  id: string;
  aggregateId: string;
  gate: string;
  status: string;
  requestedAt: Date;
  createdAt: Date;
};
export type TaskPublication = {
  id: string;
  projectId: string;
  contentRef: string;
  status: string;
  createdAt: Date;
};
export type WorkspaceTaskSnapshot = {
  projects: TaskProject[];
  records: TaskRecord[];
  approvals: TaskApproval[];
  publications: TaskPublication[];
  hasActiveChannel: boolean;
};

export function leadTaskType(record: Pick<TaskRecord, "state" | "payload">) {
  if (record.state === "LEAD_RECEIVED") return "rfq";
  if (
    record.state === "OPPORTUNITY" ||
    (record.state === "FOLLOW_UP" && record.payload.score_band === "HOT")
  )
    return "opportunity";
  return record.state === "FOLLOW_UP" ? "follow_up" : undefined;
}

export const taskStateLabels = {
  actionable: "我可处理",
  waiting: "等待他人",
  processing: "系统处理中",
  attention: "需要排查",
  scheduled: "已安排",
} as const;
export function isActionableTask(task: WorkspaceTaskSummary) {
  return !task.state || task.state === "actionable" || task.state === "attention";
}
export function taskStateLabel(task: WorkspaceTaskSummary) {
  return taskStateLabels[task.state ?? "actionable"];
}
function text(value: unknown) {
  return typeof value === "string" ? value : "";
}
function titleFor(record: TaskRecord) {
  const product = record.payload.product as { product_name?: unknown } | undefined;
  return (
    text(product?.product_name) ||
    text(record.payload.hook) ||
    text(record.payload.objective) ||
    ({
      product: "产品资料",
      content: "营销内容",
      video: "营销视频",
      quotation: "人工报价",
      delivery_confirmation: "交期确认",
      rfq: "客户询盘",
      lead: "客户线索",
    }[record.type] ??
      "业务记录")
  );
}
const reviewRules: Record<
  string,
  { kind: WorkspaceTaskSummary["nodeKind"]; permission: Permission; gate: string; action: string }
> = {
  PRODUCT_REVIEW_REQUIRED: {
    kind: "product",
    permission: "product:review",
    gate: "gate_01_truth",
    action: "核实产品资料",
  },
  CONTENT_REVIEW_REQUIRED: {
    kind: "content",
    permission: "content:review",
    gate: "gate_01_truth",
    action: "审核营销内容",
  },
  VIDEO_REVIEW_REQUIRED: {
    kind: "video",
    permission: "content:review",
    gate: "gate_01_truth",
    action: "审核成片",
  },
  QUOTE_REVIEW_REQUIRED: {
    kind: "quotation",
    permission: "quotation:review",
    gate: "gate_02_quote",
    action: "审核人工报价",
  },
  DELIVERY_CONFIRMATION_PENDING: {
    kind: "delivery",
    permission: "delivery:review",
    gate: "gate_03_delivery",
    action: "确认交期",
  },
};
const revisionRules: Record<
  string,
  { kind: WorkspaceTaskSummary["nodeKind"]; permission: Permission; action: string }
> = {
  PRODUCT_REVISION_REQUIRED: {
    kind: "product",
    permission: "product:write",
    action: "修订产品资料",
  },
  CONTENT_REVISION_REQUIRED: {
    kind: "content",
    permission: "content:write",
    action: "修订营销内容",
  },
  VIDEO_REVISION_REQUIRED: { kind: "video", permission: "video:write", action: "修订视频" },
  QUOTE_REVISION_REQUIRED: { kind: "quotation", permission: "sales:write", action: "修订人工报价" },
  VIDEO_DRAFT: { kind: "video", permission: "video:write", action: "继续剪辑视频" },
};

// A read-only projection. Domain services still recheck authorization, evidence and versions on every write.
export function deriveWorkspaceTasks(
  snapshot: WorkspaceTaskSnapshot,
  now: Date,
): WorkspaceTaskSummary[] {
  const tasks: WorkspaceTaskSummary[] = [];
  const approvals = new Map<string, TaskApproval>();
  for (const row of [...snapshot.approvals].sort(
    (a, b) =>
      b.requestedAt.getTime() - a.requestedAt.getTime() ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  )) {
    const key = `${row.aggregateId}:${row.gate}`;
    if (!approvals.has(key)) approvals.set(key, row);
  }
  for (const project of snapshot.projects) {
    if (project.status !== "active") continue;
    const records = snapshot.records.filter((row) => row.projectId === project.id);
    const owned = records.filter((row) => row.relation === "owned");
    const publications = snapshot.publications.filter((row) => row.projectId === project.id);
    function add(
      record: TaskRecord,
      values: Pick<WorkspaceTaskSummary, "nodeKind" | "detail" | "actionLabel" | "taskType"> &
        Partial<WorkspaceTaskSummary>,
      permission: Permission,
    ) {
      const permitted =
        project.memberRole !== "viewer" && hasPermission(project.appRole, permission);
      const requestedState = values.state ?? "actionable";
      const needsPerson = requestedState === "actionable" || requestedState === "attention";
      const state = needsPerson && !permitted ? "waiting" : requestedState;
      const responsibleLabel =
        values.responsibleLabel ??
        (permission.endsWith(":review") ? "有审核权限的项目编辑者" : "项目编辑者");
      tasks.push({
        id: record.id,
        projectId: project.id,
        projectTitle: project.title,
        title: titleFor(record),
        priority: "complete",
        createdAt: record.createdAt,
        ...values,
        state,
        responsibleLabel: state === "processing" ? "系统" : responsibleLabel,
        actionLabel: needsPerson && !permitted ? "查看状态" : values.actionLabel,
        detail:
          needsPerson && !permitted ? `等待${responsibleLabel}。${values.detail}` : values.detail,
      });
    }
    for (const record of owned) {
      const review = reviewRules[record.state];
      if (review) {
        const approval = approvals.get(`${record.id}:${review.gate}`);
        const pending = approval?.status === "pending";
        add(
          record,
          {
            nodeKind: review.kind,
            taskType: "approval",
            priority: pending ? "review" : "attention",
            state: pending ? "actionable" : "attention",
            detail: pending
              ? `第 ${record.version} 版等待人工核对。`
              : "记录处于待审状态，但没有对应的当前待审请求；请核对记录。",
            actionLabel: pending ? review.action : "核对审核状态",
            createdAt: approval?.requestedAt ?? record.createdAt,
          },
          review.permission,
        );
        continue;
      }
      const revision = revisionRules[record.state];
      if (revision) {
        add(
          record,
          {
            nodeKind: revision.kind,
            taskType: "revision",
            priority: "review",
            actionLabel: revision.action,
            detail: record.state.endsWith("REVISION_REQUIRED")
              ? "已退回，请根据审核意见修改后重新送审。"
              : "视频草稿尚未提交，继续编辑或提审。",
          },
          revision.permission,
        );
        continue;
      }
      if (
        ["VIDEO_RENDERING", "VIDEO_READY_FOR_GENERATION", "CONTENT_GENERATING"].includes(
          record.state,
        )
      ) {
        add(
          record,
          {
            nodeKind: record.type === "video" ? "video" : "content",
            taskType: "processing",
            state: "processing",
            detail: "处理完成后会更新状态；可打开查看进度。",
            actionLabel: "查看进度",
          },
          record.type === "video" ? "video:write" : "content:write",
        );
      } else if (record.state === "PRODUCT_READY" && project.kind === "marketing") {
        if (
          !owned.some(
            (row) =>
              ["content", "video"].includes(row.type) &&
              (row.payload.product_id === record.id || row.payload.productId === record.id),
          )
        ) {
          add(
            record,
            {
              nodeKind: "content",
              taskType: "create",
              actionLabel: "制作图文内容",
              detail: "产品已核实，可以开始第一条图文内容；视频可按需制作。",
              source: { kind: "product", id: record.id },
            },
            "content:write",
          );
        }
      } else if (record.state === "RFQ_COLLECTING") {
        const missing = Array.isArray(record.payload.missing_fields)
          ? record.payload.missing_fields.length
          : 0;
        add(
          record,
          {
            nodeKind: "rfq",
            taskType: "rfq",
            actionLabel: "补齐询盘",
            detail: missing ? `还缺 ${missing} 项资料。` : "核对需求后提交完整询盘。",
          },
          "sales:write",
        );
      } else if (
        record.state === "RFQ_READY" &&
        !owned.some((row) => row.type === "quotation" && row.payload.rfq_id === record.id)
      ) {
        const hasProduct = records.some(
          (row) => row.type === "product" && row.state === "PRODUCT_READY",
        );
        add(
          record,
          hasProduct
            ? {
                nodeKind: "quotation",
                taskType: "create",
                actionLabel: "录入人工报价",
                detail: "需求已完整，价格和商业条款由人工填写。",
                source: { kind: "rfq", id: record.id },
              }
            : {
                nodeKind: "rfq",
                taskType: "rfq",
                actionLabel: "关联已核实产品",
                detail: "需求已完整；报价前需先关联已核实产品。",
              },
          "sales:write",
        );
      } else if (record.state === "QUOTE_APPROVED") {
        add(
          record,
          {
            nodeKind: "quotation",
            taskType: "send",
            actionLabel: "核对报价发送凭证",
            detail: "人工报价已批准；实际发送并核对凭证后才能标记已发送。",
          },
          "sales:write",
        );
      } else if (record.state === "LEAD_RECEIVED") {
        if (!owned.some((row) => row.type === "rfq" && row.payload.lead_ref === record.id)) {
          add(
            record,
            {
              nodeKind: "lead",
              taskType: "rfq",
              actionLabel: "录入询盘",
              detail: "新线索已归属项目，开始整理客户需求。",
            },
            "sales:write",
          );
        }
      } else if (record.state === "FOLLOW_UP") {
        const hot = leadTaskType(record) === "opportunity";
        const dueValue = text(record.payload.next_follow_up_at);
        const dueAt =
          dueValue && Number.isFinite(Date.parse(dueValue)) ? new Date(dueValue) : undefined;
        const scheduled = !hot && dueAt && dueAt.getTime() > now.getTime();
        add(
          record,
          {
            nodeKind: "lead",
            taskType: hot ? "opportunity" : "follow_up",
            title: hot ? "确认有效商机" : scheduled ? "客户跟进已安排" : "客户需要跟进",
            actionLabel: hot ? "确认有效商机" : scheduled ? "查看跟进计划" : "继续跟进",
            detail: hot
              ? "规则评分达到 HOT，仍需人工认定。"
              : dueAt
                ? `计划跟进：${dueAt.toISOString()}`
                : "尚未安排下次跟进，请核对客户上下文。",
            state: scheduled ? "scheduled" : "actionable",
            priority: hot ? "review" : dueAt && !scheduled ? "overdue" : "complete",
            ...(dueAt ? { dueAt } : {}),
          },
          "sales:write",
        );
      }
    }
    // Track every publication attempt, even if its content later changed state.
    const attemptedContent = new Set(publications.map((row) => row.contentRef));
    for (const publication of publications) {
      if (publication.status === "published") continue;
      const record = owned.find((row) => row.id === publication.contentRef);
      if (!record) continue;
      const processing = ["confirmed", "submitted"].includes(publication.status);
      add(
        record,
        {
          id: publication.id,
          nodeKind: "publication",
          taskType: "publication",
          title: processing ? "发布等待平台回执" : "发布结果需要核对",
          state: processing ? "processing" : "attention",
          priority: processing ? "complete" : "attention",
          actionLabel: processing ? "查看发布进度" : "核对发布状态",
          detail: processing
            ? "已提交发布，平台确认前不会显示为已发布。"
            : "结果不确定、失败或渠道已暂停；先核对外部结果，不自动重试。",
          createdAt: publication.createdAt,
        },
        "content:write",
      );
    }
    for (const record of owned) {
      if (
        !["CONTENT_APPROVED", "VIDEO_APPROVED"].includes(record.state) ||
        attemptedContent.has(record.id)
      )
        continue;
      add(
        record,
        {
          nodeKind: "publication",
          taskType: "publication",
          priority: "review",
          actionLabel: snapshot.hasActiveChannel ? "核对并确认发布" : "查看发布条件",
          detail: snapshot.hasActiveChannel
            ? "内容已批准，核对最终内容、渠道与账户后逐条确认。"
            : "内容已批准，等待管理员启用发布渠道。",
          state: snapshot.hasActiveChannel ? "actionable" : "waiting",
          ...(!snapshot.hasActiveChannel ? { responsibleLabel: "渠道管理员" } : {}),
        },
        "content:write",
      );
    }
  }
  const priority = { attention: 0, overdue: 1, review: 2, complete: 3 };
  return tasks.sort(
    (a, b) =>
      Number(!isActionableTask(a)) - Number(!isActionableTask(b)) ||
      priority[a.priority] - priority[b.priority] ||
      (a.dueAt?.getTime() ?? a.createdAt.getTime()) -
        (b.dueAt?.getTime() ?? b.createdAt.getTime()) ||
      `${a.projectId}:${a.taskType}:${a.id}`.localeCompare(`${b.projectId}:${b.taskType}:${b.id}`),
  );
}

export function deriveWorkspacePipeline(
  snapshot: WorkspaceTaskSnapshot,
  tasks: WorkspaceTaskSummary[],
): WorkspacePipelineSummary[] {
  const projectNames = new Map(snapshot.projects.map((project) => [project.id, project.title]));
  return snapshot.projects.map((project) => {
    const records = snapshot.records.filter(
      (record) => record.projectId === project.id && record.relation === "owned",
    );
    const published = snapshot.publications.filter(
      (record) => record.projectId === project.id && record.status === "published",
    );
    const leadRecords = records.filter((row) => row.type === "lead");
    const next = tasks.find((task) => task.projectId === project.id);
    const currentStageId = next
      ? taskProjectStage(next)
      : defaultProjectStage(project.kind, [], records, published.length > 0);
    const stageLabel =
      projectStages(project.kind).find((stage) => stage.id === currentStageId)?.label ?? "项目记录";
    const sourceRef = leadRecords
      .map((row) => text(row.payload.source_publication_ref))
      .find(Boolean);
    const source = snapshot.publications.find(
      (row) => row.id === sourceRef || row.contentRef === sourceRef,
    );
    const relatedMarketingProjectTitle = source ? projectNames.get(source.projectId) : undefined;
    return {
      id: project.id,
      title: project.title,
      kind: project.kind,
      status: project.status,
      updatedAt: project.updatedAt,
      currentStageId,
      currentStage:
        project.status === "archived"
          ? "已归档"
          : next
            ? `${stageLabel} · ${taskStateLabel(next)}`
            : records.length
              ? "当前工作已处理"
              : "尚未开始",
      nextAction: next
        ? isActionableTask(next)
          ? (next.actionLabel ?? "打开记录")
          : next.detail
        : records.length
          ? "查看已有记录与结果"
          : project.kind === "marketing"
            ? "导入第一份产品资料"
            : "录入第一条客户询盘",
      nextActionHref: next
        ? workspaceTaskHref(next)
        : `/workspace/${project.id}?panel=${project.kind === "sales" && !records.length ? "rfq" : currentStageId}`,
      recordCount: records.length,
      publishedCount: published.length,
      leadCount: leadRecords.length,
      opportunityCount: leadRecords.filter((row) => row.state === "OPPORTUNITY").length,
      ...(relatedMarketingProjectTitle ? { relatedMarketingProjectTitle } : {}),
    };
  });
}
