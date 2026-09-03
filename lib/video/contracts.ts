import { z } from "zod";

import { marketingVideoDraftSchema } from "./edit-contracts";

const privateRef = z.string().trim().regex(/^(?:source|evidence|asset)-[a-z0-9][a-z0-9_-]{2,120}$/i, "必须是脱敏的私有引用。");
const evidenceRef = z.string().trim().regex(/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i, "ProductMedia 必须引用私有证据记录。");

export const videoPlatformSchema = z.enum(["facebook", "instagram", "x", "youtube", "tiktok"]);
export type VideoPlatform = z.infer<typeof videoPlatformSchema>;

export const videoExportArtifactSchema = z.object({
  id: z.uuid(),
  videoId: z.uuid(),
  sourceAssetRef: privateRef,
  platform: videoPlatformSchema,
  surface: z.enum(["video", "reels"]),
  presetVersion: z.string().trim().min(1).max(40),
  presetSourceUrl: z.url(),
  status: z.enum(["review_required", "approved"]),
  approvalRef: z.string().trim().regex(/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i).optional(),
  timelineDurationSeconds: z.number().positive(),
  measured: z.object({
    container: z.literal("mp4"),
    videoCodec: z.string().trim().min(1),
    audioCodec: z.string().trim().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    durationSeconds: z.number().positive(),
    subtitleStreamCount: z.number().int().min(0),
  }).strict(),
  createdAt: z.iso.datetime(),
}).strict().superRefine((artifact, context) => {
  if ((artifact.status === "approved") !== Boolean(artifact.approvalRef)) {
    context.addIssue({ code: "custom", path: ["approvalRef"], message: "导出物批准状态必须与人工审核证据一致。" });
  }
});

export type VideoExportArtifact = z.infer<typeof videoExportArtifactSchema>;

export const videoFactClaimSchema = z.object({
  field: z.string().trim().regex(/^(?:product|specifications|commercial)\.[a-z_]+$/, "必须引用已核验产品字段。"),
  value: z.string().trim().min(1).max(500),
  evidenceRef: privateRef,
}).strict();

export const videoAssetSchema = z.object({
  assetRef: privateRef,
  mediaType: z.enum(["image", "video", "audio", "logo", "subtitle"]),
  rightsEvidenceRef: privateRef,
  productMediaId: z.uuid("ProductMedia 标识无效。").optional(),
}).strict().superRefine((asset, context) => {
  if (!asset.productMediaId) return;
  if (!evidenceRef.safeParse(asset.assetRef).success) {
    context.addIssue({ code: "custom", path: ["assetRef"], message: "ProductMedia 源文件必须引用 evidence 记录。" });
  }
  if (!evidenceRef.safeParse(asset.rightsEvidenceRef).success) {
    context.addIssue({ code: "custom", path: ["rightsEvidenceRef"], message: "ProductMedia 权利必须引用 evidence 记录。" });
  }
  if (asset.mediaType !== "image" && asset.mediaType !== "video") {
    context.addIssue({ code: "custom", path: ["mediaType"], message: "ProductMedia 只能作为图片或视频素材。" });
  }
});

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
  status: z.enum(["draft", "rendering", "ready_for_generation", "review_required", "revision_required", "approved", "export_ready"]),
  objective: z.string().trim().min(1).max(2_000),
  targetAudience: z.string().trim().min(1).max(240),
  platforms: z.array(videoPlatformSchema).min(1).max(5),
  factualClaims: z.array(videoFactClaimSchema).min(1).max(24),
  sourceAssets: z.array(videoAssetSchema).max(16),
  scenes: z.array(videoSceneSchema).min(1).max(20),
  approvalRefs: z.array(z.string().trim().min(1)).max(2).default([]),
  editDraft: marketingVideoDraftSchema.optional(),
  renderedAssetRef: privateRef.optional(),
  exportArtifact: videoExportArtifactSchema.optional(),
}).strict().superRefine((project, context) => {
  const claimFields = new Set(project.factualClaims.map((claim) => claim.field));
  const assetRefs = new Set(project.sourceAssets.map((asset) => asset.assetRef));
  const productMediaIds = new Set<string>();
  if (project.exportArtifact) {
    if (project.exportArtifact.videoId !== project.id) {
      context.addIssue({ code: "custom", path: ["exportArtifact", "videoId"], message: "导出物必须属于当前视频项目。" });
    }
    if (project.exportArtifact.sourceAssetRef !== project.renderedAssetRef) {
      context.addIssue({ code: "custom", path: ["exportArtifact", "sourceAssetRef"], message: "导出物必须绑定当前合成文件。" });
    }
    if (project.editDraft && project.exportArtifact.platform !== project.editDraft.platform) {
      context.addIssue({ code: "custom", path: ["exportArtifact", "platform"], message: "导出物平台必须与当前剪辑稿一致。" });
    }
  }
  for (const [assetIndex, asset] of project.sourceAssets.entries()) {
    if (!asset.productMediaId) continue;
    if (productMediaIds.has(asset.productMediaId)) {
      context.addIssue({ code: "custom", path: ["sourceAssets", assetIndex, "productMediaId"], message: "同一个 ProductMedia 不能重复绑定到视频项目。" });
    }
    productMediaIds.add(asset.productMediaId);
  }
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    for (const field of scene.claimRefs) {
      if (!claimFields.has(field)) context.addIssue({ code: "custom", path: ["scenes", sceneIndex, "claimRefs"], message: `镜头引用了未绑定证据的字段：${field}` });
    }
    for (const assetRef of scene.assetRefs) {
      if (!assetRefs.has(assetRef)) context.addIssue({ code: "custom", path: ["scenes", sceneIndex, "assetRefs"], message: `镜头引用了未授权素材：${assetRef}` });
    }
  }
});

export type VideoProject = z.infer<typeof videoProjectSchema>;
