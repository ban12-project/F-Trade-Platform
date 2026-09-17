import { z } from "zod";

export type ProductIntakeStage =
  | "input"
  | "project_access"
  | "model_config"
  | "document"
  | "images"
  | "start_run"
  | "private_blob_read"
  | "catalog_intake";

const transportCodes = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Never include exception messages, source values, URLs, credentials or actor IDs. */
export function productIntakeFailureDiagnostic(stage: ProductIntakeStage, error: unknown) {
  if (error instanceof z.ZodError) return { stage, category: "validation" as const };
  let cause = error;
  for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
    if ("code" in cause && typeof cause.code === "string" && transportCodes.has(cause.code)) {
      return { stage, category: "transport" as const, code: cause.code };
    }
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return { stage, category: "unclassified" as const };
}

export function logProductIntakeFailure(stage: ProductIntakeStage, error: unknown) {
  console.warn("[product-intake-failure]", productIntakeFailureDiagnostic(stage, error));
}
