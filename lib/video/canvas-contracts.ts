import { z } from "zod";

const canvasNodeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z][a-z0-9_-]*$/i, "节点标识格式不正确。");
const canvasPositionSchema = z
  .object({
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
  })
  .strict();
const requiredCanvasEdges = [
  { id: "brief-facts", source: "brief", target: "facts" },
  { id: "facts-generate", source: "facts", target: "generate" },
  { id: "assets-generate", source: "assets", target: "generate" },
] as const;

export const videoCanvasFactBindingSchema = z
  .object({
    productId: z.uuid("产品记录标识无效。"),
    factPath: z
      .string()
      .trim()
      .regex(/^(?:product|specifications|commercial)\.[a-z_]+$/, "必须引用已核验产品字段。"),
  })
  .strict();
export type VideoCanvasFactBinding = z.infer<typeof videoCanvasFactBindingSchema>;

export const videoCanvasBriefSchema = z
  .object({
    objective: z
      .string()
      .trim()
      .min(1, "请输入营销目标。")
      .max(2_000, "营销目标不能超过 2,000 个字符。"),
    targetAudience: z
      .string()
      .trim()
      .min(1, "请输入目标受众。")
      .max(240, "目标受众不能超过 240 个字符。"),
  })
  .strict();
export type VideoCanvasBrief = z.infer<typeof videoCanvasBriefSchema>;

const privateAssetRefSchema = z
  .string()
  .trim()
  .regex(/^asset-[a-z0-9][a-z0-9_-]{2,120}$/i, "必须是脱敏的私有素材引用。");
const privateEvidenceRefSchema = z
  .string()
  .trim()
  .regex(/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i, "必须是脱敏的权利证据引用。");
export const videoCanvasAssetBindingSchema = z
  .object({
    assetRef: privateAssetRefSchema,
    rightsEvidenceRef: privateEvidenceRefSchema,
  })
  .strict();
export type VideoCanvasAssetBinding = z.infer<typeof videoCanvasAssetBindingSchema>;

export const videoCanvasSceneSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1, "请输入镜头说明。")
      .max(4_000, "镜头说明不能超过 4,000 个字符。"),
    durationSeconds: z
      .number()
      .int("镜头时长必须是整数。")
      .min(1, "镜头时长至少 1 秒。")
      .max(30, "单个镜头不能超过 30 秒。"),
  })
  .strict();
export type VideoCanvasScene = z.infer<typeof videoCanvasSceneSchema>;

export const videoCanvasPlatformSchema = z.enum([
  "facebook",
  "instagram",
  "x",
  "youtube",
  "tiktok",
]);

export const videoCanvasDocumentSchema = z
  .object({
    version: z.literal(1),
    nodes: z
      .array(
        z
          .object({
            id: canvasNodeIdSchema,
            type: z.enum(["input", "output", "studio"]).optional(),
            position: canvasPositionSchema,
            deletable: z.boolean().optional(),
            data: z.object({ label: z.string().trim().min(1).max(220) }).strict(),
          })
          .strict(),
      )
      .min(4)
      .max(100),
    edges: z
      .array(
        z
          .object({
            id: canvasNodeIdSchema,
            source: canvasNodeIdSchema,
            target: canvasNodeIdSchema,
          })
          .strict(),
      )
      .min(3)
      .max(300),
    factBinding: videoCanvasFactBindingSchema.optional(),
    brief: videoCanvasBriefSchema.optional(),
    assetBinding: videoCanvasAssetBindingSchema.optional(),
    platforms: z.array(videoCanvasPlatformSchema).min(1).max(5).optional(),
    scenes: z.record(canvasNodeIdSchema, videoCanvasSceneSchema).optional(),
  })
  .strict()
  .superRefine((document, context) => {
    const nodeIds = new Set<string>();
    for (const [index, node] of document.nodes.entries()) {
      if (nodeIds.has(node.id))
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "id"],
          message: "节点标识不能重复。",
        });
      nodeIds.add(node.id);
    }
    for (const id of ["brief", "facts", "assets", "generate"]) {
      if (!nodeIds.has(id))
        context.addIssue({ code: "custom", path: ["nodes"], message: `缺少必要节点：${id}。` });
    }
    const sceneNodeIds = document.nodes
      .filter((node) => node.id.startsWith("scene-"))
      .map((node) => node.id);
    for (const sceneId of Object.keys(document.scenes ?? {})) {
      if (!sceneNodeIds.includes(sceneId))
        context.addIssue({
          code: "custom",
          path: ["scenes", sceneId],
          message: "镜头资料必须关联到画布中的镜头节点。",
        });
    }

    const edgeIds = new Set<string>();
    const connections = new Set<string>();
    for (const [index, edge] of document.edges.entries()) {
      if (edgeIds.has(edge.id))
        context.addIssue({
          code: "custom",
          path: ["edges", index, "id"],
          message: "连线标识不能重复。",
        });
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target))
        context.addIssue({
          code: "custom",
          path: ["edges", index],
          message: "连线必须引用现有节点。",
        });
      if (edge.source === edge.target)
        context.addIssue({
          code: "custom",
          path: ["edges", index],
          message: "节点不能连接到自身。",
        });
      if (edge.source === "generate" || edge.target === "brief")
        context.addIssue({
          code: "custom",
          path: ["edges", index],
          message: "连线方向不符合画布流程。",
        });
      const connection = `${edge.source}\u0000${edge.target}`;
      if (connections.has(connection))
        context.addIssue({
          code: "custom",
          path: ["edges", index],
          message: "两个节点之间只能有一条连线。",
        });
      connections.add(connection);
    }
    for (const required of requiredCanvasEdges) {
      const edge = document.edges.find((item) => item.id === required.id);
      if (!edge || edge.source !== required.source || edge.target !== required.target) {
        context.addIssue({
          code: "custom",
          path: ["edges"],
          message: `缺少必要连线：${required.source} → ${required.target}。`,
        });
      }
    }

    const outgoing = new Map<string, string[]>();
    for (const edge of document.edges)
      outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    const visiting = new Set<string>();
    const visited = new Set<string>();
    function visit(nodeId: string): boolean {
      if (visiting.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      visiting.add(nodeId);
      for (const target of outgoing.get(nodeId) ?? []) if (visit(target)) return true;
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    }
    if (document.nodes.some((node) => visit(node.id)))
      context.addIssue({ code: "custom", path: ["edges"], message: "画布不能包含环路。" });
  });

export type VideoCanvasDocument = z.infer<typeof videoCanvasDocumentSchema>;
