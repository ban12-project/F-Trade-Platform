import { z } from "zod";
import type { ProductAgentSource } from "./agent";
import { prepareProductAgentEvidenceSource } from "./evidence-locations";

const bindingSchema = z.object({
  source_ref: z.string().min(1).max(240),
  evidence_ref: z.string().min(1).max(240),
  location_refs: z
    .array(
      z
        .string()
        .regex(/^evidence-loc-/)
        .max(240),
    )
    .min(1)
    .max(512),
});

/** Retain only the server-derived association, without copying private source text. */
export function buildProductEvidenceSourceBinding(source: ProductAgentSource) {
  const located = prepareProductAgentEvidenceSource(source);
  return bindingSchema.parse({
    source_ref: source.source_ref,
    evidence_ref: source.evidence_refs[0]?.split("#")[0],
    location_refs: located.evidence_locations.map((location) => location.ref),
  });
}

export function parseProductEvidenceSourceBinding(value: unknown) {
  const result = bindingSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
