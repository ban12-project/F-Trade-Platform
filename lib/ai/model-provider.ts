import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type SupportedModelProvider = "openai" | "anthropic" | "google" | "openai-compatible";

export interface ParsedModelId {
  provider: SupportedModelProvider;
  model: string;
}

export function parseModelId(modelId: string): ParsedModelId {
  const match = /^(openai|anthropic|google|openai-compatible)\/([^/\s]+)$/.exec(modelId);
  if (!match) {
    throw new Error(
      "Model must use provider/model format with openai, anthropic, google, or openai-compatible",
    );
  }
  return { provider: match[1] as SupportedModelProvider, model: match[2] };
}

function requiredSecret(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required ${name} for the selected model provider`);
  return value;
}

export function createProductAgentModel(modelId: string): LanguageModel {
  const { provider, model } = parseModelId(modelId);
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey: requiredSecret("OPENAI_API_KEY") })(model);
    case "openai-compatible": {
      const baseURL = requiredSecret("F_TRADE_OPENAI_COMPATIBLE_BASE_URL");
      return createOpenAI({
        apiKey: requiredSecret("F_TRADE_OPENAI_COMPATIBLE_API_KEY"),
        baseURL,
      })(model);
    }
    case "anthropic":
      return createAnthropic({ apiKey: requiredSecret("ANTHROPIC_API_KEY") })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: requiredSecret("GOOGLE_GENERATIVE_AI_API_KEY") })(model);
  }
}
