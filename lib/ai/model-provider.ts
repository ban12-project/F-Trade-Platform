import { type AnthropicProviderSettings, createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI, type GoogleGenerativeAIProviderSettings } from "@ai-sdk/google";
import { createOpenAI, type OpenAIProviderSettings } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type SupportedModelProvider = "openai" | "anthropic" | "google" | "openai-compatible";

type ConfigurableProviderSettings =
  | OpenAIProviderSettings
  | AnthropicProviderSettings
  | GoogleGenerativeAIProviderSettings;

/** A Product Agent model is always constructed from a saved provider configuration. */
export interface ProductAgentModelConfig {
  provider: SupportedModelProvider;
  model: string;
  providerOptions: ConfigurableProviderSettings;
}

function hasAuthenticationHeader(headers: Record<string, string | undefined> | undefined) {
  return Object.keys(headers ?? {}).some((header) =>
    /^(authorization|x-api-key|api-key|x-goog-api-key)$/i.test(header),
  );
}

export function validateProductAgentModelConfig(config: ProductAgentModelConfig) {
  const options = config.providerOptions as {
    apiKey?: string;
    authToken?: string;
    baseURL?: string;
    headers?: Record<string, string | undefined>;
  };
  if (config.provider === "openai-compatible" && !options.baseURL) {
    throw new Error("Saved OpenAI-compatible provider requires a Base URL");
  }
  if (config.provider === "anthropic") {
    if (!options.apiKey && !options.authToken && !hasAuthenticationHeader(options.headers)) {
      throw new Error("Saved Anthropic provider requires an API key or Auth token");
    }
    return;
  }
  if (!options.apiKey && !hasAuthenticationHeader(options.headers)) {
    throw new Error(`Saved ${config.provider} provider requires an API key`);
  }
}

export function createProductAgentModel(config: ProductAgentModelConfig): LanguageModel {
  validateProductAgentModelConfig(config);
  switch (config.provider) {
    case "openai":
    case "openai-compatible":
      return createOpenAI(config.providerOptions as OpenAIProviderSettings)(config.model);
    case "anthropic":
      return createAnthropic(config.providerOptions as AnthropicProviderSettings)(config.model);
    case "google":
      return createGoogleGenerativeAI(config.providerOptions as GoogleGenerativeAIProviderSettings)(
        config.model,
      );
  }
}
