import type { ProductDraft } from "./verification";

const revisionMessages = {
  changed_location: "修改字段值或来源后，请为该字段重新选择已上传证据。",
  missing_product: "产品草稿不存在，或无权在当前项目修订。",
  not_revisable: "该产品当前不处于待修订状态。",
  write_conflict: "产品修订与另一项操作冲突，请刷新后重试。",
} as const;

export class ProductFactRevisionError extends Error {
  readonly code: keyof typeof revisionMessages;
  constructor(code: keyof typeof revisionMessages) {
    super(revisionMessages[code]);
    this.code = code;
  }
}

export function productRevisionFailureMessage(error: unknown) {
  // A database error can include the private before/after values as SQL parameters.
  const message =
    error instanceof ProductFactRevisionError ? revisionMessages[error.code] : undefined;
  return typeof message === "string" ? message : "无法保存产品修订，请确认字段证据并重试。";
}

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

/** Private audit payload: retain the reviewed values and their evidence, including removals. */
export function productFactRevision(
  previous: ProductDraft,
  next: ProductDraft,
  fromVersion: number,
) {
  const paths = new Set<string>();
  for (const draft of [previous, next]) {
    for (const section of ["product", "specifications", "commercial"] as const) {
      for (const key of Object.keys(draft[section] ?? {})) paths.add(`${section}.${key}`);
    }
    for (const path of Object.keys(draft.field_evidence)) paths.add(path);
  }
  const changes = [...paths].sort().flatMap((path) => {
    const before = {
      value: fieldValue(previous, path) ?? null,
      evidence_ref: previous.field_evidence[path] ?? null,
    };
    const after = {
      value: fieldValue(next, path) ?? null,
      evidence_ref: next.field_evidence[path] ?? null,
    };
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path, before, after }];
  });
  return {
    schema_version: "1.0.0",
    from_version: fromVersion,
    to_version: fromVersion + 1,
    source_ref_before: previous.source_ref,
    source_ref_after: next.source_ref,
    changes,
  };
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
      throw new ProductFactRevisionError("changed_location");
    }
    retained.add(ref);
  }
  return {
    retained: [...retained],
    uploaded: next.evidence_refs.filter((ref) => !retained.has(ref)),
  };
}
