import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { getDatabase } from "../db/client";
import { auditEvent, productAgentModelConfig } from "../db/schema";
import { decryptStoredSecret, encryptStoredSecret } from "../security/encrypted-secret";
import {
  type ProductAgentModelConfig,
  type SupportedModelProvider,
  validateProductAgentModelConfig,
} from "./model-provider";

export interface ProductAgentModelSettings {
  id: string;
  name: string;
  isDefault: boolean;
  provider: SupportedModelProvider;
  model: string;
  discoveredModels: string[];
  baseUrl: string;
  headersJson: string;
  providerName: string;
  organization: string;
  project: string;
  apiKeyConfigured: boolean;
  authTokenConfigured: boolean;
  source: "database" | "unconfigured";
}

export interface SaveProductAgentModelSettingsInput {
  configId?: string;
  name: string;
  isDefault: boolean;
  provider: SupportedModelProvider;
  model: string;
  baseUrl: string;
  headers: Record<string, string>;
  providerName: string;
  organization: string;
  project: string;
  apiKey?: string;
  authToken?: string;
  clearApiKey: boolean;
  clearAuthToken: boolean;
  actorId: string;
}

function optional(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function mapStoredSettings(
  row: typeof productAgentModelConfig.$inferSelect,
): ProductAgentModelSettings {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    provider: row.provider as SupportedModelProvider,
    model: row.model,
    discoveredModels: row.discoveredModels,
    baseUrl: row.baseUrl ?? "",
    headersJson: JSON.stringify(row.headers, null, 2),
    providerName: row.providerName ?? "",
    organization: row.organization ?? "",
    project: row.project ?? "",
    apiKeyConfigured: Boolean(row.apiKeyCiphertext),
    authTokenConfigured: Boolean(row.authTokenCiphertext),
    source: "database",
  };
}

export function productAgentModelOptionLabel(
  settings: Pick<ProductAgentModelSettings, "name" | "provider">,
) {
  return `${settings.name} · ${settings.provider}`;
}

export async function listStoredProductAgentModelSettings(): Promise<ProductAgentModelSettings[]> {
  const rows = await getDatabase().query.productAgentModelConfig.findMany({
    orderBy: [asc(productAgentModelConfig.name)],
  });
  return rows.map(mapStoredSettings);
}

/** Compatibility helper for unattended workflows that use the default model. */
export async function getStoredProductAgentModelSettings(): Promise<
  ProductAgentModelSettings | undefined
> {
  const row = await getDatabase().query.productAgentModelConfig.findFirst({
    where: eq(productAgentModelConfig.isDefault, true),
  });
  return row ? mapStoredSettings(row) : undefined;
}

export async function getSavedProductAgentModelConfig(
  configId?: string,
  selectedModel?: string,
): Promise<ProductAgentModelConfig | undefined> {
  const row = await getDatabase().query.productAgentModelConfig.findFirst({
    where: configId
      ? eq(productAgentModelConfig.id, configId)
      : eq(productAgentModelConfig.isDefault, true),
  });
  if (!row) return undefined;
  const allowedModels = new Set(
    [row.model, ...row.discoveredModels].map((model) => model.trim()).filter(Boolean),
  );
  const model = selectedModel?.trim() || row.model;
  if (!allowedModels.has(model)) throw new Error("所选模型不属于该配置，请重新选择。");
  const apiKey = row.apiKeyCiphertext
    ? decryptStoredSecret(row.apiKeyCiphertext, "Stored Product Agent credential is invalid")
    : undefined;
  const authToken = row.authTokenCiphertext
    ? decryptStoredSecret(row.authTokenCiphertext, "Stored Product Agent credential is invalid")
    : undefined;
  return {
    provider: row.provider as SupportedModelProvider,
    model,
    providerOptions: {
      baseURL: row.baseUrl ?? undefined,
      headers: row.headers,
      name: row.providerName ?? undefined,
      organization: row.organization ?? undefined,
      project: row.project ?? undefined,
      apiKey,
      authToken,
    },
  };
}

export async function resolveProductAgentModelConfig(
  configId?: string,
  selectedModel?: string,
): Promise<ProductAgentModelConfig> {
  const config = await getSavedProductAgentModelConfig(configId, selectedModel);
  if (!config) {
    throw new Error(
      configId
        ? "所选 Product Agent 模型配置不存在，请重新选择。"
        : "没有默认 Product Agent 模型配置，请先在工作区设置中配置。",
    );
  }
  return config;
}

export async function saveProductAgentModelSettings(input: SaveProductAgentModelSettingsInput) {
  const db = getDatabase();
  const [existing, defaultConfig, duplicateName] = await Promise.all([
    input.configId
      ? db.query.productAgentModelConfig.findFirst({
          where: eq(productAgentModelConfig.id, input.configId),
        })
      : undefined,
    db.query.productAgentModelConfig.findFirst({
      where: eq(productAgentModelConfig.isDefault, true),
    }),
    db.query.productAgentModelConfig.findFirst({
      where: eq(productAgentModelConfig.name, input.name.trim()),
    }),
  ]);
  if (input.configId && !existing) throw new Error("要编辑的模型配置不存在，请刷新后重试。");
  if (duplicateName && duplicateName.id !== existing?.id)
    throw new Error("配置名称已存在，请换一个名称。");
  const configId = existing?.id ?? randomUUID();
  const isDefault = input.isDefault || existing?.isDefault || !defaultConfig;
  const apiKeyCiphertext = input.clearApiKey
    ? null
    : input.apiKey
      ? encryptStoredSecret(input.apiKey)
      : (existing?.apiKeyCiphertext ?? null);
  const authTokenCiphertext = input.clearAuthToken
    ? null
    : input.authToken
      ? encryptStoredSecret(input.authToken)
      : (existing?.authTokenCiphertext ?? null);
  validateProductAgentModelConfig({
    provider: input.provider,
    model: input.model,
    providerOptions: {
      baseURL: optional(input.baseUrl),
      headers: input.headers,
      name: optional(input.providerName),
      organization: optional(input.organization),
      project: optional(input.project),
      // Configuration validation only needs to establish that a non-empty encrypted
      // credential exists; it must not decrypt or return that credential while saving.
      apiKey: apiKeyCiphertext ? "configured" : undefined,
      authToken: authTokenCiphertext ? "configured" : undefined,
    },
  });
  const values = {
    id: configId,
    name: input.name.trim(),
    isDefault,
    provider: input.provider,
    model: input.model,
    baseUrl: optional(input.baseUrl),
    headers: input.headers,
    providerName: optional(input.providerName),
    organization: optional(input.organization),
    project: optional(input.project),
    apiKeyCiphertext,
    authTokenCiphertext,
    updatedBy: input.actorId,
  };
  await db.transaction(async (tx) => {
    if (isDefault) {
      await tx.update(productAgentModelConfig).set({ isDefault: false });
    }
    await tx
      .insert(productAgentModelConfig)
      .values(values)
      .onConflictDoUpdate({ target: productAgentModelConfig.id, set: values });
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "product_agent_model_config_updated",
      actorType: "human",
      actorId: input.actorId,
      subjectType: "product_agent_model_config",
      subjectId: configId,
      metadata: {
        name: values.name,
        is_default: isDefault,
        provider: input.provider,
        model: input.model,
        api_key_configured: Boolean(apiKeyCiphertext),
        auth_token_configured: Boolean(authTokenCiphertext),
      },
      occurredAt: new Date(),
    });
  });
  return configId;
}
