import { z } from "zod";

import { videoProjectSchema, type VideoProject } from "./contracts";
import {
  selectVerifiedVideoModel,
  videoGenerationRequestSchema,
  type VideoModelCapability,
  type VideoProviderId,
} from "./provider-capabilities";

const privateRef = z.string().trim().regex(/^(?:asset|provider-job)-[a-z0-9][a-z0-9_-]{2,120}$/i);

export const videoProviderExecutionPolicySchema = z.object({
  provider: z.string().trim().min(1),
  enabled: z.boolean(),
  credentialRef: z.string().trim().min(1).nullable(),
  maximumConcurrentJobs: z.number().int().min(1).max(100),
  maximumAttempts: z.number().int().min(1).max(10),
  budgetLimitCents: z.number().int().positive(),
  budgetCommittedCents: z.number().int().min(0),
}).strict().superRefine((policy, context) => {
  if (policy.enabled && !policy.credentialRef) {
    context.addIssue({ code: "custom", path: ["credentialRef"], message: "启用视频提供商前必须配置私有凭据引用。" });
  }
  if (policy.budgetCommittedCents > policy.budgetLimitCents) {
    context.addIssue({ code: "custom", path: ["budgetCommittedCents"], message: "已承诺预算不能超过提供商预算上限。" });
  }
});
export type VideoProviderExecutionPolicy = z.infer<typeof videoProviderExecutionPolicySchema>;

export type VideoGenerationAdapterRequest = {
  provider: VideoProviderId;
  model: VideoModelCapability;
  prompt: string;
  aspectRatio: string;
  durationSeconds: number;
  resolution: string;
  credential: string;
};

export type VideoGenerationAdapterResult = {
  providerJobRef?: string;
  resultAssetRef: string;
};

/** The adapter never returns raw bytes or URLs; callers persist opaque private refs only. */
export interface VideoGenerationAdapter {
  provider: VideoProviderId;
  submit(request: VideoGenerationAdapterRequest): Promise<VideoGenerationAdapterResult>;
}

export type VideoExecutionRequest = {
  project: VideoProject;
  generation: z.infer<typeof videoGenerationRequestSchema>;
  expectedCostCents: number;
};

export type VideoExecutionDependencies = {
  catalog: readonly VideoModelCapability[];
  policies: readonly VideoProviderExecutionPolicy[];
  adapters: readonly VideoGenerationAdapter[];
  activeJobsByProvider: Readonly<Record<string, number>>;
  resolveCredential: (credentialRef: string) => Promise<string>;
};

function executionPrompt(project: VideoProject) {
  return project.scenes.map((scene) => scene.prompt).join("\n\n");
}

/**
 * Performs fail-closed validation before a provider call. This intentionally
 * owns no credentials and makes no decision to publish an asset.
 */
export async function submitVideoGeneration(
  request: VideoExecutionRequest,
  dependencies: VideoExecutionDependencies,
): Promise<VideoGenerationAdapterResult> {
  const project = videoProjectSchema.parse(request.project);
  if (project.status !== "ready_for_generation" && project.status !== "review_required" && project.status !== "approved") {
    throw new Error("视频创意尚未准备好生成。");
  }
  if (!Number.isSafeInteger(request.expectedCostCents) || request.expectedCostCents < 1) {
    throw new Error("视频生成必须提供正整数的预估成本。 ");
  }
  const model = selectVerifiedVideoModel(dependencies.catalog, request.generation);
  const policy = dependencies.policies.find((candidate) => candidate.provider === model.provider);
  if (!policy) throw new Error("视频提供商没有执行策略，已拒绝提交。");
  const parsedPolicy = videoProviderExecutionPolicySchema.parse(policy);
  if (!parsedPolicy.enabled || !parsedPolicy.credentialRef) throw new Error("视频提供商未启用或未配置凭据。 ");
  if ((dependencies.activeJobsByProvider[model.provider] ?? 0) >= parsedPolicy.maximumConcurrentJobs) {
    throw new Error("视频提供商并发配额已满。 ");
  }
  if (parsedPolicy.budgetCommittedCents + request.expectedCostCents > parsedPolicy.budgetLimitCents) {
    throw new Error("视频生成会超过提供商预算上限。 ");
  }
  const adapter = dependencies.adapters.find((candidate) => candidate.provider === model.provider);
  if (!adapter) throw new Error("视频提供商适配器未安装或未配置。 ");
  const credential = await dependencies.resolveCredential(parsedPolicy.credentialRef);
  if (!credential.trim()) throw new Error("视频提供商凭据不可用。 ");
  const result = await adapter.submit({
    provider: model.provider,
    model,
    prompt: executionPrompt(project),
    aspectRatio: request.generation.aspectRatio,
    durationSeconds: request.generation.durationSeconds,
    resolution: request.generation.resolution,
    credential,
  });
  return z.object({ providerJobRef: privateRef.optional(), resultAssetRef: privateRef }).parse(result);
}
