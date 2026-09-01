import {
  asSchema,
  generateText,
  Output,
  type FlexibleSchema,
  type ImagePart,
  type LanguageModel,
  type TextPart,
} from "ai";

export interface VerifiedFact {
  field: string;
  value: string;
  evidenceRef: string;
}

export interface StructuredGenerationRequest<T> {
  model: LanguageModel;
  schema: FlexibleSchema<T>;
  schemaName: string;
  task: string;
  verifiedFacts: readonly VerifiedFact[];
  visualSamples?: readonly { label: string; data: Uint8Array; mediaType: string }[];
}

export interface StructuredGenerator {
  generate<T>(request: StructuredGenerationRequest<T>): Promise<T>;
}

const safetyInstruction = `You generate marketing language only.
Never invent or confirm engineering facts, OE numbers, vehicle fitment, dimensions,
spline data, materials, certifications, prices, MOQs, or delivery times.
Use only verifiedFacts exactly as supplied, preserve every evidenceRef, and put any
unknown fact into a missing-information field for human review.`;

function assertSchemaValidates<T>(schema: FlexibleSchema<T>) {
  const normalized = asSchema(schema);
  if (!normalized.validate) {
    throw new Error("Structured generation requires a runtime-validating schema");
  }
}

function assertVerifiedProductFacts(value: unknown, verifiedFacts: readonly VerifiedFact[]) {
  if (!value || typeof value !== "object" || !("product_facts" in value)) return;
  const productFacts = (value as { product_facts?: unknown }).product_facts;
  if (!Array.isArray(productFacts)) return;

  for (const fact of productFacts) {
    if (!fact || typeof fact !== "object") {
      throw new Error("Generated product facts must be structured objects");
    }
    const candidate = fact as Record<string, unknown>;
    const matched = verifiedFacts.some(
      (verified) =>
        candidate.field === verified.field &&
        candidate.value === verified.value &&
        candidate.evidence_ref === verified.evidenceRef,
    );
    if (!matched) {
      throw new Error("Generated product fact is not backed by supplied evidence");
    }
  }
}

export class AiSdkStructuredGenerator implements StructuredGenerator {
  async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    assertSchemaValidates(request.schema);
    const prompt = JSON.stringify({ task: request.task, verifiedFacts: request.verifiedFacts });
    const visualContent: Array<TextPart | ImagePart> | undefined = request.visualSamples?.length ? [
      { type: "text", text: prompt },
      ...request.visualSamples.flatMap((sample): Array<TextPart | ImagePart> => [
        { type: "text", text: `Authorized visual sample: ${sample.label}` },
        { type: "image", image: sample.data, mediaType: sample.mediaType },
      ]),
    ] : undefined;
    const result = await generateText({
      model: request.model,
      instructions: safetyInstruction,
      ...(visualContent ? { messages: [{ role: "user" as const, content: visualContent }] } : { prompt }),
      output: Output.object({
        schema: request.schema,
        name: request.schemaName,
      }),
    });
    assertVerifiedProductFacts(result.output, request.verifiedFacts);
    return result.output;
  }
}

export async function validateSyntheticOutput<T>(
  schema: FlexibleSchema<T>,
  output: unknown,
): Promise<T> {
  const normalized = asSchema(schema);
  if (!normalized.validate) {
    throw new Error("Synthetic output requires a runtime-validating schema");
  }
  const result = await normalized.validate(output);
  if (!result.success) throw result.error;
  return result.value;
}
