import { generateText, type LanguageModel, Output, type UserModelMessage } from "ai";

import productDraftSchema from "../../contracts/data/product-draft.schema.json";
import { compileContract } from "../contracts/validator";
import {
  PRODUCT_AGENT_PROMPT_HASH,
  PRODUCT_AGENT_PROMPT_VERSION,
  PRODUCT_AGENT_SYSTEM_PROMPT,
} from "./product-agent-prompt";
import { type ProductDraft, reviewProductDraft } from "./verification";

export interface ProductAgentSource {
  record_id: string;
  source_ref: string;
  evidence_refs: string[];
  source_text: string;
  image_availability: "real_product_image" | "none";
  image_refs: string[];
  image_inputs?: ProductAgentImageInput[];
  /** Trusted caller-supplied selection key; never evidence for a product fact. */
  candidate_identifier?: string;
}

export interface ProductAgentImageInput {
  ref: string;
  media_type: "image/png" | "image/jpeg";
  data_base64: string;
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

function normalizeSourceValue(value: string) {
  return value
    .trim()
    .replace(/[.|]+$/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

function parseMarkdownRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return undefined;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

export function parseMarkdownTables(sourceText: string): MarkdownTable[] {
  const lines = sourceText.split(/\r?\n/);
  const tables: MarkdownTable[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headers = parseMarkdownRow(lines[index]!);
    const separator = parseMarkdownRow(lines[index + 1]!);
    if (
      !headers ||
      !separator ||
      headers.length !== separator.length ||
      !separator.every((cell) => /^:?-{3,}:?$/.test(cell))
    ) {
      continue;
    }
    const rows: string[][] = [];
    index += 2;
    while (index < lines.length) {
      const row = parseMarkdownRow(lines[index]!);
      if (!row || row.length !== headers.length) break;
      rows.push(row);
      index += 1;
    }
    index -= 1;
    tables.push({ headers, rows });
  }
  return tables;
}

function extractLabelledValues(sourceText: string, labels: string[]) {
  const values: string[] = [];
  const normalizedLabels = new Set(labels.map(normalizeSourceValue));
  for (const table of parseMarkdownTables(sourceText)) {
    table.headers.forEach((header, column) => {
      if (!normalizedLabels.has(normalizeSourceValue(header))) return;
      for (const row of table.rows) {
        const value = row[column]?.trim();
        if (value) values.push(value);
      }
    });
  }
  for (const label of labels) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\|\\s*)?${escapedLabel}\\s*(?:[:：]|\\|)\\s*([^\\r\\n|]+)`,
      "gi",
    );
    for (const match of sourceText.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value) values.push(value);
    }
  }
  return values;
}

function assertLabelledBooleanFact(
  field: string,
  value: unknown,
  labels: string[],
  sourceText: string,
) {
  if (value === undefined) return;
  const sourceValues = extractLabelledValues(sourceText, labels).flatMap((sourceValue) => {
    const normalized = normalizeSourceValue(sourceValue);
    if (["yes", "true", "available"].includes(normalized)) return [true];
    if (["no", "false", "unavailable", "not available"].includes(normalized)) return [false];
    return [];
  });
  if (typeof value !== "boolean" || !sourceValues.includes(value)) {
    throw new Error(`Product Agent field ${field} must match an explicitly labelled source value`);
  }
}

function assertLabelledTextFact(
  field: string,
  value: unknown,
  labels: string[],
  sourceText: string,
) {
  if (value === undefined) return;
  if (
    typeof value !== "string" ||
    !extractLabelledValues(sourceText, labels).some(
      (sourceValue) => normalizeSourceValue(sourceValue) === normalizeSourceValue(value),
    )
  ) {
    throw new Error(`Product Agent field ${field} must match an explicitly labelled source value`);
  }
}

function assertLabelledNumberFact(
  field: string,
  value: unknown,
  labels: string[],
  sourceText: string,
) {
  if (value === undefined) return;
  const sourceNumbers = extractLabelledValues(sourceText, labels).flatMap((sourceValue) => {
    const match = /-?(?:\d+(?:\.\d+)?|\.\d+)/.exec(sourceValue.replace(/,/g, ""));
    return match ? [Number(match[0])] : [];
  });
  if (typeof value !== "number" || !sourceNumbers.includes(value)) {
    throw new Error(`Product Agent field ${field} must match an explicitly labelled source value`);
  }
}

function assertLabelledKitContents(value: unknown, sourceText: string) {
  if (value === undefined) return;
  const supportedContents = new Set<string>();
  for (const sourceValue of extractLabelledValues(sourceText, ["Kit contents"])) {
    const normalized = normalizeSourceValue(sourceValue);
    if (/\bclutch disc\b/.test(normalized)) supportedContents.add("clutch_disc");
    if (/\b(?:pressure plate|clutch cover)\b/.test(normalized)) {
      supportedContents.add("pressure_plate");
    }
    if (/\brelease bearing\b/.test(normalized)) supportedContents.add("release_bearing");
  }
  if (
    !Array.isArray(value) ||
    value.length !== supportedContents.size ||
    value.some((item) => typeof item !== "string" || !supportedContents.has(item))
  ) {
    throw new Error(
      "Product Agent field specifications.kit_contents must match an explicitly labelled source value",
    );
  }
}

function assertSourceBackedFacts(draft: ProductDraft, sourceText: string) {
  assertLabelledTextFact(
    "product.product_name",
    draft.product.product_name,
    ["Product name"],
    sourceText,
  );
  assertLabelledTextFact(
    "product.product_type",
    draft.product.product_type,
    ["Product type"],
    sourceText,
  );
  assertLabelledTextFact(
    "product.internal_sku",
    draft.product.internal_sku,
    ["Internal SKU", "Kit No.", "Part No.", "Type No."],
    sourceText,
  );
  assertLabelledTextFact(
    "product.application",
    draft.product.application,
    ["Application"],
    sourceText,
  );
  assertLabelledTextFact(
    "product.vehicle_brand",
    draft.product.vehicle_brand,
    ["Vehicle brand"],
    sourceText,
  );
  assertLabelledTextFact(
    "product.vehicle_model",
    draft.product.vehicle_model,
    ["Vehicle model"],
    sourceText,
  );
  assertLabelledNumberFact(
    "specifications.clutch_diameter_mm",
    draft.specifications?.clutch_diameter_mm,
    ["Clutch diameter"],
    sourceText,
  );
  assertLabelledNumberFact(
    "specifications.spline_count",
    draft.specifications?.spline_count,
    ["Spline count"],
    sourceText,
  );
  assertLabelledTextFact(
    "specifications.spline_size",
    draft.specifications?.spline_size,
    ["Spline size"],
    sourceText,
  );
  assertLabelledTextFact(
    "specifications.friction_material",
    draft.specifications?.friction_material,
    ["Friction material"],
    sourceText,
  );
  assertLabelledKitContents(draft.specifications?.kit_contents, sourceText);
  assertLabelledNumberFact(
    "specifications.gross_weight_kg",
    draft.specifications?.gross_weight_kg,
    ["Gross weight"],
    sourceText,
  );
  assertLabelledNumberFact(
    "specifications.net_weight_kg",
    draft.specifications?.net_weight_kg,
    ["Net weight"],
    sourceText,
  );
  assertLabelledTextFact(
    "specifications.package_size",
    draft.specifications?.package_size,
    ["Package size"],
    sourceText,
  );
  assertLabelledNumberFact("commercial.moq", draft.commercial?.moq, ["MOQ"], sourceText);
  assertLabelledNumberFact(
    "commercial.estimated_lead_time_days",
    draft.commercial?.estimated_lead_time_days,
    ["Estimated lead time", "Lead time"],
    sourceText,
  );
  assertLabelledTextFact(
    "commercial.packaging",
    draft.commercial?.packaging,
    ["Packaging"],
    sourceText,
  );
  assertLabelledTextFact(
    "commercial.supported_customization",
    draft.commercial?.supported_customization,
    ["Supported customization", "Customization"],
    sourceText,
  );
  assertLabelledBooleanFact(
    "commercial.sample_available",
    draft.commercial?.sample_available,
    ["Sample available"],
    sourceText,
  );
}

function extractExplicitOeNumbers(sourceText: string) {
  const values = new Set<string>();
  for (const sourceValue of extractLabelledValues(sourceText, ["OE", "OE No.", "OEM", "OEM No."])) {
    for (const value of sourceValue.split(/[,;，、]|\t|\s{2,}/)) {
      const normalized = normalizeOeNumber(value.replace(/^[\s([{"']+|[\s)\]}"'.]+$/g, ""));
      if (normalized) values.add(normalized);
    }
  }
  const labelledOeLine =
    /\b(?:(?:OEM|OE)\s*NO\.?\s*(?:[:：]\s*|\s+)|(?:OEM|OE)\s*[:：]\s*)([^\r\n]+)/gi;
  for (const match of sourceText.matchAll(labelledOeLine)) {
    const lineStart = sourceText.lastIndexOf("\n", match.index ?? 0) + 1;
    if (sourceText.slice(lineStart, match.index).trimStart().startsWith("|")) continue;
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
  assertSourceBackedFacts(draft, source.source_text);
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

export function finalizeProductAgentDraft(
  value: unknown,
  source: ProductAgentSource,
): ProductDraft {
  const draft = parseProductDraft(removeNullOptionalFacts(value));
  assertSafeDraft(draft, source);
  return reviewProductDraft(draft);
}

export class AiSdkProductAgent implements ProductAgent {
  async run({ model, source, timeout_ms }: ProductAgentRequest): Promise<ProductAgentResult> {
    validateProductAgentSource(source);
    const promptText = JSON.stringify({
      record_id: source.record_id,
      source_ref: source.source_ref,
      evidence_refs: source.evidence_refs,
      image_availability: source.image_availability,
      image_refs: source.image_refs,
      candidate_identifier: source.candidate_identifier,
      source_text: `<untrusted-source-text>\n${source.source_text}\n</untrusted-source-text>`,
    });
    const messages: UserModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: promptText },
          ...(source.image_inputs ?? []).map((input) => ({
            type: "image" as const,
            image: Buffer.from(input.data_base64, "base64"),
            mediaType: input.media_type,
          })),
        ],
      },
    ];
    const result = await generateText({
      model,
      instructions: PRODUCT_AGENT_SYSTEM_PROMPT,
      messages,
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
  if (!value || typeof value !== "object")
    throw new Error("Product Agent source must be an object");
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
  const imageInputs = source.image_inputs ?? [];
  if (!Array.isArray(imageInputs)) throw new Error("Product Agent image inputs must be an array");
  if (source.image_availability === "none" && imageInputs.length > 0) {
    throw new Error("No-image Product Agent source cannot include image inputs");
  }
  if (source.image_availability === "real_product_image") {
    const refs = new Set(source.image_refs);
    if (
      imageInputs.length !== refs.size ||
      imageInputs.some(
        (input) =>
          !input ||
          typeof input !== "object" ||
          !refs.has(input.ref) ||
          (input.media_type !== "image/png" && input.media_type !== "image/jpeg") ||
          typeof input.data_base64 !== "string" ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            input.data_base64,
          ) ||
          Buffer.from(input.data_base64, "base64").length === 0,
      )
    ) {
      throw new Error(
        "Image-backed Product Agent source must include bytes for every image reference",
      );
    }
  }
  if (
    source.candidate_identifier !== undefined &&
    (typeof source.candidate_identifier !== "string" || !source.candidate_identifier.trim())
  ) {
    throw new Error("Product Agent candidate identifier is invalid");
  }
  return source as ProductAgentSource;
}
