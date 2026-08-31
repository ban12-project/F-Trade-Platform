import { z } from "zod";

export const workspaceProjectKindSchema = z.enum(["marketing", "sales"]);
export const workspaceProjectStatusSchema = z.enum(["active", "archived"]);
export const workspaceNodeKindSchema = z.enum(["product", "content", "video", "rfq", "approval", "quotation", "delivery", "note"]);
export const workspaceEdgeKindSchema = z.enum(["depends_on", "derived_from", "requires_review", "relates_to"]);

const nodeId = z.string().trim().min(1).max(160).regex(/^[a-z][a-z0-9_-]*$/i, "节点标识格式不正确。");
const position = z.object({ x: z.number().finite().min(-100_000).max(100_000), y: z.number().finite().min(-100_000).max(100_000) }).strict();

export const workspaceCanvasDocumentSchema = z.object({
  version: z.literal(1),
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

export type WorkspaceCanvasDocument = z.infer<typeof workspaceCanvasDocumentSchema>;
export const createWorkspaceProjectSchema = z.object({ kind: workspaceProjectKindSchema, title: z.string().trim().min(1, "请输入项目名称。").max(120, "项目名称不能超过 120 个字符。") }).strict();
export const saveWorkspaceCanvasSchema = z.object({ expectedRevision: z.number().int().min(0), document: workspaceCanvasDocumentSchema }).strict();
