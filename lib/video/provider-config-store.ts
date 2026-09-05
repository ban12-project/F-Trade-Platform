import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { type Database, getDatabase } from "@/lib/db/client";
import { auditEvent, videoModelConfig, videoProviderConfig } from "@/lib/db/schema";
import { decryptStoredSecret, encryptStoredSecret } from "@/lib/security/encrypted-secret";

import type { VideoProviderExecutionPolicy } from "./execution";
import {
  type VideoModelCapability,
  type VideoProviderId,
  videoModelCapabilitySchema,
  videoProviderIdSchema,
} from "./provider-capabilities";

const credentialRefPrefix = "video-provider:";
const configInteger = z.number().int().min(1).max(100);
const budgetCents = z.number().int().min(1).max(100_000_000);

export const saveVideoProviderModelSettingsSchema = z
  .object({
    provider: videoProviderIdSchema,
    providerEnabled: z.boolean(),
    credential: z.string().trim().max(8_000).optional(),
    clearCredential: z.boolean(),
    maximumConcurrentJobs: configInteger,
    maximumAttempts: configInteger.max(10),
    budgetLimitCents: budgetCents,
    budgetCommittedCents: z.number().int().min(0).max(100_000_000),
    runtimeSettings: z
      .record(z.string().trim().min(1).max(120), z.string().trim().max(2_000))
      .default({}),
    model: videoModelCapabilitySchema,
    actorId: z.string().trim().min(1).max(240),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.model.provider !== input.provider) {
      context.addIssue({
        code: "custom",
        path: ["model", "provider"],
        message: "模型必须属于当前视频提供商。",
      });
    }
    if (input.budgetCommittedCents > input.budgetLimitCents) {
      context.addIssue({
        code: "custom",
        path: ["budgetCommittedCents"],
        message: "已承诺预算不能超过上限。",
      });
    }
  });
export type SaveVideoProviderModelSettingsInput = z.infer<
  typeof saveVideoProviderModelSettingsSchema
>;

export type VideoProviderSettingsSummary = {
  provider: VideoProviderId;
  enabled: boolean;
  credentialConfigured: boolean;
  maximumConcurrentJobs: number;
  maximumAttempts: number;
  budgetLimitCents: number;
  budgetCommittedCents: number;
  runtimeSettings: Record<string, string>;
  models: VideoModelCapability[];
};

function providerCredentialRef(provider: VideoProviderId) {
  return `${credentialRefPrefix}${provider}`;
}

function providerFromCredentialRef(value: string): VideoProviderId | undefined {
  if (!value.startsWith(credentialRefPrefix)) return undefined;
  const parsed = videoProviderIdSchema.safeParse(value.slice(credentialRefPrefix.length));
  return parsed.success ? parsed.data : undefined;
}

function modelConfigId(provider: VideoProviderId, modelId: string) {
  return `${provider}:${modelId}`;
}

function mapModel(row: typeof videoModelConfig.$inferSelect): VideoModelCapability {
  return videoModelCapabilitySchema.parse({
    provider: row.provider,
    modelId: row.modelId,
    capabilities: row.capabilities,
    aspectRatios: row.aspectRatios,
    durationSeconds: { min: row.durationMinimumSeconds, max: row.durationMaximumSeconds },
    resolutions: row.resolutions,
    verifiedAt: row.verifiedAt,
    verificationRef: row.verificationRef,
    enabled: row.enabled,
  });
}

/** Returns safe summaries only; neither ciphertext nor plaintext credentials leave this module. */
export async function listVideoProviderSettings(
  database: Database = getDatabase(),
): Promise<VideoProviderSettingsSummary[]> {
  const [providers, models] = await Promise.all([
    database.select().from(videoProviderConfig),
    database.select().from(videoModelConfig),
  ]);
  return providers.map((provider) => ({
    provider: videoProviderIdSchema.parse(provider.provider),
    enabled: provider.enabled,
    credentialConfigured: Boolean(provider.credentialCiphertext),
    maximumConcurrentJobs: provider.maximumConcurrentJobs,
    maximumAttempts: provider.maximumAttempts,
    budgetLimitCents: provider.budgetLimitCents,
    budgetCommittedCents: provider.budgetCommittedCents,
    runtimeSettings: provider.runtimeSettings,
    models: models.filter((model) => model.provider === provider.provider).map(mapModel),
  }));
}

/**
 * Reads only enabled, verified models and policies for a worker. Credentials
 * remain behind resolveVideoProviderCredential and are never put in this result.
 */
