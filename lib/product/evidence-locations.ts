import { createHash } from "node:crypto";

import type { ProductDraft } from "./verification";

const MAX_EVIDENCE_LOCATIONS = 512;
const MARKDOWN_SEPARATOR = /^:?-{3,}:?$/;
const SUPPORTED_LABEL = /\b(?:product\s+name|product\s+type|internal\s+sku|kit\s+no\.?|part\s+no\.?|type\s+no\.?|oe(?:m)?(?:\s+no\.?)?|application|vehicle\s+brand|vehicle\s+model|clutch\s+diameter|spline\s+count|spline\s+size|friction\s+material|kit\s+contents|gross\s+weight|net\s+weight|package\s+size|moq|estimated\s+lead\s+time|lead\s+time|packaging|supported\s+customization|customization|sample\s+available)\b/i;

export type ProductAgentEvidenceLocation = {
  ref: string;
  kind: "line" | "table_row";
  start_line: number;
  end_line: number;
  text: string;
};

export type ProductAgentEvidenceLocatedSource = {
  record_id: string;
  source_ref: string;
  evidence_refs: string[];
  source_text: string;
  image_availability: "real_product_image" | "none";
  image_refs: string[];
  image_inputs?: Array<{ ref: string; media_type: "image/png" | "image/jpeg"; data_base64: string }>;
  candidate_identifier?: string;
  evidence_locations: ProductAgentEvidenceLocation[];
};

type LocatableProductAgentSource = Omit<ProductAgentEvidenceLocatedSource, "evidence_locations"> & {
  evidence_locations?: ProductAgentEvidenceLocation[];
};

function markdownRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return undefined;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

function locationRef(
  baseEvidenceRef: string,
  kind: ProductAgentEvidenceLocation["kind"],
  startLine: number,
  endLine: number,
  text: string,
) {
  const digest = createHash("sha256")
    .update(`${baseEvidenceRef}\0${kind}\0${startLine}\0${endLine}\0${text}`)
    .digest("hex")
    .slice(0, 16);
  return `${baseEvidenceRef}#loc=${kind}-${String(startLine).padStart(6, "0")}-${String(endLine).padStart(6, "0")}-${digest}`;
}

function assertLocationLimit(locations: ProductAgentEvidenceLocation[]) {
  if (locations.length > MAX_EVIDENCE_LOCATIONS) {
    throw new Error(`Product Agent source contains more than ${MAX_EVIDENCE_LOCATIONS} labelled evidence locations; split the catalog before extraction`);
  }
}

/**
 * Produces deterministic, bounded excerpts from explicitly labelled source text.
 * Table locations contain their header, separator, and exactly one data row;
 * prose locations contain one labelled line. Unlabelled narrative is excluded.
 */
export function buildProductAgentEvidenceLocations(
  baseEvidenceRef: string,
  sourceText: string,
): ProductAgentEvidenceLocation[] {
  if (!baseEvidenceRef.trim()) throw new Error("Product Agent evidence location requires a base evidence reference");
  const lines = sourceText.split(/\r?\n/);
  const tableLines = new Set<number>();
  const locations: ProductAgentEvidenceLocation[] = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = markdownRow(lines[index]!);
    const separator = markdownRow(lines[index + 1]!);
    if (!header || !separator || header.length !== separator.length || !separator.every((cell) => MARKDOWN_SEPARATOR.test(cell))) continue;
    if (!header.some((cell) => SUPPORTED_LABEL.test(cell))) continue;

    tableLines.add(index);
    tableLines.add(index + 1);
    const headerLine = lines[index]!;
    const separatorLine = lines[index + 1]!;
    index += 2;
    while (index < lines.length) {
      const row = markdownRow(lines[index]!);
      if (!row || row.length !== header.length) break;
      tableLines.add(index);
      const text = [headerLine, separatorLine, lines[index]!].join("\n");
      const rowLine = index + 1;
      locations.push({
        ref: locationRef(baseEvidenceRef, "table_row", rowLine, rowLine, text),
        kind: "table_row",
        start_line: rowLine,
        end_line: rowLine,
        text,
      });
      assertLocationLimit(locations);
      index += 1;
    }
    index -= 1;
  }

  for (const [index, line] of lines.entries()) {
    if (tableLines.has(index) || !line.trim() || !SUPPORTED_LABEL.test(line)) continue;
    const text = line.trim();
    const lineNumber = index + 1;
    locations.push({
      ref: locationRef(baseEvidenceRef, "line", lineNumber, lineNumber, text),
      kind: "line",
      start_line: lineNumber,
      end_line: lineNumber,
      text,
    });
    assertLocationLimit(locations);
  }

  if (!locations.length) {
    throw new Error("Product Agent source contains no explicitly labelled evidence locations");
  }
  const seen = new Set<string>();
  return locations.filter((location) => {
    if (seen.has(location.ref)) return false;
    seen.add(location.ref);
    return true;
  });
}

