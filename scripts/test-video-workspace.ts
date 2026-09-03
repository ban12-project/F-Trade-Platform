import assert from "node:assert/strict";

import { videoProjectDraftFormSchema } from "../lib/form-schemas";
import {
  createMarketingVideoDraftFormSchema,
  createMarketingVideoFromProductMediaSchema,
} from "../lib/video/edit-contracts";

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

const marketingBase = {
  projectId: "00000000-0000-4000-8000-000000000510",
  productId: valid.productId,
  factPath: valid.factPath,
  objective: valid.objective,
  targetAudience: valid.targetAudience,
  platform: "facebook" as const,
};
const upload = createMarketingVideoDraftFormSchema.parse({
  ...marketingBase,
  rightsEvidenceRef: "evidence-rights-501",
});
assert.equal(upload.rightsEvidenceRef, "evidence-rights-501");
assert.throws(() => createMarketingVideoDraftFormSchema.parse({
  ...marketingBase,
  rightsEvidenceRef: "",
}), /权利证据/);
assert.throws(() => createMarketingVideoDraftFormSchema.parse({
  ...marketingBase,
  sourceMode: "product_media",
  productMediaIds: ["00000000-0000-4000-8000-000000000511"],
  rightsEvidenceRef: "evidence-rights-501",
}), /Unrecognized key|unrecognized/i);

const mediaId = "00000000-0000-4000-8000-000000000511";
const reused = createMarketingVideoFromProductMediaSchema.parse({
  ...marketingBase,
  sourceMode: "product_media",
  productMediaIds: [mediaId],
  rightsEvidenceRef: "",
});
assert.deepEqual(reused.productMediaIds, [mediaId]);
assert.throws(() => createMarketingVideoFromProductMediaSchema.parse({
  ...marketingBase,
  sourceMode: "product_media",
  productMediaIds: [],
  rightsEvidenceRef: "",
}), /至少选择/);
assert.throws(() => createMarketingVideoFromProductMediaSchema.parse({
  ...marketingBase,
  sourceMode: "product_media",
  productMediaIds: [mediaId, mediaId],
  rightsEvidenceRef: "",
}), /不能重复选择/);
assert.throws(() => createMarketingVideoFromProductMediaSchema.parse({
  ...marketingBase,
  sourceMode: "product_media",
  productMediaIds: [mediaId],
  rightsEvidenceRef: "evidence-rights-501",
}), /Invalid input|invalid/i);

console.log("PASS video workspace form accepts only bounded, private, evidence-oriented input");
