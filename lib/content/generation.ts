import type { LanguageModel } from "ai";
import { z } from "zod";
import {
  AiSdkStructuredGenerator,
  type StructuredGenerator,
  type VerifiedFact,
} from "@/lib/ai/structured-generator";

export const contentGenerationOutputSchema = z.object({
  hook: z.string().min(1).max(500),
  body: z.string().min(1).max(4_000),
  callToAction: z.string().min(1).max(500),
  hashtags: z.array(z.string().min(1)).max(12),
  visualInstruction: z.string().min(1).max(4_000),
});

export async function generateMarketingContent(
  input: {
    model: LanguageModel;
    contentType: "product" | "factory_capability" | "industry_knowledge";
    objective: string;
    targetCustomer: string;
    verifiedFacts: readonly VerifiedFact[];
    syntheticTest?: boolean;
  },
  generator: StructuredGenerator = new AiSdkStructuredGenerator(),
) {
  const draft = await generator.generate({
    model: input.model,
    schema: contentGenerationOutputSchema,
    schemaName: "content_marketing_draft",
    task: `Write an English ${input.contentType} B2B marketing draft. Objective: ${input.objective}. Target customer: ${input.targetCustomer}. Use only the supplied verified facts. Include any supplied vehicle_model or application value verbatim in the copy: preserve the complete string, punctuation and spacing; never split, expand, summarize or reinterpret a compressed list of model identifiers. Do not make claims about any absent engineering or commercial fact, including reliability or performance. Keep the body to 40-100 words of customer-facing copy, with no internal field names, evidence references, analysis, or missing-information checklists. Visual instruction must describe only abstract backgrounds, typography and text cards using affirmative descriptions. Do not describe a physical product or repeat technical prohibitions, even as negations. Visual instruction must not imply product geometry, dimensions, materials, or part count.${input.syntheticTest ? " This is an authorized MOCK simulation. Supplied facts may include synthetic supplements; they are not real factory verification. Keep an explicit MOCK test-only label in the draft. Do not imply real availability, factory approval or a real commercial offer." : ""}`,
    verifiedFacts: input.verifiedFacts,
  });
  assertGeneratedFitmentLiteral(draft, input.verifiedFacts);
  return draft;
}

/** A necessary literal check; it does not replace review of other prose claims. */
export function assertGeneratedFitmentLiteral(
  draft: z.infer<typeof contentGenerationOutputSchema>,
  facts: readonly VerifiedFact[],
) {
  const copy = [draft.hook, draft.body, draft.callToAction];
  for (const fact of facts) {
    if (!["product.vehicle_model", "product.application"].includes(fact.field)) continue;
    if (!copy.some((text) => text.includes(fact.value))) {
      throw new Error(`Generated content must preserve the complete ${fact.field} source value`);
    }
  }
}
