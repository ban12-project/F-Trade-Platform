import type { ProductAgentSource } from "./agent";

export interface CatalogCandidate {
  identifier: string;
  record_id: string;
  review_status: "source_review_required" | "duplicate_identifier_review_required";
  source: ProductAgentSource;
}

// Identifier shape alone is never enough: only explicitly labelled record fields qualify.
const IDENTIFIER = /^(?:(?:RYC|RYD|RY)[A-Z0-9.-]{2,}|[0-9]+(?:XDC|XD|XC)[0-9]+[A-Z]?)$/;
const LABEL = /^(?:internal\s+sku|kit\s+no\.?|part\s+no\.?|type\s+no\.?|编号)$/i;
const NON_CLUTCH = /\b(?:brake\s*(?:disc|disk|pad|rotor)s?)\b|制动盘|刹车片|刹车盘/i;
const PAGE = /^<!-- f-trade:pdf-page=(\d+) -->$/;

function identifierValue(label: string, value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!LABEL.test(label.trim())) return undefined;
  if (IDENTIFIER.test(normalized)) return normalized;
  if (/^kit\s+no\.?$/i.test(label.trim()) && /^\d{4} \d{3} \d{3}$/.test(normalized)) {
    return normalized;
  }
  return undefined;
}

function markdownRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return undefined;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function candidateRecords(sourceText: string) {
  const records: Array<{ identifier: string; text: string; line: number; page?: number }> = [];
  const lines = sourceText.split(/\r?\n/);
  let page: number | undefined;
  let block: string[] = [];
  let blockStart = 0;
  function flush() {
    const text = block.join("\n").trim();
    const identifiers = block.flatMap((line) => {
      const match = /^\s*([^:：]+)[:：]\s*(.*?)\s*$/.exec(line);
      const identifier = match && identifierValue(match[1]!, match[2]!);
      return identifier ? [identifier] : [];
    });
    // Ambiguous multi-record blocks require manual segmentation, never first-match selection.
    if (identifiers.length === 1 && !NON_CLUTCH.test(text)) {
      records.push({ identifier: identifiers[0]!, text, line: blockStart + 1, page });
    }
    block = [];
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const pageMatch = PAGE.exec(line.trim());
    if (pageMatch) {
      flush();
      page = Number(pageMatch[1]);
      continue;
    }
    const header = markdownRow(line);
    const separator = markdownRow(lines[index + 1] ?? "");
    if (
      header &&
      separator &&
      header.length === separator.length &&
      separator.every((cell) => /^:?-{3,}:?$/.test(cell))
    ) {
      flush();
      const headerLine = line;
      const separatorLine = lines[++index]!;
      while (index + 1 < lines.length) {
        const row = markdownRow(lines[index + 1]!);
        if (!row || row.length !== header.length) break;
        index += 1;
        const text = [headerLine, separatorLine, lines[index]!].join("\n");
        const identifiers = header.flatMap((label, column) => {
          const identifier = identifierValue(label, row[column]!);
          return identifier ? [identifier] : [];
        });
        if (identifiers.length === 1 && !NON_CLUTCH.test(text)) {
          records.push({ identifier: identifiers[0]!, text, line: index + 1, page });
        }
      }
    } else if (!line.trim()) {
      flush();
    } else {
      if (!block.length) blockStart = index;
      block.push(line);
    }
  }
  flush();
  return records;
}

/** Preserve every record occurrence and its original location for human review. */
export function discoverCatalogCandidates(source: ProductAgentSource): CatalogCandidate[] {
  if (source.evidence_refs.length !== 1 || !source.evidence_refs[0]?.trim()) {
    throw new Error("Catalog discovery requires exactly one document evidence reference");
  }
  const records = candidateRecords(source.source_text);
  const counts = new Map<string, number>();
  for (const record of records)
    counts.set(record.identifier, (counts.get(record.identifier) ?? 0) + 1);
  return records.map(({ identifier, text, line, page }) => {
    const recordId = `${source.record_id}-record-${line}`;
    const location = `${source.evidence_refs[0]}#${page ? `pdf-page=${page}&` : ""}record-line=${line}`;
    return {
      identifier,
      record_id: recordId,
      review_status:
        counts.get(identifier)! > 1
          ? "duplicate_identifier_review_required"
          : "source_review_required",
      source: {
        ...source,
        record_id: recordId,
        evidence_refs: [location],
        source_text: text,
        candidate_identifier: identifier,
      },
    };
  });
}

export function selectCatalogCandidates(
  candidates: CatalogCandidate[],
  identifiers: Set<string>,
  limit: number,
) {
  const available = new Set(candidates.map((candidate) => candidate.identifier));
  if ([...identifiers].some((identifier) => !available.has(identifier))) {
    throw new Error("One or more requested catalog candidate identifiers were not found");
  }
  return candidates
    .filter((candidate) => identifiers.size === 0 || identifiers.has(candidate.identifier))
    .slice(0, limit);
}
