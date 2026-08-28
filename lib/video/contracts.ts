import { z } from "zod";

const privateRef = z.string().trim().regex(/^(?:source|evidence|asset)-[a-z0-9][a-z0-9_-]{2,120}$/i, "必须是脱敏的私有引用。");

export const videoPlatformSchema = z.enum(["facebook", "instagram", "x", "youtube", "tiktok"]);
export type VideoPlatform = z.infer<typeof videoPlatformSchema>;

export const videoFactClaimSchema = z.object({
  field: z.string().trim().regex(/^(?:product|specifications|commercial)\.[a-z_]+$/, "必须引用已核验产品字段。"),
  value: z.string().trim().min(1).max(500),
  evidenceRef: privateRef,
}).strict();

export const videoAssetSchema = z.object({
  assetRef: privateRef,
  mediaType: z.enum(["image", "video", "audio", "logo", "subtitle"]),
  rightsEvidenceRef: privateRef,
}).strict();

export const videoSceneSchema = z.object({
  sceneId: z.string().trim().regex(/^scene-[a-z0-9][a-z0-9_-]{2,80}$/i),
  prompt: z.string().trim().min(1).max(4_000),
  durationSeconds: z.number().int().min(1).max(30),
  claimRefs: z.array(z.string().trim().min(1)).max(24),
  assetRefs: z.array(privateRef).max(16),
}).strict();

export const videoProjectSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  status: z.enum(["draft", "review_required", "revision_required", "approved", "export_ready"]),
  objective: z.string().trim().min(1).max(2_000),
  targetAudience: z.string().trim().min(1).max(240),
  platforms: z.array(videoPlatformSchema).min(1).max(5),
  factualClaims: z.array(videoFactClaimSchema).min(1).max(24),
  sourceAssets: z.array(videoAssetSchema).max(16),
  scenes: z.array(videoSceneSchema).min(1).max(20),
  approvalRefs: z.array(z.string().trim().min(1)).max(2),
}).strict().superRefine((project, context) => {
  const claimFields = new Set(project.factualClaims.map((claim) => claim.field));
  const assetRefs = new Set(project.sourceAssets.map((asset) => asset.assetRef));
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    for (const field of scene.claimRefs) {
      if (!claimFields.has(field)) context.addIssue({ code: "custom", path: ["scenes", sceneIndex, "claimRefs"], message: `镜头引用了未绑定证据的字段：${field}` });
    }
    for (const assetRef of scene.assetRefs) {
      if (!assetRefs.has(assetRef)) context.addIssue({ code: "custom", path: ["scenes", sceneIndex, "assetRefs"], message: `镜头引用了未授权素材：${assetRef}` });
    }
  }
  if (project.status === "export_ready" && project.approvalRefs.length < 2) {
    context.addIssue({ code: "custom", path: ["approvalRefs"], message: "导出前必须同时具备内容审核与导出审核记录。" });
  }
});

export type VideoProject = z.infer<typeof videoProjectSchema>;
