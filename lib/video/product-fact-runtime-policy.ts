import productReadySchema from "@/contracts/data/product-ready.schema.json";
import { compileContract } from "@/lib/contracts/validator";
import type { ProductReady } from "@/lib/product/verification";

import type { VideoProject } from "./contracts";

const parseProductReady = compileContract<ProductReady>(productReadySchema);

function valueAt(product: ProductReady, path: string) {
  const [section, field] = path.split(".");
  const value = product[section as "product" | "specifications" | "commercial"]?.[field];
  if (value === undefined || value === null || value === "") return undefined;
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function verifiedVideoFact(product: ProductReady, field: string) {
  const value = valueAt(product, field);
  const evidenceRef = product.field_evidence[field];
  if (!value || !evidenceRef || !product.evidence_refs.includes(evidenceRef)) {
    throw new Error(`当前 ProductReady 字段缺少有效证据：${field}`);
  }
  return { field, value, evidenceRef };
}

export function currentVerifiedVideoFact(productInput: unknown, field: string) {
  return verifiedVideoFact(parseProductReady(productInput), field);
}

/** Rejects video work when its fact snapshot no longer matches current ProductReady. */
export function assertCurrentProductFacts(project: VideoProject, productInput: unknown) {
  const product = parseProductReady(productInput);
  if (product.verification_status !== "verified" || product.record_id !== project.productId) {
    throw new Error("视频引用的产品已不再是匹配的 ProductReady，不能继续处理。");
  }
  for (const claim of project.factualClaims) {
    const current = verifiedVideoFact(product, claim.field);
    if (current.value !== claim.value || current.evidenceRef !== claim.evidenceRef) {
      throw new Error(`视频事实已不是当前 ProductReady 值或证据：${claim.field}`);
    }
  }
  return product;
}
