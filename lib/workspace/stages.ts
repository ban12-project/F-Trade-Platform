import type { WorkspaceTaskSummary } from "./store";
export type ProjectStage = { id: string; panelKind: string; label: string; description: string };
export type ProjectKind = "marketing" | "sales";
export type StageRecord = { type: string; state: string };
export const marketingStages: ProjectStage[] = [
  {
    id: "product",
    panelKind: "product",
    label: "产品资料",
    description: "导入资料，补全字段并完成产品事实核验。",
  },
  {
    id: "content",
    panelKind: "content",
    label: "营销内容",
    description: "基于已核验产品事实生成、修改并审核营销内容。",
  },
  {
    id: "video",
    panelKind: "video",
    label: "营销视频",
    description: "选择授权素材，在独立编辑器生成剪辑初稿、预览并提审。",
  },
  {
    id: "publication",
    panelKind: "publication",
    label: "发布",
    description: "人工确认渠道、账户与载荷，提交后等待平台回执。",
  },
];
export const salesStages: ProjectStage[] = [
  {
    id: "inbound",
    panelKind: "lead",
    label: "客户线索",
    description: "查看已关联到当前项目的询盘、消息和跟进上下文。",
  },
  {
    id: "rfq",
    panelKind: "rfq",
    label: "需求确认",
    description: "补齐产品身份、数量、目的地和证据。",
  },
  {
    id: "quotation",
    panelKind: "quotation",
    label: "报价",
    description: "人工录入价格与商业条款，并完成报价确认。",
  },
  {
    id: "follow-up",
    panelKind: "lead",
    label: "跟进",
    description: "人工编辑并发送回复，安排下一次跟进。",
  },
  {
    id: "delivery",
    panelKind: "delivery",
    label: "交期",
    description: "客户询问交期时发起并完成人工确认。",
  },
  {
    id: "opportunity",
    panelKind: "lead",
    label: "商机",
    description: "达到条件后，仍由业务人员显式确认有效商机。",
  },
];

export function projectStages(kind: ProjectKind) {
  return kind === "marketing" ? marketingStages : salesStages;
}
export function taskProjectStage(task: Pick<WorkspaceTaskSummary, "nodeKind" | "taskType">) {
  if (task.nodeKind !== "lead") return task.nodeKind;
  return task.taskType === "opportunity"
    ? "opportunity"
    : task.taskType === "follow_up"
      ? "follow-up"
      : task.taskType === "rfq"
        ? "rfq"
        : "inbound";
}
export function requestedProjectStage(
  kind: ProjectKind,
  panel?: string,
  taskType?: WorkspaceTaskSummary["taskType"],
) {
  if (projectStages(kind).some((stage) => stage.id === panel)) return panel;
  if (kind === "sales" && panel === "lead") return taskProjectStage({ nodeKind: "lead", taskType });
  return undefined;
}
export function defaultProjectStage(
  kind: ProjectKind,
  tasks: WorkspaceTaskSummary[],
  records: StageRecord[],
  hasPublication: boolean,
) {
  const next = tasks.find((task) =>
    projectStages(kind).some((stage) => stage.id === taskProjectStage(task)),
  );
  if (next) return taskProjectStage(next);
  if (kind === "marketing") {
    return hasPublication
      ? "publication"
      : records.some((row) => row.type === "video")
        ? "video"
        : records.some((row) => row.type === "content")
          ? "content"
          : "product";
  }
  const hasState = (...states: string[]) => records.some((row) => states.includes(row.state));
  if (hasState("DELIVERY_CONFIRMATION_PENDING")) return "delivery";
  if (hasState("QUOTE_REVIEW_REQUIRED", "QUOTE_REVISION_REQUIRED", "QUOTE_APPROVED"))
    return "quotation";
  if (hasState("RFQ_COLLECTING", "LEAD_RECEIVED")) return "rfq";
  if (hasState("RFQ_READY", "QUOTE_DRAFT")) return "quotation";
  if (hasState("FOLLOW_UP")) return "follow-up";
  if (hasState("OPPORTUNITY")) return "opportunity";
  if (records.some((row) => row.type === "quotation")) return "quotation";
  return "inbound";
}
