import {
  AiSdkProductAgent,
  finalizeProductAgentDraft,
  type ProductAgent,
  type ProductAgentRequest,
  type ProductAgentResult,
} from "./agent";
import {
  assertProductAgentEvidenceLocations,
  compactProductAgentEvidenceRefs,
  prepareProductAgentEvidenceSource,
} from "./evidence-locations";

/**
 * Production Product Agent wrapper. It replaces whole-document evidence with
 * deterministic labelled excerpts before model invocation, validates every
 * selected excerpt independently, then persists only the locations actually
 * used by populated facts.
 */
export class EvidenceLocatedProductAgent implements ProductAgent {
  constructor(private readonly delegate: ProductAgent = new AiSdkProductAgent()) {}

  async run(request: ProductAgentRequest): Promise<ProductAgentResult> {
    const source = prepareProductAgentEvidenceSource(request.source);
    const result = await this.delegate.run({ ...request, source });
    assertProductAgentEvidenceLocations(result.draft, source, finalizeProductAgentDraft);
    return {
      ...result,
      draft: compactProductAgentEvidenceRefs(result.draft),
    };
  }
}
