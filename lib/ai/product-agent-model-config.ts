import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import {
  validateProductAgentModelConfig,
  type ProductAgentModelConfig,
  type SupportedModelProvider,
} from "./model-provider";
import { getDatabase } from "../db/client";
import { auditEvent, productAgentModelConfig } from "../db/schema";
import { decryptStoredSecret, encryptStoredSecret } from "../security/encrypted-secret";

const CONFIG_ID = "product_agent";

export interface ProductAgentModelSettings {
  provider: SupportedModelProvider;
  model: string;
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

export async function getStoredProductAgentModelSettings(): Promise<ProductAgentModelSettings | undefined> {
  const row = await getDatabase().query.productAgentModelConfig.findFirst({
    where: eq(productAgentModelConfig.id, CONFIG_ID),
  });
  if (!row) return undefined;
  return {
    provider: row.provider as SupportedModelProvider,
    model: row.model,
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

export async function getSavedProductAgentModelConfig(): Promise<ProductAgentModelConfig | undefined> {
  const row = await getDatabase().query.productAgentModelConfig.findFirst({
    where: eq(productAgentModelConfig.id, CONFIG_ID),
  });
  if (!row) return undefined;
  const apiKey = row.apiKeyCiphertext ? decryptStoredSecret(row.apiKeyCiphertext, "Stored Product Agent credential is invalid") : undefined;
  const authToken = row.authTokenCiphertext ? decryptStoredSecret(row.authTokenCiphertext, "Stored Product Agent credential is invalid") : undefined;
  return {
    provider: row.provider as SupportedModelProvider,
    model: row.model,
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

export async function resolveProductAgentModelConfig(): Promise<ProductAgentModelConfig> {
  const config = await getSavedProductAgentModelConfig();
  if (!config) throw new Error("No saved Product Agent provider configuration. Configure it in the console first.");
  return config;
}

export async function saveProductAgentModelSettings(input: SaveProductAgentModelSettingsInput) {
  const db = getDatabase();
  const existing = await db.query.productAgentModelConfig.findFirst({
    where: eq(productAgentModelConfig.id, CONFIG_ID),
  });
  const apiKeyCiphertext = input.clearApiKey
    ? null
    : input.apiKey
      ? encryptStoredSecret(input.apiKey)
      : existing?.apiKeyCiphertext ?? null;
  const authTokenCiphertext = input.clearAuthToken
    ? null
    : input.authToken
      ? encryptStoredSecret(input.authToken)
      : existing?.authTokenCiphertext ?? null;
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
    id: CONFIG_ID,
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
      subjectId: CONFIG_ID,
      metadata: {
        provider: input.provider,
        model: input.model,
        api_key_configured: Boolean(apiKeyCiphertext),
        auth_token_configured: Boolean(authTokenCiphertext),
      },
      occurredAt: new Date(),
    });
  });
}
