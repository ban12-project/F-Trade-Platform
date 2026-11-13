import assert from "node:assert/strict";

import {
  parseProductMediaRegistrationFormData,
  parseProductMediaReviewFormData,
  productMediaRegistrationFieldsSchema,
} from "../lib/product/media-form-schemas";

const projectId = "00000000-0000-4000-8000-000000000601";
const productId = "00000000-0000-4000-8000-000000000602";
const receiptId = "00000000-0000-4000-8000-000000000603";
const assetId = "00000000-0000-4000-8000-000000000604";

const registration = new FormData();
registration.set("projectId", projectId);
registration.set("productId", productId);
registration.set("receiptId", receiptId);
registration.set("origin", "factory");
registration.set("role", "product_hero");
registration.set("description", "Authorized clutch product image");
registration.set("tags", "product, hero product；catalog");
registration.set("productVisible", "true");
registration.set("logoVisible", "false");
registration.set("textPresent", "false");
registration.set("rightsEvidenceRef", "evidence-rights-601");
registration.set("editingAllowed", "true");
registration.set("publicDistributionAllowed", "true");
registration.set("paidAdvertisingAllowed", "false");
registration.set("imageToVideoAllowed", "false");
registration.set("referenceToVideoAllowed", "false");
registration.set("rightsExpiresAt", "2027-09-03T00:00:00+08:00");

const parsed = parseProductMediaRegistrationFormData(registration);
assert.equal(parsed.projectId, projectId);
assert.equal(parsed.productId, productId);
assert.equal(parsed.receiptId, receiptId);
assert.equal(parsed.rightsEvidenceRef, "evidence-rights-601");
assert.deepEqual(parsed.input.semantic.tags, ["product", "hero", "catalog"]);
assert.equal(parsed.input.rights.expiresAt, "2027-09-03T00:00:00+08:00");
assert.equal("evidenceRef" in parsed.input, false);

const browserLocalExpiry = "2027-09-03T00:00";
const browserFields = productMediaRegistrationFieldsSchema.parse({
  projectId,
  productId,
  origin: "factory",
  role: "product_hero",
  description: "",
  tags: "",
  productVisible: true,
  logoVisible: false,
  textPresent: false,
  rightsEvidenceRef: "evidence-rights-601",
  editingAllowed: true,
  publicDistributionAllowed: true,
  paidAdvertisingAllowed: false,
  imageToVideoAllowed: false,
  referenceToVideoAllowed: false,
  rightsExpiresAt: browserLocalExpiry,
});
assert.equal(browserFields.rightsExpiresAt, new Date(browserLocalExpiry).toISOString());

const originalTimeZone = process.env.TZ;
try {
  for (const scenario of [
    {
      zone: "America/New_York",
      gap: "2027-03-14T02:30",
      fold: "2027-11-07T01:30",
      later: "2027-11-07T06:30:00.000Z",
    },
    {
      zone: "Australia/Lord_Howe",
      gap: "2027-10-03T02:15",
      fold: "2027-04-04T01:45",
      later: "2027-04-03T15:15:00.000Z",
    },
  ]) {
    process.env.TZ = scenario.zone;
    assert.equal(
      productMediaRegistrationFieldsSchema.safeParse({
        ...browserFields,
        rightsExpiresAt: scenario.gap,
      }).success,
      false,
      `${scenario.zone} must reject a nonexistent expiry`,
    );
    assert.equal(
      productMediaRegistrationFieldsSchema.safeParse({
        ...browserFields,
        rightsExpiresAt: scenario.fold,
      }).success,
      false,
      `${scenario.zone} must require an occurrence`,
    );
    const resolved = productMediaRegistrationFieldsSchema.parse({
      ...browserFields,
      rightsExpiresAt: scenario.fold,
      selectedRightsExpiryInstant: scenario.later,
    });
    assert.equal(resolved.rightsExpiresAt, scenario.later);
    assert.equal("selectedRightsExpiryInstant" in resolved, false);
    assert.equal(
      productMediaRegistrationFieldsSchema.safeParse({
        ...browserFields,
        rightsExpiresAt: scenario.fold,
        selectedRightsExpiryInstant: "2028-01-01T00:00:00.000Z",
      }).success,
      false,
    );
    assert.equal(
      productMediaRegistrationFieldsSchema.parse({
        ...browserFields,
        rightsExpiresAt: "",
        selectedRightsExpiryInstant: scenario.later,
      }).rightsExpiresAt,
      "",
    );
  }
} finally {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
}

assert.throws(
  () =>
    productMediaRegistrationFieldsSchema.parse({
      projectId,
      productId,
      origin: "factory",
      role: "product_hero",
      description: "",
      tags: "",
      productVisible: true,
      logoVisible: false,
      textPresent: false,
      rightsEvidenceRef: "evidence-rights-601",
      editingAllowed: false,
      publicDistributionAllowed: true,
      paidAdvertisingAllowed: false,
      imageToVideoAllowed: true,
      referenceToVideoAllowed: false,
      rightsExpiresAt: "",
    }),
  /编辑授权/,
);

const ambiguousExpiry = new FormData();
for (const [key, value] of registration.entries()) ambiguousExpiry.set(key, value);
ambiguousExpiry.set("rightsExpiresAt", "2027-09-03T00:00");
assert.throws(() => parseProductMediaRegistrationFormData(ambiguousExpiry), /包含时区/);

const missingReceipt = new FormData();
for (const [key, value] of registration.entries())
  if (key !== "receiptId") missingReceipt.set(key, value);
assert.throws(() => parseProductMediaRegistrationFormData(missingReceipt), /上传回执/);

const review = new FormData();
review.set("projectId", projectId);
review.set("productId", productId);
review.set("assetId", assetId);
review.set("decision", "approved");
review.set("evidenceRef", "evidence-review-601");
review.set("notes", "Source, rights, and visible product identity confirmed.");
const parsedReview = parseProductMediaReviewFormData(review);
assert.equal(parsedReview.productId, productId);
assert.deepEqual(parsedReview.input, {
  assetId,
  decision: "approved",
  evidenceRef: "evidence-review-601",
  notes: "Source, rights, and visible product identity confirmed.",
});

const rejectedWithoutReason = new FormData();
for (const [key, value] of review.entries()) rejectedWithoutReason.set(key, value);
rejectedWithoutReason.set("decision", "rejected");
rejectedWithoutReason.set("notes", "");
assert.throws(() => parseProductMediaReviewFormData(rejectedWithoutReason), /必须填写原因/);

review.set("evidenceRef", "https://example.com/review");
assert.throws(() => parseProductMediaReviewFormData(review), /请选择已保存的来源资料/);

console.log("PASS ProductMedia forms bind uploads, rights, and review to server-safe inputs");