export async function loadVideoExecutionConfiguration(database: Database = getDatabase()): Promise<{
  catalog: VideoModelCapability[];
  policies: VideoProviderExecutionPolicy[];
}> {
  const [providers, models] = await Promise.all([
    database.select().from(videoProviderConfig).where(eq(videoProviderConfig.enabled, true)),
    database.select().from(videoModelConfig).where(eq(videoModelConfig.enabled, true)),
  ]);
  const enabledProviders = new Set(providers.map((provider) => provider.provider));
  return {
    catalog: models.filter((model) => enabledProviders.has(model.provider)).map(mapModel),
    policies: providers.map((provider) => ({
      provider: videoProviderIdSchema.parse(provider.provider),
      enabled: provider.enabled,
      credentialRef: provider.credentialCiphertext
        ? providerCredentialRef(videoProviderIdSchema.parse(provider.provider))
        : null,
      maximumConcurrentJobs: provider.maximumConcurrentJobs,
      maximumAttempts: provider.maximumAttempts,
      budgetLimitCents: provider.budgetLimitCents,
      budgetCommittedCents: provider.budgetCommittedCents,
    })),
  };
}

/** Fails closed for absent, disabled, or malformed credentials. */
export async function resolveVideoProviderCredential(
  credentialRef: string,
  database: Database = getDatabase(),
): Promise<string> {
  const provider = providerFromCredentialRef(credentialRef);
  if (!provider) throw new Error("视频提供商凭据引用无效。");
  const [row] = await database
    .select()
    .from(videoProviderConfig)
    .where(and(eq(videoProviderConfig.provider, provider), eq(videoProviderConfig.enabled, true)));
  if (!row?.credentialCiphertext) throw new Error("视频提供商未启用或未配置凭据。");
  return decryptStoredSecret(
    row.credentialCiphertext,
    "Stored video provider credential is invalid",
  );
}

/** Saves one provider and one human-verified model atomically; the secret is never returned or audited. */
export async function saveVideoProviderModelSettings(
  input: SaveVideoProviderModelSettingsInput,
  database: Database = getDatabase(),
): Promise<VideoProviderSettingsSummary> {
  const parsed = saveVideoProviderModelSettingsSchema.parse(input);
  const existing = await database.query.videoProviderConfig.findFirst({
    where: eq(videoProviderConfig.provider, parsed.provider),
  });
  const credentialCiphertext = parsed.clearCredential
    ? null
    : parsed.credential
      ? encryptStoredSecret(parsed.credential)
      : (existing?.credentialCiphertext ?? null);
  if (parsed.providerEnabled && !credentialCiphertext) {
    throw new Error("启用视频提供商前必须配置加密凭据。");
  }
  const model = videoModelCapabilitySchema.parse(parsed.model);
  const providerValues = {
    provider: parsed.provider,
    enabled: parsed.providerEnabled,
    credentialCiphertext,
    maximumConcurrentJobs: parsed.maximumConcurrentJobs,
    maximumAttempts: parsed.maximumAttempts,
    budgetLimitCents: parsed.budgetLimitCents,
    budgetCommittedCents: parsed.budgetCommittedCents,
    runtimeSettings: parsed.runtimeSettings,
    updatedBy: parsed.actorId,
  };
  const modelValues = {
    id: modelConfigId(parsed.provider, model.modelId),
    provider: parsed.provider,
    modelId: model.modelId,
    capabilities: model.capabilities,
    aspectRatios: model.aspectRatios,
    durationMinimumSeconds: model.durationSeconds.min,
    durationMaximumSeconds: model.durationSeconds.max,
    resolutions: model.resolutions,
    verifiedAt: model.verifiedAt,
    verificationRef: model.verificationRef,
    enabled: model.enabled,
    updatedBy: parsed.actorId,
  };
  await database.transaction(async (tx) => {
    await tx.insert(videoProviderConfig).values(providerValues).onConflictDoUpdate({
      target: videoProviderConfig.provider,
      set: providerValues,
    });
    await tx
      .insert(videoModelConfig)
      .values(modelValues)
      .onConflictDoUpdate({
        target: [videoModelConfig.provider, videoModelConfig.modelId],
        set: modelValues,
      });
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "video_provider_model_config_updated",
      actorType: "human",
      actorId: parsed.actorId,
      subjectType: "video_provider_model_config",
      subjectId: modelValues.id,
      metadata: {
        provider: parsed.provider,
        provider_enabled: parsed.providerEnabled,
        credential_configured: Boolean(credentialCiphertext),
        model_id: model.modelId,
        model_enabled: model.enabled,
        verified_at: model.verifiedAt?.toISOString() ?? null,
        verification_ref: model.verificationRef,
      },
      occurredAt: new Date(),
    });
  });
  return {
    provider: parsed.provider,
    enabled: parsed.providerEnabled,
    credentialConfigured: Boolean(credentialCiphertext),
    maximumConcurrentJobs: parsed.maximumConcurrentJobs,
    maximumAttempts: parsed.maximumAttempts,
    budgetLimitCents: parsed.budgetLimitCents,
    budgetCommittedCents: parsed.budgetCommittedCents,
    runtimeSettings: parsed.runtimeSettings,
    models: [model],
  };
}
