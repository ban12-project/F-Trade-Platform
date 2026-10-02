import { getProductOutputPolicy } from "../ai/product-output-policy";
import type {
  ProductAgent,
  ProductAgentRequest,
  ProductAgentResult,
  ProductModelObservation,
} from "./agent";
import { PRODUCT_AGENT_TOTAL_TIMEOUT_MS, runCatalogProductAgent } from "./catalog-agent";
import { EvidenceLocatedProductAgent } from "./evidence-located-agent";
import { PRODUCT_AGENT_PROMPT_HASH, PRODUCT_AGENT_PROMPT_VERSION } from "./product-agent-prompt";

export type EvaluationFailure = "contract_or_source" | "timeout" | "provider" | "runtime";
export function classifyEvaluationFailure(error: unknown): EvaluationFailure {
  if (error instanceof Error && /^(Product Agent |Contract validation failed:)/.test(error.message))
    return "contract_or_source";
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
    return "timeout";
  if (error && typeof error === "object" && ("statusCode" in error || "responseBody" in error))
    return "provider";
  return "runtime";
}
export interface EvaluationAttempt {
  number: number;
  correction: boolean;
  duration_ms: number;
  outcome: "accepted" | EvaluationFailure;
  responses: ProductModelObservation[];
  draft?: ProductAgentResult["draft"];
  /** Private diagnostic only: selection report writers must not copy this field. */
  error?: string;
}

/** The same production catalog policy is used here, including its shared total deadline.
 * Raw diagnostics are opt-in evaluation artifacts, never persisted by the production workflow.
 */
export async function runProductAgentEvaluation(
  request: Pick<ProductAgentRequest, "model" | "source">,
  agent: ProductAgent = new EvidenceLocatedProductAgent(),
) {
  const attempts: EvaluationAttempt[] = [];
  const started = Date.now();
  let result: ProductAgentResult | undefined;
  let failure: EvaluationFailure | undefined;
  try {
    result = await runCatalogProductAgent(
      { ...request, timeout_ms: PRODUCT_AGENT_TOTAL_TIMEOUT_MS },
      {
        async run(input) {
          const responses: ProductModelObservation[] = [];
          const attempt: EvaluationAttempt = {
            number: attempts.length + 1,
            correction: input.repair_invalid_output === true,
            duration_ms: 0,
            outcome: "runtime",
            responses,
          };
          attempts.push(attempt);
          const start = Date.now();
          try {
            const output = await agent.run({
              ...input,
              observe_model_response: (response) => responses.push(response),
            });
            attempt.outcome = "accepted";
            attempt.draft = output.draft;
            return output;
          } catch (error) {
            attempt.outcome = classifyEvaluationFailure(error);
            attempt.error = error instanceof Error ? error.message : "Unknown evaluation failure";
            throw error;
          } finally {
            attempt.duration_ms = Date.now() - start;
          }
        },
      },
    );
  } catch (error) {
    failure = classifyEvaluationFailure(error);
  }
  return {
    draft: result?.draft ?? null,
    _evaluation: {
      prompt_version: PRODUCT_AGENT_PROMPT_VERSION,
      prompt_hash: PRODUCT_AGENT_PROMPT_HASH,
      evidence_mode: "bounded_location",
      protocol_version: "model-selection-v2",
      execution_policy: "production-catalog",
      total_timeout_ms: PRODUCT_AGENT_TOTAL_TIMEOUT_MS,
      max_corrections: 1,
      output_policy: getProductOutputPolicy(request.model),
      duration_ms: Date.now() - started,
      attempt_count: attempts.length,
      first_attempt_accepted: attempts[0]?.outcome === "accepted",
      final_accepted: result !== undefined,
      failure: failure ?? null,
    },
    _diagnostics: { attempts },
  };
}
