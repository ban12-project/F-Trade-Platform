import type { ProductDraft } from "./verification";

export function isProductEvidenceLocationRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^evidence-loc-(?:row|line)-(?:page-[1-9]\d*-)?\d{6,}-\d{6,}-[a-f0-9]{32}$/.test(value)
  );
}

function fieldValue(draft: ProductDraft, path: string) {
  const [section, key] = path.split(".") as ["product" | "specifications" | "commercial", string];
  return draft[section]?.[key];
}

/** Only an unchanged fact in this locked aggregate may reuse its existing opaque location. */
export function partitionRevisionEvidence(previous: ProductDraft, next: ProductDraft) {
  const retained = new Set<string>();
  for (const [path, ref] of Object.entries(next.field_evidence)) {
    if (!isProductEvidenceLocationRef(ref)) continue;
    if (
      previous.record_id !== next.record_id ||
      previous.source_ref !== next.source_ref ||
      previous.field_evidence[path] !== ref ||
      !previous.evidence_refs.includes(ref) ||
      JSON.stringify(fieldValue(previous, path)) !== JSON.stringify(fieldValue(next, path))
    ) {
      throw new Error("修改字段值或来源后，请为该字段重新选择已上传证据。");
    }
    retained.add(ref);
  }
  return {
    retained: [...retained],
    uploaded: next.evidence_refs.filter((ref) => !retained.has(ref)),
  };
}
