import { z } from "zod";

export const workspaceProjectKindSchema = z.enum(["marketing", "sales"]);
export const workspaceProjectStatusSchema = z.enum(["active", "archived"]);
export const workspaceNodeKindSchema = z.enum(["product", "content", "video", "publication", "rfq", "approval", "quotation", "lead", "delivery", "note"]);
export const workspaceEdgeKindSchema = z.enum(["depends_on", "derived_from", "requires_review", "relates_to"]);

const nodeId = z.string().trim().min(1).max(160).regex(/^[a-z][a-z0-9_-]*$/i, "节点标识格式不正确。");
const position = z.object({ x: z.number().finite().min(-100_000).max(100_000), y: z.number().finite().min(-100_000).max(100_000) }).strict();

const workspaceCanvasDocumentInputSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  nodes: z.array(z.object({
    id: nodeId,
    kind: workspaceNodeKindSchema,
    position,
    locked: z.boolean().default(false),
    aggregateId: z.uuid().optional(),
    aggregateType: z.enum(["product", "content", "video", "rfq", "quotation", "lead", "delivery_confirmation"]).optional(),
    label: z.string().trim().min(1).max(160),
  }).strict()).min(1).max(100),
  edges: z.array(z.object({ id: nodeId, source: nodeId, target: nodeId, kind: workspaceEdgeKindSchema }).strict()).max(300),
}).strict().superRefine((document, context) => {
  const ids = new Set<string>();
  for (const [index, node] of document.nodes.entries()) {
    if (ids.has(node.id)) context.addIssue({ code: "custom", path: ["nodes", index, "id"], message: "节点标识不能重复。" });
    ids.add(node.id);
    if (Boolean(node.aggregateId) !== Boolean(node.aggregateType)) context.addIssue({ code: "custom", path: ["nodes", index], message: "聚合引用必须同时包含类型和标识。" });
  }
  const pairs = new Set<string>();
  for (const [index, edge] of document.edges.entries()) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) context.addIssue({ code: "custom", path: ["edges", index], message: "连线必须连接两个不同的现有节点。" });
    const pair = `${edge.source}\u0000${edge.target}`;
    if (pairs.has(pair)) context.addIssue({ code: "custom", path: ["edges", index], message: "两个节点之间只能有一条连线。" });
    pairs.add(pair);
  }
});

export const workspaceCanvasDocumentSchema = workspaceCanvasDocumentInputSchema.transform((document) => ({
  ...document,
  version: 2 as const,
  nodes: document.nodes.map(({ aggregateId: _aggregateId, aggregateType: _aggregateType, ...node }) => node),
}));

export type WorkspaceCanvasDocument = z.infer<typeof workspaceCanvasDocumentSchema>;

export function createWorkspaceTemplate(kind: "marketing" | "sales"): WorkspaceCanvasDocument {
  if (kind === "marketing") return {
    version: 2,
    nodes: [
      { id: "product", kind: "product", label: "产品事实", locked: true, position: { x: 40, y: 120 } },
      { id: "content", kind: "content", label: "营销内容", locked: true, position: { x: 320, y: 40 } },
      { id: "video", kind: "video", label: "营销视频", locked: true, position: { x: 320, y: 220 } },
      { id: "publication", kind: "publication", label: "受控发布", locked: true, position: { x: 600, y: 120 } },
    ],
    edges: [
      { id: "edge-product-content", source: "product", target: "content", kind: "derived_from" },
      { id: "edge-product-video", source: "product", target: "video", kind: "derived_from" },
      { id: "edge-content-publication", source: "content", target: "publication", kind: "requires_review" },
      { id: "edge-video-publication", source: "video", target: "publication", kind: "requires_review" },
    ],
  };
  return {
    version: 2,
    nodes: [
      { id: "rfq", kind: "rfq", label: "客户询盘", locked: true, position: { x: 40, y: 40 } },
      { id: "product", kind: "product", label: "产品引用", locked: true, position: { x: 40, y: 220 } },
      { id: "quotation", kind: "quotation", label: "人工报价", locked: true, position: { x: 320, y: 130 } },
      { id: "lead", kind: "lead", label: "跟进与商机", locked: true, position: { x: 600, y: 130 } },
      { id: "delivery", kind: "delivery", label: "交期确认", locked: true, position: { x: 600, y: 310 } },
    ],
    edges: [
      { id: "edge-rfq-quotation", source: "rfq", target: "quotation", kind: "depends_on" },
      { id: "edge-product-quotation", source: "product", target: "quotation", kind: "depends_on" },
      { id: "edge-quotation-lead", source: "quotation", target: "lead", kind: "depends_on" },
      { id: "edge-lead-delivery", source: "lead", target: "delivery", kind: "relates_to" },
      { id: "edge-delivery-lead", source: "delivery", target: "lead", kind: "relates_to" },
    ],
  };
}

type LegacyWorkspaceCanvasDocument = Omit<WorkspaceCanvasDocument, "version"> & { version: 1 | 2 };

export function normalizeLegacyWorkspaceTemplate(kind: "marketing" | "sales", document: LegacyWorkspaceCanvasDocument): WorkspaceCanvasDocument {
  const current = createWorkspaceTemplate(kind);
  const alreadyCurrent = document.nodes.length === current.nodes.length && current.nodes.every((expected) =>
    document.nodes.some((node) => node.id === expected.id && node.kind === expected.kind),
  );
  if (alreadyCurrent) return workspaceCanvasDocumentSchema.parse(document);
  const customNodes = document.nodes.filter((node) => node.kind === "note" && !current.nodes.some((expected) => expected.id === node.id));
  return {
    ...current,
    nodes: [
      ...current.nodes.map((node) => ({ ...node, position: document.nodes.find((legacyNode) => legacyNode.id === node.id)?.position ?? node.position })),
      ...customNodes,
    ],
  };
}

export const createWorkspaceProjectSchema = z.object({ kind: workspaceProjectKindSchema, title: z.string().trim().min(1, "请输入项目名称。").max(120, "项目名称不能超过 120 个字符。") }).strict();
export const saveWorkspaceCanvasSchema = z.object({ expectedRevision: z.number().int().min(0), document: workspaceCanvasDocumentSchema }).strict();
