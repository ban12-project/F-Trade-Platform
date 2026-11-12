import { publicationProgress } from "../social/publication-presentation";
import {
  isWorkspaceRecordKind,
  type WorkspaceCollection,
  type WorkspaceRecordKind,
  workspaceCollection,
  workspaceRecordHref,
} from "./navigation";
import type { TaskRecord, WorkspaceTaskSnapshot } from "./task-model";

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
export const recordStateLabels: Record<string, string> = {
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
export type WorkspaceLibraryPublication = {
  id: string;
  accountLabel: string;
  statusLabel: string;
  href: string;
  createdAt: Date;
};
export type WorkspaceLibraryRecord = {
  id: string;
  projectId: string;
  projectTitle: string;
  kind: WorkspaceRecordKind;
  collection: WorkspaceCollection;
  title: string;
  statusLabel: string;
  state: string;
  relation: string;
  updatedAt: Date;
  href: string;
  identifiers?: { label: string; value: string }[];
  publications?: WorkspaceLibraryPublication[];
};
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

// Only these visible business identifiers enter the client projection/search index.
function businessIdentifiers(record: TaskRecord, records: Map<string, TaskRecord>) {
  const related = (kind: string, id: unknown) =>
    typeof id === "string" ? records.get(`${record.projectId}:${kind}:${id}`) : undefined;
  let rfq = record.type === "rfq" ? record : undefined;
  if (record.type === "lead") rfq = related("rfq", record.payload.rfq_ref);
  if (record.type === "quotation") rfq = related("rfq", record.payload.rfq_id);
  if (record.type === "delivery_confirmation") {
    if (record.payload.related_entity_type === "rfq") {
      rfq = related("rfq", record.payload.related_entity_id);
    } else if (record.payload.related_entity_type === "opportunity") {
      const lead = related("lead", record.payload.related_entity_id);
      rfq = related("rfq", lead?.payload.rfq_ref);
    }
  }
  const productRecord =
    record.type === "product"
      ? record
      : related("product", record.payload.product_id ?? record.payload.productId);
  const product = object(productRecord?.payload.product);
  const requestedProduct = object((rfq ?? record).payload.product);
  const customer = object((rfq ?? record).payload.customer);
  const oeNumbers = [
    ...(Array.isArray(product.oe_numbers) ? product.oe_numbers : []),
    requestedProduct.oe_number,
  ].flatMap((value) => (text(value).trim() ? [text(value).trim()] : []));
  return [
    { label: "SKU", value: text(product.internal_sku).trim() },
    { label: "OE", value: [...new Set(oeNumbers)].join("、") },
    { label: "产品", value: text(product.product_name).trim() },
    { label: "客户", value: text(customer.name).trim() },
    { label: "公司", value: text(customer.company).trim() },
  ].filter((field) => field.value);
}

function normalizedSearch(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

export function matchesWorkspaceLibrarySearch(record: WorkspaceLibraryRecord, search: string) {
  const terms = normalizedSearch(search).split(/\s+/).filter(Boolean);
  const fields = [
    record.title,
    record.projectTitle,
    ...(record.identifiers ?? []).map((field) => field.value),
  ];
  const searchable = fields.map(normalizedSearch).join(" ");
  // SKU/OE can be copied with or without spaces/hyphens. Do not normalize other private data.
  const identifiers = (record.identifiers ?? [])
    .filter((field) => field.label === "SKU" || field.label === "OE")
    .map((field) => normalizedSearch(field.value).replace(/[\s-]+/g, ""));
  return terms.every(
    (term) =>
      searchable.includes(term) ||
      identifiers.some((value) => value.includes(term.replace(/[\s-]+/g, ""))),
  );
}

// Project membership has already scoped the snapshot. Return display fields only, never raw payloads.
export function deriveWorkspaceLibrary(snapshot: WorkspaceTaskSnapshot): WorkspaceLibraryRecord[] {
  const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
  const scopedRecords = new Map(
    snapshot.records
      .filter((record) => projects.has(record.projectId))
      .map((record) => [`${record.projectId}:${record.type}:${record.id}`, record]),
  );
  const rows: WorkspaceLibraryRecord[] = [];
  for (const record of snapshot.records) {
    const project = projects.get(record.projectId);
    const kind = record.type === "delivery_confirmation" ? "delivery" : record.type;
    if (!project || !isWorkspaceRecordKind(kind)) continue;
    const product = object(record.payload.product);
    const customer = object(record.payload.customer);
    const identifiers = businessIdentifiers(record, scopedRecords);
    const name =
      text(product.product_name) ||
      text(record.payload.hook) ||
      text(customer.company) ||
      text(customer.name) ||
      text(record.payload.objective) ||
      identifiers.find((field) => field.label === "公司")?.value ||
      identifiers.find((field) => field.label === "客户")?.value ||
      identifiers.find((field) => field.label === "产品")?.value;
    rows.push({
      id: record.id,
      projectId: project.id,
      projectTitle: project.title,
      kind,
      collection: workspaceCollection(kind),
      title: name || `${recordKindLabels[kind]} · ${record.id.slice(0, 8)}`,
      state: record.state,
      statusLabel: recordStateLabels[record.state] ?? "状态待核对",
      relation: record.relation,
      identifiers,
      updatedAt: record.updatedAt,
      href: workspaceRecordHref(project.id, kind, record.id),
    });
  }
  const contentByProject = new Map(
    rows
      .filter((row) => row.kind === "content" || row.kind === "video")
      .map((row) => [`${row.projectId}:${row.id}`, row]),
  );
  for (const content of contentByProject.values()) content.publications = [];
  for (const publication of [...snapshot.publications].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id),
  )) {
    const project = projects.get(publication.projectId);
    if (!project) continue;
    const content = contentByProject.get(`${project.id}:${publication.contentRef}`);
    if (!content?.publications) continue;
    content.publications.push({
      id: publication.id,
      accountLabel: publication.accountLabel || "发布账号",
      statusLabel: publicationProgress(publication.status, false, publication.jobStatus).label,
      createdAt: publication.createdAt,
      href: workspaceRecordHref(project.id, "publication", publication.id),
    });
    if (publication.createdAt > content.updatedAt) content.updatedAt = publication.createdAt;
  }

  return rows.sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id),
  );
}
