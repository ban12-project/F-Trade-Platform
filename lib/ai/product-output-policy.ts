import type { LanguageModel } from "ai";
import type { ProductAgentModelConfig } from "./model-provider";

export type ProductOutputMode = "json_schema" | "json" | "text";
export interface ProductOutputPolicy {
  mode: ProductOutputMode;
  reason: string;
  version: "1";
}
const policies = new WeakMap<object, ProductOutputPolicy>();
const modes = new Set(["json_schema", "json", "text"]);

export function resolveProductOutputPolicy(config: ProductAgentModelConfig): ProductOutputPolicy {
  if (config.outputMode !== undefined) {
    if (!modes.has(config.outputMode)) throw new Error("Unsupported Product Agent output mode");
    return { mode: config.outputMode, reason: "explicit_configuration", version: "1" };
  }
  const baseURL = (config.providerOptions as { baseURL?: string }).baseURL;
  const hostname = baseURL ? new URL(baseURL).hostname : undefined;
  if (config.provider !== "openai-compatible" && !baseURL) {
    return { mode: "json_schema", reason: "native_provider", version: "1" };
  }
  if (
    ["api.xiaomimimo.com", "token-plan-cn.xiaomimimo.com"].includes(hostname ?? "") &&
    [
      "mimo-v2.5",
      "mimo-v2.5-pro",
      "mimo-v2.6-pro",
      "mimo-v2.6-flash",
      "mimo-v2.6-pro-ultraspeed",
    ].includes(config.model)
  )
    return { mode: "json", reason: "mimo_documented_json_mode", version: "1" };
  if (["api.moonshot.cn", "api.moonshot.ai"].includes(hostname ?? "") && config.model === "kimi-k3")
    return { mode: "json_schema", reason: "kimi_k3_documented_schema", version: "1" };
  return { mode: "text", reason: "unverified_endpoint_capability", version: "1" };
}

export function registerProductOutputPolicy(model: LanguageModel, config: ProductAgentModelConfig) {
  if (typeof model === "object") policies.set(model, resolveProductOutputPolicy(config));
  return model;
}

export function getProductOutputPolicy(model: LanguageModel): ProductOutputPolicy {
  return (
    (typeof model === "object" ? policies.get(model) : undefined) ?? {
      mode: "text",
      reason: "unregistered_model",
      version: "1",
    }
  );
}