function taggedSourceText(locations: ProductAgentEvidenceLocation[]) {
  return locations.map((location) => [
    `<evidence-location ref="${location.ref}" kind="${location.kind}" lines="${location.start_line}-${location.end_line}">`,
    location.text,
    "</evidence-location>",
  ].join("\n")).join("\n\n");
}

/** Rebuilds locations from the current, possibly candidate-scoped source text. */
export function prepareProductAgentEvidenceSource<T extends LocatableProductAgentSource>(
  source: T,
): T & ProductAgentEvidenceLocatedSource {
  const baseEvidenceRef = source.evidence_refs[0] ?? source.source_ref;
  const evidenceLocations = buildProductAgentEvidenceLocations(baseEvidenceRef, source.source_text);
  return {
    ...source,
    evidence_refs: evidenceLocations.map((location) => location.ref),
    evidence_locations: evidenceLocations,
    source_text: taggedSourceText(evidenceLocations),
  };
}

function valueAt(draft: ProductDraft, field: string) {
  const [section, key] = field.split(".");
  if (!key) return undefined;
  const fields = section === "product"
    ? draft.product
    : section === "specifications"
      ? draft.specifications
      : section === "commercial"
        ? draft.commercial
        : undefined;
  return fields && typeof fields === "object"
    ? (fields as Record<string, unknown>)[key]
    : undefined;
}

function singleFieldDraft(draft: ProductDraft, field: string, evidenceRef: string): ProductDraft {
  const [section, key] = field.split(".");
  const value = valueAt(draft, field);
  if (!section || !key || value === undefined) throw new Error(`Product Agent field ${field} has no value to validate`);
  return {
    record_id: draft.record_id,
    source_ref: draft.source_ref,
    evidence_refs: [evidenceRef],
    field_evidence: { [field]: evidenceRef },
    verification_status: "review_required",
    blocking_missing_fields: [],
    optional_missing_fields: [],
    product: section === "product" ? { [key]: value } : {},
    ...(section === "specifications" ? { specifications: { [key]: value } } : {}),
    ...(section === "commercial" ? { commercial: { [key]: value } } : {}),
  } as ProductDraft;
}

/**
 * Uses the canonical Product Agent fact checks against each cited excerpt, not
 * the whole document. The callback avoids a module cycle with agent.ts.
 */
export function assertProductAgentEvidenceLocations(
  draft: ProductDraft,
  source: ProductAgentEvidenceLocatedSource,
  finalizeSingleField: (value: unknown, source: LocatableProductAgentSource) => ProductDraft,
) {
  const locations = new Map(source.evidence_locations.map((location) => [location.ref, location]));
  for (const [field, evidenceRef] of Object.entries(draft.field_evidence)) {
    const location = locations.get(evidenceRef);
    if (!location) throw new Error(`Product Agent field ${field} cites an unknown evidence location`);
    finalizeSingleField(singleFieldDraft(draft, field, evidenceRef), {
      record_id: draft.record_id,
      source_ref: draft.source_ref,
      evidence_refs: [evidenceRef],
      source_text: location.text,
      image_availability: "none",
      image_refs: [],
    });
  }
}

export function compactProductAgentEvidenceRefs(draft: ProductDraft): ProductDraft {
  return {
    ...draft,
    evidence_refs: [...new Set(Object.values(draft.field_evidence))],
  };
}
