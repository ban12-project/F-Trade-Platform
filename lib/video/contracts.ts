import { z } from "zod";
import {
  marketingCreativeObjectives,
  marketingCreativePacingModes,
  marketingVideoAbcdRoleSchema,
  marketingVideoAbcdRoles,
  marketingVideoDraftSchema,
} from "./edit-contracts";
import { videoEncodingSchema } from "./encoding-contract";
import { videoPlatformSchema } from "./platform";
import { videoResourceMeasurementsSchema } from "./resource-measurements";

const unverifiedGenerationFactPattern =
  /\boe[m]?\b|\b(?:diameter|dimension|spline|certif(?:ied|ication)|lifetime|moq|lead[ -]?time|price|usd|eur|rmb|mm|kg)\b|尺寸|直径|花键|认证|寿命|起订|交期|价格/i;

const privateRef = z
  .string()
  .trim()
  .regex(/^(?:source|evidence|asset)-[a-z0-9][a-z0-9_-]{2,120}$/i, "必须是脱敏的私有引用。");
const evidenceRef = z
  .string()
  .trim()
  .regex(/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i, "ProductMedia 必须引用私有证据记录。");

export { type VideoPlatform, videoPlatformSchema } from "./platform";

export const videoExportArtifactSchema = z
  .object({
    id: z.uuid(),
    videoId: z.uuid(),
    sourceAssetRef: privateRef,
    platform: videoPlatformSchema,
    surface: z.enum(["video", "reels"]),
    presetVersion: z.string().trim().min(1).max(40),
    presetSourceUrl: z.url(),
    status: z.enum(["review_required", "approved"]),
    approvalRef: z
      .string()
      .trim()
      .regex(/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i)
      .optional(),
    timelineDurationSeconds: z.number().positive(),
    measured: z
      .object({
        container: z.literal("mp4"),
        videoCodec: z.string().trim().min(1),
        audioCodec: z.string().trim().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        fps: z.number().positive(),
        durationSeconds: z.number().positive(),
        subtitleStreamCount: z.number().int().min(0),
        encoding: videoEncodingSchema.optional(),
        resources: videoResourceMeasurementsSchema.optional(),
      })
      .strict(),
    createdAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((artifact, context) => {
    if ((artifact.status === "approved") !== Boolean(artifact.approvalRef)) {
      context.addIssue({
        code: "custom",
        path: ["approvalRef"],
        message: "导出物批准状态必须与人工审核证据一致。",
      });
    }
  });

export type VideoExportArtifact = z.infer<typeof videoExportArtifactSchema>;

export const videoFactClaimSchema = z
  .object({
    field: z
      .string()
      .trim()
      .regex(/^(?:product|specifications|commercial)\.[a-z_]+$/, "必须引用已核验产品字段。"),
    value: z.string().trim().min(1).max(500),
    evidenceRef: privateRef,
  })
  .strict();

export const videoAssetSchema = z
  .object({
    assetRef: privateRef,
    mediaType: z.enum(["image", "video", "audio", "logo", "subtitle"]),
    rightsEvidenceRef: privateRef,
    productMediaId: z.uuid("ProductMedia 标识无效。").optional(),
    usagePolicy: z.enum(["publishable", "private_test_only"]).optional(),
  })
  .strict()
  .superRefine((asset, context) => {
    if (!asset.productMediaId) return;
    if (!evidenceRef.safeParse(asset.assetRef).success) {
      context.addIssue({
        code: "custom",
        path: ["assetRef"],
        message: "ProductMedia 源文件必须引用 evidence 记录。",
      });
    }
    if (!evidenceRef.safeParse(asset.rightsEvidenceRef).success) {
      context.addIssue({
        code: "custom",
        path: ["rightsEvidenceRef"],
        message: "ProductMedia 权利必须引用 evidence 记录。",
      });
    }
    if (asset.mediaType !== "image" && asset.mediaType !== "video") {
      context.addIssue({
        code: "custom",
        path: ["mediaType"],
        message: "ProductMedia 只能作为图片或视频素材。",
      });
    }
  });

export const videoSceneSchema = z
  .object({
    sceneId: z
      .string()
      .trim()
      .regex(/^scene-[a-z0-9][a-z0-9_-]{2,80}$/i),
    prompt: z.string().trim().min(1).max(4_000),
    durationSeconds: z.number().int().min(1).max(30),
    claimRefs: z.array(z.string().trim().min(1)).max(24),
    assetRefs: z.array(privateRef).max(16),
    abcdRoles: z.array(marketingVideoAbcdRoleSchema).min(1).max(4).optional(),
    framing: z.enum(["tight", "medium", "wide"]).optional(),
    visualContrast: z.enum(["high_contrast_bright", "natural"]).optional(),
  })
  .strict();

export const videoProjectSchema = z
  .object({
    id: z.uuid(),
    productId: z.uuid(),
    status: z.enum([
      "draft",
      "rendering",
      "ready_for_generation",
      "review_required",
      "revision_required",
      "approved",
      "export_ready",
    ]),
    objective: z.string().trim().min(1).max(2_000),
    targetAudience: z.string().trim().min(1).max(240),
    creativeObjective: z.enum(marketingCreativeObjectives).optional(),
    pacingMode: z.enum(marketingCreativePacingModes).optional(),
    platforms: z.array(videoPlatformSchema).min(1).max(5),
    factualClaims: z.array(videoFactClaimSchema).min(1).max(24),
    sourceAssets: z.array(videoAssetSchema).max(16),
    scenes: z.array(videoSceneSchema).min(1).max(20),
    approvalRefs: z.array(z.string().trim().min(1)).max(2).default([]),
    editDraft: marketingVideoDraftSchema.optional(),
    renderedAssetRef: privateRef.optional(),
    exportArtifact: videoExportArtifactSchema.optional(),
  })
  .strict()
  .superRefine((project, context) => {
    const claimFields = new Set(project.factualClaims.map((claim) => claim.field));
    const assetRefs = new Set(project.sourceAssets.map((asset) => asset.assetRef));
    const productMediaIds = new Set<string>();
    if (project.exportArtifact) {
      if (project.exportArtifact.videoId !== project.id) {
        context.addIssue({
          code: "custom",
          path: ["exportArtifact", "videoId"],
          message: "导出物必须属于当前视频项目。",
        });
      }
      if (project.exportArtifact.sourceAssetRef !== project.renderedAssetRef) {
        context.addIssue({
          code: "custom",
          path: ["exportArtifact", "sourceAssetRef"],
          message: "导出物必须绑定当前合成文件。",
        });
      }
      if (project.editDraft && project.exportArtifact.platform !== project.editDraft.platform) {
        context.addIssue({
          code: "custom",
          path: ["exportArtifact", "platform"],
          message: "导出物平台必须与当前剪辑稿一致。",
        });
      }
    }
    for (const [assetIndex, asset] of project.sourceAssets.entries()) {
      if (!asset.productMediaId) continue;
      if (productMediaIds.has(asset.productMediaId)) {
        context.addIssue({
          code: "custom",
          path: ["sourceAssets", assetIndex, "productMediaId"],
          message: "同一个 ProductMedia 不能重复绑定到视频项目。",
        });
      }
      productMediaIds.add(asset.productMediaId);
    }
    for (const [sceneIndex, scene] of project.scenes.entries()) {
      for (const field of scene.claimRefs) {
        if (!claimFields.has(field))
          context.addIssue({
            code: "custom",
            path: ["scenes", sceneIndex, "claimRefs"],
            message: `镜头引用了未绑定证据的字段：${field}`,
          });
      }
      for (const assetRef of scene.assetRefs) {
        if (!assetRefs.has(assetRef))
          context.addIssue({
            code: "custom",
            path: ["scenes", sceneIndex, "assetRefs"],
            message: `镜头引用了未授权素材：${assetRef}`,
          });
      }
    }
    if (
      project.creativeObjective !== undefined ||
      project.scenes.some((scene) => scene.abcdRoles !== undefined)
    ) {
      for (const [sceneIndex, scene] of project.scenes.entries()) {
        if (!scene.abcdRoles?.length) {
          context.addIssue({
            code: "custom",
            path: ["scenes", sceneIndex, "abcdRoles"],
            message: "启用结构化 ABCD 生成治理时，每个镜头必须声明 abcdRoles。",
          });
        } else if (new Set(scene.abcdRoles).size !== scene.abcdRoles.length) {
          context.addIssue({
            code: "custom",
            path: ["scenes", sceneIndex, "abcdRoles"],
            message: "同一镜头的 ABCD 节拍不能重复。",
          });
        }
        if (scene.claimRefs.length === 0 && unverifiedGenerationFactPattern.test(scene.prompt)) {
          context.addIssue({
            code: "custom",
            path: ["scenes", sceneIndex, "prompt"],
            message: "未绑定核验事实引用（claimRefs）的生成镜头提示词不能包含工程或商业参数。",
          });
        }
      }
      const coveredRoles = new Set(project.scenes.flatMap((scene) => scene.abcdRoles ?? []));
      for (const role of marketingVideoAbcdRoles) {
        if (!coveredRoles.has(role)) {
          context.addIssue({
            code: "custom",
            path: ["scenes"],
            message: `视频生成计划缺少 ${role} 节拍。`,
          });
        }
      }
      const firstRoles = project.scenes[0]?.abcdRoles ?? [];
      if (project.pacingMode === "shorts_organic") {
        if (project.platforms.every((platform) => platform === "x")) {
          context.addIssue({
            code: "custom",
            path: ["platforms"],
            message: "竖屏短片叙事模式不能仅面向横屏平台 X。",
          });
        }
        if (!firstRoles.includes("connection") && !firstRoles.includes("attention")) {
          context.addIssue({
            code: "custom",
            path: ["scenes", 0, "abcdRoles"],
            message: "竖屏短片生成计划首个镜头必须承担 connection 或 attention。",
          });
        }
      } else {
        if (!firstRoles.includes("attention") || !firstRoles.includes("branding")) {
          context.addIssue({
            code: "custom",
            path: ["scenes", 0, "abcdRoles"],
            message: "生成计划首个镜头必须同时承担 attention 与 branding。",
          });
        }
      }
      if (!project.scenes.at(-1)?.abcdRoles?.includes("direction")) {
        context.addIssue({
          code: "custom",
          path: ["scenes"],
          message: "生成计划最后一个镜头必须包含 direction。",
        });
      }
      if (
        project.creativeObjective === "consideration" &&
        !project.scenes.some(
          (scene) => scene.abcdRoles?.includes("connection") && scene.claimRefs.length > 0,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["scenes"],
          message: "考虑目标生成计划必须在 connection 镜头绑定已核验产品事实。",
        });
      }
      if (project.creativeObjective === "full_funnel") {
        if (project.scenes.length < 2) {
          context.addIssue({
            code: "custom",
            path: ["scenes"],
            message: "全漏斗生成计划至少需要 2 个镜头。",
          });
        }
        if (!project.scenes.some((scene) => scene.claimRefs.length > 0)) {
          context.addIssue({
            code: "custom",
            path: ["scenes"],
            message: "全漏斗生成计划至少需要在一个镜头绑定已核验产品事实。",
          });
        }
      }
    }
  });

export type VideoProject = z.infer<typeof videoProjectSchema>;

export function isPrivateTestOnlyVideo(project: Pick<VideoProject, "sourceAssets">) {
  return project.sourceAssets.some((asset) => asset.usagePolicy === "private_test_only");
}

export function assertVideoPublicationEligible(project: Pick<VideoProject, "sourceAssets">) {
  if (isPrivateTestOnlyVideo(project)) {
    throw new Error("互联网测试素材只能生成私有预览，不能批准为可发布成片。");
  }
}
