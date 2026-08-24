import type { ProductAgentSource } from "./agent";

export interface CatalogCandidate {
  identifier: string;
  source: ProductAgentSource;
}

const CANDIDATE_IDENTIFIER = /\b(?:(?:RYC|RYD|RY)[A-Z0-9.-]{2,}|[0-9]+XDC[0-9]+)\b/g;

function identifiersIn(text: string) {
  return [...text.matchAll(CANDIDATE_IDENTIFIER)].map((match) => match[0]);
}

function markdownRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return undefined;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

function candidateRecords(sourceText: string) {
  const records: Array<{ identifier: string; text: string }> = [];
  const tableLines = new Set<number>();
  const lines = sourceText.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = markdownRow(lines[index]!);
    const separator = markdownRow(lines[index + 1]!);
    if (
      !header || !separator || header.length !== separator.length ||
      !separator.every((cell) => /^:?-{3,}:?$/.test(cell))
    ) {
      continue;
    }
    tableLines.add(index);
    tableLines.add(index + 1);
    const headerLine = lines[index]!;
    const separatorLine = lines[index + 1]!;
    index += 2;
    while (index < lines.length) {
      const row = markdownRow(lines[index]!);
      if (!row || row.length !== header.length) break;
      tableLines.add(index);
      const identifiers = [...new Set(identifiersIn(lines[index]!))];
      if (identifiers.length === 1) {
        records.push({
          identifier: identifiers[0]!,
          text: [headerLine, separatorLine, lines[index]!].join("\n"),
        });
      }
      index += 1;
    }
    index -= 1;
  }

  const nonTableText = lines.map((line, index) => tableLines.has(index) ? "" : line).join("\n");
  for (const block of nonTableText.split(/\n\s*\n+/)) {
    const identifiers = [...new Set(identifiersIn(block))];
    if (identifiers.length === 1) {
      records.push({ identifier: identifiers[0]!, text: block.trim() });
    }
  }
  return records;
}

/**
 * Finds product records in MarkItDown text. A table result contains its header and exactly one
 * data row; prose results must be isolated by blank lines and contain only one identifier.
 */
export function discoverCatalogCandidates(source: ProductAgentSource): CatalogCandidate[] {
  const seen = new Set<string>();
  return candidateRecords(source.source_text).flatMap(({ identifier, text }) => {
    if (seen.has(identifier)) return [];
    seen.add(identifier);
    return [{
      identifier,
      source: {
        ...source,
        record_id: `${source.record_id}-${identifier.toLowerCase()}`,
        source_text: text,
        candidate_identifier: identifier,
      },
    }];
  });
}
