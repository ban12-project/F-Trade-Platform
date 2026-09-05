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
  return generator.generate({
    model: input.model,
    schema: contentGenerationOutputSchema,
    schemaName: "content_marketing_draft",
    task: `Write an English ${input.contentType} B2B marketing draft. Objective: ${input.objective}. Target customer: ${input.targetCustomer}. Use only the supplied verified facts. Do not make claims about any absent engineering or commercial fact, including reliability or performance. Keep the body to 40-100 words of customer-facing copy, with no internal field names, evidence references, analysis, or missing-information checklists. Visual instruction must describe only abstract backgrounds, typography and text cards using affirmative descriptions. Do not describe a physical product or repeat technical prohibitions, even as negations. Visual instruction must not imply product geometry, dimensions, materials, or part count.${input.syntheticTest ? " This is an authorized MOCK simulation. Supplied facts may include synthetic supplements; they are not real factory verification. Keep an explicit MOCK test-only label in the draft. Do not imply real availability, factory approval or a real commercial offer." : ""}`,
    verifiedFacts: input.verifiedFacts,
  });
}
