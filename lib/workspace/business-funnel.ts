import rfqReadySchema from "../../contracts/sales/rfq-ready.schema.json";
import { compileContract } from "../contracts/validator";
import { workspaceRecordHref } from "./navigation";
import type { TaskRecord, WorkspaceTaskSnapshot } from "./task-model";

export const businessFunnelStages = [
  {
    id: "products",
    label: "已核验产品",
    definition: "PRODUCT_READY 且最新 Gate 01 已通过。仅计归属产品，不重复计引用。",
  },
  {
    id: "content",
    label: "已发布内容",
    definition: "同一项目内有 published 发布回执的内容或视频；多账号、多次发布只计一份内容。",
  },
  {
    id: "enquiries",
    label: "有效询盘",
    definition: "RFQ_READY 且符合完整询盘契约。表示需求信息齐全，不代表已验证购买意向。",
  },
  {
    id: "quotes",
    label: "已发送报价",
    definition:
      "QUOTE_SENT 且有人工作出的 Gate 02 批准和发送时间、渠道、凭证。表示已登记发送，不代表客户已收到。",
  },
  {
    id: "opportunities",
    label: "人工确认商机",
    definition:
      "当前为 OPPORTUNITY，且存在人工确认的工作流事件及证据。HOT 评分或已发报价不等于商机。",
  },
] as const;
export type BusinessFunnelStageId = (typeof businessFunnelStages)[number]["id"];
export type BusinessFunnelRecord = {
  id: string;
  projectId: string;
  projectTitle: string;
  label: string;
  href: string;
};
export type BusinessFunnelStage = {
  id: BusinessFunnelStageId;
  label: string;
  definition: string;
  count: number | null;
  records: BusinessFunnelRecord[];
  excluded: BusinessFunnelRecord[];
};
export type BusinessFunnel = { projectCount: number; stages: BusinessFunnelStage[] };
const validateRfq = compileContract(rfqReadySchema);
function nonempty(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}
function validRfq(payload: unknown) {
  try {
    validateRfq(payload);
    return true;
  } catch {
    return false;
  }
}

/** Independent inventory counts, not an attributed conversion cohort. No payloads leave this projection. */
export function deriveBusinessFunnel(
  snapshot: WorkspaceTaskSnapshot,
  humanOpportunityIds: readonly string[] | null,
): BusinessFunnel {
  const projects = new Map(
    snapshot.projects.filter((p) => p.status === "active").map((p) => [p.id, p]),
  );
  const stages: BusinessFunnelStage[] = businessFunnelStages.map((stage) => ({
    ...stage,
    count: stage.id === "opportunities" && humanOpportunityIds === null ? null : 0,
    records: [],
    excluded: [],
  }));
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const humanOpportunities = new Set(humanOpportunityIds ?? []);
  const approvals = [...snapshot.approvals].sort(
    (a, b) =>
      b.requestedAt.getTime() - a.requestedAt.getTime() ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  const latest = new Map<string, (typeof approvals)[number]>();
  for (const approval of approvals) {
    const key = `${approval.aggregateId}:${approval.gate}`;
    if (!latest.has(key)) latest.set(key, approval);
  }
  const published = new Set(
    snapshot.publications
      .filter((p) => projects.has(p.projectId) && p.status === "published")
      .map((p) => `${p.projectId}:${p.contentRef}`),
  );
  const seen = new Set<string>();
  function add(id: BusinessFunnelStageId, record: TaskRecord, included: boolean) {
    const project = projects.get(record.projectId);
    const stage = stageById.get(id);
    const key = `${id}:${record.id}`;
    if (!stage || stage.count === null || !project || seen.has(key)) return;
    seen.add(key);
    const kind =
      record.type === "video"
        ? "video"
        : record.type === "content"
          ? "content"
          : record.type === "product"
            ? "product"
            : record.type === "rfq"
              ? "rfq"
              : record.type === "quotation"
                ? "quotation"
                : "lead";
    const row = {
      id: record.id,
      projectId: project.id,
      projectTitle: project.title,
      label: `${stage.label} · ${record.id.slice(0, 8)}`,
      href: workspaceRecordHref(project.id, kind, record.id, "/workspace"),
    };
    (included ? stage.records : stage.excluded).push(row);
    if (included) stage.count++;
  }
  for (const record of snapshot.records) {
    if (!projects.has(record.projectId) || record.relation !== "owned") continue;
    if (record.type === "product" && record.state === "PRODUCT_READY") {
      add("products", record, latest.get(`${record.id}:gate_01_truth`)?.status === "approved");
    } else if (record.type === "content" || record.type === "video") {
      const hasReceipt = published.has(`${record.projectId}:${record.id}`);
      if (hasReceipt || ["CONTENT_PUBLISHED", "VIDEO_PUBLISHED"].includes(record.state))
        add("content", record, hasReceipt);
    } else if (record.type === "rfq" && record.state === "RFQ_READY") {
      add("enquiries", record, validRfq(record.payload));
    } else if (record.type === "quotation" && record.state === "QUOTE_SENT") {
      const approval = latest.get(`${record.id}:gate_02_quote`);
      const payload = record.payload;
      add(
        "quotes",
        record,
        approval?.status === "approved" &&
          payload.approval_ref === approval.id &&
          payload.status === "sent" &&
          payload.created_by_actor_type === "human" &&
          nonempty(payload.sent_channel) &&
          nonempty(payload.sent_ref) &&
          typeof payload.sent_at === "string" &&
          !Number.isNaN(Date.parse(payload.sent_at)),
      );
    } else if (record.type === "lead" && record.state === "OPPORTUNITY") {
      add("opportunities", record, humanOpportunities.has(record.id));
    }
  }
  return { projectCount: projects.size, stages };
}
