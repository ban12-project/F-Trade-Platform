import assert from "node:assert/strict";

import { videoProjectDraftFormSchema } from "../lib/form-schemas";

const valid = {
  productId: "00000000-0000-4000-8000-000000000501",
  factPath: "product.product_name",
  objective: "Introduce a verified synthetic product",
  targetAudience: "Synthetic distributor",
  scenePrompt: "Show the rights-cleared product image without extra claims.",
  durationSeconds: "5",
  platforms: ["youtube", "tiktok"],
  assetRef: "asset-product-501",
  rightsEvidenceRef: "evidence-rights-501",
};

assert.equal(videoProjectDraftFormSchema.parse(valid).durationSeconds, 5);
assert.equal(videoProjectDraftFormSchema.parse({ ...valid, assetRef: "", rightsEvidenceRef: "" }).assetRef, "");
assert.throws(() => videoProjectDraftFormSchema.parse({ ...valid, factPath: "engineering.oe_number" }), /已核验/);
assert.throws(() => videoProjectDraftFormSchema.parse({ ...valid, platforms: [] }), /至少选择/);
assert.throws(() => videoProjectDraftFormSchema.parse({ ...valid, assetRef: "https://example.com/image.png" }), /私有素材/);
assert.throws(() => videoProjectDraftFormSchema.parse({ ...valid, rightsEvidenceRef: "" }), /权利证据/);
console.log("PASS video workspace form accepts only bounded, private, evidence-oriented input");
