import { z } from "zod";

import type { ReviewVideoExport } from "./export-artifact";

const opaqueRef = (prefix: string) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^${prefix}-[a-z0-9][a-z0-9_-]{2,120}$`, "i"));
const channelSchema = z.enum(["facebook", "instagram", "x", "youtube", "tiktok"]);

export const socialVideoPublicationPolicySchema = z
  .object({
    channel: channelSchema,
    transport: z.enum(["official_api", "camofox_controlled_mvp1"]),
    draftEnabled: z.boolean(),
    publishingEnabled: z.boolean(),
    accountRef: opaqueRef("social-account"),
    credentialRef: opaqueRef("social-credential"),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.publishingEnabled && !policy.draftEnabled) {
      context.addIssue({
        code: "custom",
        path: ["publishingEnabled"],
        message: "启用正式发布前必须先启用所选传输的草稿路径。",
      });
    }
  });
export type SocialVideoPublicationPolicy = z.infer<typeof socialVideoPublicationPolicySchema>;

export type SocialVideoPublicationAdapter = {
  channel: z.infer<typeof channelSchema>;
  transport: SocialVideoPublicationPolicy["transport"];
  createDraft(input: {
    accountRef: string;
    assetRef: string;
    credential: string;
    idempotencyKey: string;
  }): Promise<{ publicationRef: string; status: "draft" }>;
  publishDraft(input: {
    accountRef: string;
    publicationRef: string;
    credential: string;
    humanConfirmationRef: string;
  }): Promise<{ publicationRef: string; status: "published" }>;
};

export type SocialVideoDraft = {
  channel: z.infer<typeof channelSchema>;
  accountRef: string;
  assetRef: string;
  publicationRef: string;
  status: "draft";
};

function requireApprovedExport(exportArtifact: ReviewVideoExport) {
  if (exportArtifact.status !== "approved" || !exportArtifact.approvalRef) {
    throw new Error("视频导出物必须经人工审核批准后才能创建社交草稿。 ");
  }
}

function adapterFor(
  policy: SocialVideoPublicationPolicy,
  adapters: readonly SocialVideoPublicationAdapter[],
) {
  const adapter = adapters.find(
    (candidate) => candidate.channel === policy.channel && candidate.transport === policy.transport,
  );
  if (!adapter) throw new Error("此社交渠道未配置所选传输适配器。 ");
  return adapter;
}

/** Creates a reviewable draft through the explicitly enabled transport; it never publishes. */
export async function createSocialVideoDraft(
  exportArtifact: ReviewVideoExport,
  policyInput: SocialVideoPublicationPolicy,
  adapters: readonly SocialVideoPublicationAdapter[],
  resolveCredential: (credentialRef: string) => Promise<string>,
): Promise<SocialVideoDraft> {
  const policy = socialVideoPublicationPolicySchema.parse(policyInput);
  requireApprovedExport(exportArtifact);
  if (!policy.draftEnabled) throw new Error("此渠道未启用所选传输的草稿路径。 ");
  if (policy.channel !== exportArtifact.platform)
    throw new Error("社交渠道必须与导出物平台一致。 ");
  const credential = await resolveCredential(policy.credentialRef);
  if (!credential.trim()) throw new Error("社交渠道凭据不可用。 ");
  const result = await adapterFor(policy, adapters).createDraft({
    accountRef: policy.accountRef,
    assetRef: exportArtifact.sourceAssetRef,
    credential,
    idempotencyKey: `video-export-${exportArtifact.id}`,
  });
  if (
    !/^publication-[a-z0-9][a-z0-9_-]{2,120}$/i.test(result.publicationRef) ||
    result.status !== "draft"
  )
    throw new Error("渠道适配器返回的草稿引用无效。 ");
  return {
    channel: policy.channel,
    accountRef: policy.accountRef,
    assetRef: exportArtifact.sourceAssetRef,
    publicationRef: result.publicationRef,
    status: "draft",
  };
}

/** Formal publish remains a distinct human-confirmed action after draft review. */
export async function publishSocialVideoDraft(
  draft: SocialVideoDraft,
  policyInput: SocialVideoPublicationPolicy,
  humanConfirmationRef: string,
  adapters: readonly SocialVideoPublicationAdapter[],
  resolveCredential: (credentialRef: string) => Promise<string>,
) {
  const policy = socialVideoPublicationPolicySchema.parse(policyInput);
  if (!/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i.test(humanConfirmationRef))
    throw new Error("正式发布必须有人工确认的证据引用。 ");
  if (!policy.publishingEnabled) throw new Error("此渠道未启用正式发布。 ");
  if (
    draft.status !== "draft" ||
    draft.channel !== policy.channel ||
    draft.accountRef !== policy.accountRef
  )
    throw new Error("草稿与发布策略不匹配。 ");
  const credential = await resolveCredential(policy.credentialRef);
  if (!credential.trim()) throw new Error("社交渠道凭据不可用。 ");
  const result = await adapterFor(policy, adapters).publishDraft({
    accountRef: policy.accountRef,
    publicationRef: draft.publicationRef,
    credential,
    humanConfirmationRef,
  });
  if (result.status !== "published" || result.publicationRef !== draft.publicationRef)
    throw new Error("渠道适配器返回的发布状态无效。 ");
  return result;
}
