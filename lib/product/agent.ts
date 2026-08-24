import { generateText, Output, type LanguageModel } from "ai";

import productDraftSchema from "../../contracts/data/product-draft.schema.json";
import { compileContract } from "../contracts/validator";
import { reviewProductDraft, type ProductDraft } from "./verification";
import {
  PRODUCT_AGENT_PROMPT_HASH,
  PRODUCT_AGENT_PROMPT_VERSION,
  PRODUCT_AGENT_SYSTEM_PROMPT,
} from "./product-agent-prompt";

export interface ProductAgentSource {
  record_id: string;
  source_ref: string;
  evidence_refs: string[];
  source_text: string;
  image_availability: "real_product_image" | "none";
  image_refs: string[];
  /** Trusted caller-supplied selection key; never evidence for a product fact. */
  candidate_identifier?: string;
}

export interface ProductAgentRequest {
  model: LanguageModel;
  source: ProductAgentSource;
  timeout_ms?: number;
}

export interface ProductAgentRunMetadata {
  prompt_version: string;
  prompt_hash: string;
}

export interface ProductAgentResult {
  draft: ProductDraft;
  metadata: ProductAgentRunMetadata;
}

export interface ProductAgent {
  run(request: ProductAgentRequest): Promise<ProductAgentResult>;
}

const parseProductDraft = compileContract<ProductDraft>(productDraftSchema);

function removeNullOptionalFacts(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const draft = structuredClone(value) as Record<string, unknown>;
  const fieldEvidence = draft.field_evidence;
  for (const section of ["product", "specifications", "commercial"] as const) {
    const fields = draft[section];
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) continue;
    for (const [field, fieldValue] of Object.entries(fields)) {
      if (fieldValue !== null) continue;
      delete (fields as Record<string, unknown>)[field];
      if (fieldEvidence && typeof fieldEvidence === "object" && !Array.isArray(fieldEvidence)) {
        delete (fieldEvidence as Record<string, unknown>)[`${section}.${field}`];
      }
    }
  }
  return draft;
}

function parseModelJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Product Agent model response must be a single JSON object");
  }
}

function normalizeOeNumber(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function extractExplicitOeNumbers(sourceText: string) {
  const values = new Set<string>();
  const labelledOeLine =
    /\b(?:(?:OEM|OE)\s*NO\.?\s*(?:[:：]\s*|\s+)|(?:OEM|OE)\s*[:：]\s*)([^\r\n]+)/gi;
  for (const match of sourceText.matchAll(labelledOeLine)) {
    for (const value of match[1]!.split(/[,;|，、]|\t|\s{2,}/)) {
      const normalized = normalizeOeNumber(value.replace(/^[\s([{"']+|[\s)\]}"'.]+$/g, ""));
      if (normalized) values.add(normalized);
    }
  }
  return values;
}

function assertSafeDraft(draft: ProductDraft, source: ProductAgentSource) {
  if (draft.record_id !== source.record_id || draft.source_ref !== source.source_ref) {
    throw new Error("Product Agent output must preserve the supplied record and source references");
  }
  if (draft.verification_status !== "review_required") {
    throw new Error("Product Agent may only create review_required product drafts");
  }
  const oeNumbers = draft.product.oe_numbers;
  if (Array.isArray(oeNumbers) && oeNumbers.length > 0) {
    const sourcedOeNumbers = extractExplicitOeNumbers(source.source_text);
    if (oeNumbers.some((oeNumber) => !sourcedOeNumbers.has(normalizeOeNumber(oeNumber)))) {
      throw new Error(
        "Product Agent may populate only OE numbers explicitly listed under an OE or OEM No. source label",
      );
    }
  }
  const internalSku = draft.product.internal_sku;
  if (
    source.candidate_identifier &&
    internalSku !== undefined &&
    internalSku !== source.candidate_identifier
  ) {
    throw new Error("Product Agent output internal_sku must match the selected catalog candidate");
  }
  const allowedEvidence = new Set(source.evidence_refs);
  if (
    draft.evidence_refs.length !== allowedEvidence.size ||
    draft.evidence_refs.some((evidenceRef) => !allowedEvidence.has(evidenceRef))
  ) {
    throw new Error("Product Agent output must preserve exactly the supplied evidence references");
  }
  const populatedFields = new Set(
    (["product", "specifications", "commercial"] as const).flatMap((section) =>
      Object.keys(draft[section] ?? {}).map((field) => `${section}.${field}`),
    ),
  );
  if (
    Object.keys(draft.field_evidence).length !== populatedFields.size ||
    Object.keys(draft.field_evidence).some((field) => !populatedFields.has(field))
  ) {
    throw new Error("Product Agent must provide evidence for exactly its populated facts");
  }
  for (const [field, evidenceRef] of Object.entries(draft.field_evidence)) {
    if (!allowedEvidence.has(evidenceRef) || !draft.evidence_refs.includes(evidenceRef)) {
      throw new Error(`Product Agent field ${field} is not backed by supplied evidence`);
    }
  }
}

export function finalizeProductAgentDraft(value: unknown, source: ProductAgentSource): ProductDraft {
  const draft = parseProductDraft(removeNullOptionalFacts(value));
  assertSafeDraft(draft, source);
  return reviewProductDraft(draft);
}

export class AiSdkProductAgent implements ProductAgent {
  async run({ model, source, timeout_ms }: ProductAgentRequest): Promise<ProductAgentResult> {
    const result = await generateText({
      model,
      instructions: PRODUCT_AGENT_SYSTEM_PROMPT,
      prompt: JSON.stringify({
        record_id: source.record_id,
        source_ref: source.source_ref,
        evidence_refs: source.evidence_refs,
        image_availability: source.image_availability,
        image_refs: source.image_refs,
        candidate_identifier: source.candidate_identifier,
        source_text: `<untrusted-source-text>\n${source.source_text}\n</untrusted-source-text>`,
      }),
      // Some OpenAI-compatible routers reject standard JSON Schema keywords that the
      // ProductDraft contract needs. We request JSON text and validate it locally with AJV.
      output: Output.text(),
      abortSignal: timeout_ms === undefined ? undefined : AbortSignal.timeout(timeout_ms),
    });

    const draft = finalizeProductAgentDraft(parseModelJson(result.output), source);
    return {
      draft,
      metadata: {
        prompt_version: PRODUCT_AGENT_PROMPT_VERSION,
        prompt_hash: PRODUCT_AGENT_PROMPT_HASH,
      },
    };
  }
}

export function validateProductAgentSource(value: unknown): ProductAgentSource {
  if (!value || typeof value !== "object") throw new Error("Product Agent source must be an object");
  const source = value as Partial<ProductAgentSource>;
  if (
    !source.record_id ||
    !source.source_ref ||
    !Array.isArray(source.evidence_refs) ||
    source.evidence_refs.length === 0 ||
    typeof source.source_text !== "string" ||
    (source.image_availability !== "real_product_image" && source.image_availability !== "none") ||
    !Array.isArray(source.image_refs)
  ) {
    throw new Error("Product Agent source is incomplete or invalid");
  }
  if (source.image_availability === "none" && source.image_refs.length > 0) {
    throw new Error("No-image Product Agent source cannot include image references");
  }
  if (source.image_availability === "real_product_image" && source.image_refs.length === 0) {
    throw new Error("Image-backed Product Agent source must include a real image reference");
  }
  if (
    source.candidate_identifier !== undefined &&
    (typeof source.candidate_identifier !== "string" || !source.candidate_identifier.trim())
  ) {
    throw new Error("Product Agent candidate identifier is invalid");
  }
  return source as ProductAgentSource;
}
