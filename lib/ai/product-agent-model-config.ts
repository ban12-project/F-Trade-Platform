import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { ProductAgentModelConfig, SupportedModelProvider } from "./model-provider";
import { getDatabase } from "../db/client";
import { auditEvent, productAgentModelConfig } from "../db/schema";

const CONFIG_ID = "product_agent";
const CIPHER_PREFIX = "v1";

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

function encryptionKey() {
  const encoded = process.env.MODEL_CONFIG_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error("MODEL_CONFIG_ENCRYPTION_KEY is required to store provider credentials");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("MODEL_CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [CIPHER_PREFIX, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}

function decrypt(value: string) {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (version !== CIPHER_PREFIX || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("Stored Product Agent credential is invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(encodedIv, "base64"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
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
  const apiKey = row.apiKeyCiphertext ? decrypt(row.apiKeyCiphertext) : undefined;
  const authToken = row.authTokenCiphertext ? decrypt(row.authTokenCiphertext) : undefined;
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
      ? encrypt(input.apiKey)
      : existing?.apiKeyCiphertext ?? null;
  const authTokenCiphertext = input.clearAuthToken
    ? null
    : input.authToken
      ? encrypt(input.authToken)
      : existing?.authTokenCiphertext ?? null;
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
