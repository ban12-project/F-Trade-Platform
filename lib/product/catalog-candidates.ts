import type { ProductAgentSource } from "./agent";

export interface CatalogCandidate {
  identifier: string;
  source: ProductAgentSource;
}

const CANDIDATE_IDENTIFIER = /\b(?:(?:RYC|RYD|RY)[A-Z0-9.-]{2,}|[0-9]+XDC[0-9]+)\b/g;

/**
 * Finds product identifiers in MarkItDown text and supplies a bounded source window for each.
 * The separate identifier scopes the model; it never becomes evidence for a product fact.
 */
export function discoverCatalogCandidates(
  source: ProductAgentSource,
  contextCharacters = 900,
): CatalogCandidate[] {
  if (!Number.isInteger(contextCharacters) || contextCharacters < 200) {
    throw new Error("Catalog candidate context must be an integer of at least 200 characters");
  }
  const matches = [...source.source_text.matchAll(CANDIDATE_IDENTIFIER)];
  const seen = new Set<string>();
  return matches.flatMap((match) => {
    const identifier = match[0];
    if (seen.has(identifier)) return [];
    seen.add(identifier);
    const index = match.index ?? 0;
    return [{
      identifier,
      source: {
        ...source,
        record_id: `${source.record_id}-${identifier.toLowerCase()}`,
        source_text: source.source_text.slice(
          Math.max(0, index - contextCharacters),
          Math.min(source.source_text.length, index + identifier.length + contextCharacters),
        ),
        candidate_identifier: identifier,
      },
    }];
  });
}
