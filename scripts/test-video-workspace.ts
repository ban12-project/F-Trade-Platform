import assert from "node:assert/strict";
import {
  createMarketingVideoDraftFormSchema,
  createMarketingVideoFromProductMediaSchema,
} from "../lib/video/edit-contracts";

const marketingBase = {
  projectId: "00000000-0000-4000-8000-000000000510",
  productId: "00000000-0000-4000-8000-000000000501",
  factPath: "product.product_name",
  objective: "Introduce a verified synthetic product",
  targetAudience: "Synthetic distributor",
  platform: "facebook" as const,
};
const upload = createMarketingVideoDraftFormSchema.parse({
  ...marketingBase,
  rightsEvidenceRef: "evidence-rights-501",
});
assert.equal(upload.rightsEvidenceRef, "evidence-rights-501");
assert.equal(
  createMarketingVideoDraftFormSchema.safeParse({ ...upload, factPath: "engineering.oe_number" })
    .success,
  false,
);
assert.equal(
  createMarketingVideoDraftFormSchema.safeParse({ ...upload, platform: "unsupported" }).success,
  false,
);
assert.throws(
  () =>
    createMarketingVideoDraftFormSchema.parse({
      ...marketingBase,
      rightsEvidenceRef: "",
    }),
  /权利证据/,
);
assert.throws(
  () =>
    createMarketingVideoDraftFormSchema.parse({
      ...marketingBase,
      sourceMode: "product_media",
      productMediaIds: ["00000000-0000-4000-8000-000000000511"],
      rightsEvidenceRef: "evidence-rights-501",
    }),
  /Unrecognized key|unrecognized/i,
);

const mediaId = "00000000-0000-4000-8000-000000000511";
const reused = createMarketingVideoFromProductMediaSchema.parse({
  ...marketingBase,
  sourceMode: "product_media",
  productMediaIds: [mediaId],
  rightsEvidenceRef: "",
});
assert.deepEqual(reused.productMediaIds, [mediaId]);
assert.throws(
  () =>
    createMarketingVideoFromProductMediaSchema.parse({
      ...marketingBase,
      sourceMode: "product_media",
      productMediaIds: [],
      rightsEvidenceRef: "",
    }),
  /至少选择/,
);
assert.throws(
  () =>
    createMarketingVideoFromProductMediaSchema.parse({
      ...marketingBase,
      sourceMode: "product_media",
      productMediaIds: [mediaId, mediaId],
      rightsEvidenceRef: "",
    }),
  /不能重复选择/,
);
assert.throws(
  () =>
    createMarketingVideoFromProductMediaSchema.parse({
      ...marketingBase,
      sourceMode: "product_media",
      productMediaIds: [mediaId],
      rightsEvidenceRef: "evidence-rights-501",
    }),
  /Invalid input|invalid/i,
);

console.log("PASS video workspace form accepts only bounded, private, evidence-oriented input");
