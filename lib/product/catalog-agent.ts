import type { ProductAgent, ProductAgentRequest } from "./agent";
import { EvidenceLocatedProductAgent } from "./evidence-located-agent";

export function isRejectedCatalogOutput(error: unknown) {
  return (
    error instanceof Error && /^(?:Product Agent |Contract validation failed:)/.test(error.message)
  );
}

export const PRODUCT_AGENT_TOTAL_TIMEOUT_MS = 75_000;

/** One corrective generation within the original total deadline; validators remain unchanged. */
export async function runCatalogProductAgent(
  request: ProductAgentRequest,
  agent: ProductAgent = new EvidenceLocatedProductAgent(),
  now: () => number = Date.now,
) {
  const deadline = now() + (request.timeout_ms ?? PRODUCT_AGENT_TOTAL_TIMEOUT_MS);
  try {
    return await agent.run({ ...request, timeout_ms: Math.max(1, deadline - now()) });
  } catch (error) {
    const remaining = deadline - now();
    if (!isRejectedCatalogOutput(error) || remaining < 1_000) throw error;
    return agent.run({ ...request, timeout_ms: remaining, repair_invalid_output: true });
  }
}
