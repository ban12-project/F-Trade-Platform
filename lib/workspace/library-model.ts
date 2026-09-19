import {
  isWorkspaceRecordKind,
  type WorkspaceCollection,
  type WorkspaceRecordKind,
  workspaceCollection,
  workspaceRecordHref,
} from "./navigation";
import type { WorkspaceTaskSnapshot } from "./task-model";

export const recordKindLabels: Record<WorkspaceRecordKind, string> = {
  product: "产品资料",
  content: "营销内容",
  video: "营销视频",
  publication: "发布记录",
  lead: "客户线索",
  rfq: "客户询盘",
  quotation: "人工报价",
  delivery: "交期确认",
};
const stateLabels: Record<string, string> = {
  PRODUCT_DRAFT: "资料待补全",
  PRODUCT_REVIEW_REQUIRED: "待核验",
  PRODUCT_REVISION_REQUIRED: "待修订",
  PRODUCT_READY: "已核验",
  CONTENT_DRAFT: "草稿",
  CONTENT_REVIEW_REQUIRED: "待审核",
  CONTENT_REVISION_REQUIRED: "待修订",
  CONTENT_APPROVED: "可安排发布",
  CONTENT_PUBLISHED: "已发布",
  VIDEO_DRAFT: "剪辑草稿",
  VIDEO_REVIEW_REQUIRED: "成片待审核",
  VIDEO_REVISION_REQUIRED: "待修订",
  VIDEO_APPROVED: "成片已批准",
  VIDEO_PUBLISHED: "已发布",
  LEAD_RECEIVED: "新线索",
  RFQ_COLLECTING: "需求待补全",
  RFQ_READY: "需求已确认",
  QUOTE_DRAFT: "报价草稿",
  QUOTE_REVIEW_REQUIRED: "报价待审核",
  QUOTE_REVISION_REQUIRED: "报价待修订",
  QUOTE_APPROVED: "报价待发送",
  QUOTE_SENT: "报价已发送",
  FOLLOW_UP: "跟进中",
  OPPORTUNITY: "有效商机",
  DELIVERY_CONFIRMATION_PENDING: "交期待确认",
  DELIVERY_CONFIRMATION_CONFIRMED: "交期已确认",
  DELIVERY_CONFIRMATION_REJECTED: "交期已拒绝",
  submitted: "等待平台回执",
  unknown: "结果待核对",
  rejected: "发布被拒绝",
  queued: "等待执行",
  publishing: "发布中",
  pending: "等待回执",
  pending_verification: "等待回执核验",
  published: "已发布",
  failed: "发布失败",
  blocked: "发布受阻",
  cancelled: "已取消",
};
export type WorkspaceLibraryRecord = {
  id: string;
  projectId: string;
  projectTitle: string;
  kind: WorkspaceRecordKind;
  collection: WorkspaceCollection;
  title: string;
  statusLabel: string;
  relation: string;
  updatedAt: Date;
  href: string;
};
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

// Project membership has already scoped the snapshot. Return display fields only, never raw payloads.
export function deriveWorkspaceLibrary(snapshot: WorkspaceTaskSnapshot): WorkspaceLibraryRecord[] {
  const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
  const rows: WorkspaceLibraryRecord[] = [];
  for (const record of snapshot.records) {
    const project = projects.get(record.projectId);
    const kind = record.type === "delivery_confirmation" ? "delivery" : record.type;
    if (!project || !isWorkspaceRecordKind(kind)) continue;
    const product = object(record.payload.product);
    const customer = object(record.payload.customer);
    const name =
      text(product.product_name) ||
      text(record.payload.hook) ||
      text(customer.company) ||
      text(customer.name) ||
      text(record.payload.objective);
    rows.push({
      id: record.id,
      projectId: project.id,
      projectTitle: project.title,
      kind,
      collection: workspaceCollection(kind),
      title: name || `${recordKindLabels[kind]} · ${record.id.slice(0, 8)}`,
      statusLabel: stateLabels[record.state] ?? "状态待核对",
      relation: record.relation,
      updatedAt: record.updatedAt,
      href: workspaceRecordHref(project.id, kind, record.id),
    });
  }
  for (const publication of snapshot.publications) {
    const project = projects.get(publication.projectId);
    if (!project) continue;
    const content = rows.find(
      (row) => row.id === publication.contentRef && row.projectId === project.id,
    );
    rows.push({
      id: publication.id,
      projectId: project.id,
      projectTitle: project.title,
      kind: "publication",
      collection: "content",
      title: content ? `${content.title} · 发布` : `发布记录 · ${publication.id.slice(0, 8)}`,
      statusLabel: stateLabels[publication.status] ?? "回执待核对",
      relation: "owned",
      updatedAt: publication.createdAt,
      href: workspaceRecordHref(project.id, "publication", publication.id),
    });
  }
  return rows.sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id),
  );
}
