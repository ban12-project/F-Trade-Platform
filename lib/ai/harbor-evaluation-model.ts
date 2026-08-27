import type { ProductAgentModelConfig, SupportedModelProvider } from "./model-provider";

type HarborEnvironment = Record<string, string | undefined>;

const supportedProviders = new Set<SupportedModelProvider>([
  "openai",
  "anthropic",
  "google",
  "openai-compatible",
]);

function required(environment: HarborEnvironment, name: string) {
  const value = environment[name];
  if (!value) throw new Error(`Missing required ${name} for the selected Harbor provider`);
  return value;
}

/**
 * Creates an evaluation-only model configuration from the credentials injected
 * into a Harbor trial. Application runners must use saved configuration instead.
 */
export function getHarborEvaluationModelConfig(
  environment: HarborEnvironment = process.env,
): ProductAgentModelConfig {
  const modelId = required(environment, "HARBOR_MODEL");
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(modelId);
  if (!match || !supportedProviders.has(match[1] as SupportedModelProvider)) {
    throw new Error(
      "HARBOR_MODEL must use provider/model format with openai, anthropic, google, or openai-compatible",
    );
  }
  const provider = match[1] as SupportedModelProvider;
  const model = match[2];
  switch (provider) {
    case "openai":
      return { provider, model, providerOptions: { apiKey: required(environment, "HARBOR_OPENAI_API_KEY") } };
    case "anthropic":
      return { provider, model, providerOptions: { apiKey: required(environment, "HARBOR_ANTHROPIC_API_KEY") } };
    case "google":
      return {
        provider,
        model,
        providerOptions: { apiKey: required(environment, "HARBOR_GOOGLE_GENERATIVE_AI_API_KEY") },
      };
    case "openai-compatible":
      return {
        provider,
        model,
        providerOptions: {
          baseURL: required(environment, "HARBOR_OPENAI_COMPATIBLE_BASE_URL"),
          apiKey: required(environment, "HARBOR_OPENAI_COMPATIBLE_API_KEY"),
        },
      };
  }
}
