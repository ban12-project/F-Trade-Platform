import assert from "node:assert/strict";
import { z } from "zod";
import { buildProductAgentEvidenceLocations } from "../lib/product/evidence-locations";
import { productIntakeFailureDiagnostic } from "../lib/product/intake-diagnostics";
import {
  PRODUCT_INTAKE_ERROR_HEADER,
  ProductSourceError,
  ProductUploadError,
  type ProductUploadErrorCode,
  productIntakeErrorMessage,
  productIntakeFailureMessage,
  productIntakeFailureResponse,
} from "../lib/product/intake-errors";

const secret = "SYNTHETIC private source / credential / URL must never appear";
const validation = z.object({ secret: z.number() }).safeParse({ secret });
assert.equal(validation.success, false);
if (!validation.success)
  assert.deepEqual(productIntakeFailureDiagnostic("input", validation.error), {
    stage: "input",
    category: "validation",
  });
const transport = Object.assign(new Error(secret), { code: "ETIMEDOUT", url: secret });
assert.deepEqual(
  productIntakeFailureDiagnostic("private_blob_read", new TypeError(secret, { cause: transport })),
  { stage: "private_blob_read", category: "transport", code: "ETIMEDOUT" },
);
for (const error of [
  new Error(secret),
  { code: "upload_unavailable", message: secret },
  new Error("upload_unavailable", { cause: new ProductUploadError("upload_unavailable") }),
  { code: secret, stack: secret, message: secret },
  secret,
  null,
  undefined,
]) {
  const result = productIntakeFailureDiagnostic("document", error);
  assert.deepEqual(result, { stage: "document", category: "unclassified" });
  assert.ok(!JSON.stringify(result).includes(secret));
}
const cyclic: { cause?: unknown; message: string } = { message: secret };
cyclic.cause = cyclic;
assert.deepEqual(productIntakeFailureDiagnostic("start_run", cyclic), {
  stage: "start_run",
  category: "unclassified",
});
console.log(
  "PASS allowlisted intake diagnostics exclude exception text, source, URLs, credentials and unrecognized codes",
);

async function verifySourceFailures() {
  for (const code of [
    "upload_unavailable",
    "upload_type_mismatch",
    "upload_size_mismatch",
    "upload_image_invalid",
    "upload_image_animated",
    "upload_changed",
  ] satisfies ProductUploadErrorCode[]) {
    const failure = new ProductUploadError(code);
    Object.assign(failure, { message: secret, cause: { code: "ECONNRESET", message: secret } });
    assert.deepEqual(productIntakeFailureDiagnostic("private_blob_read", failure), {
      stage: "private_blob_read",
      category: "upload",
      code,
    });
    const response = productIntakeFailureResponse(failure);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get(PRODUCT_INTAKE_ERROR_HEADER), code);
    assert.deepEqual(await response.json(), { error: productIntakeErrorMessage(code) });
    assert.equal(productIntakeFailureMessage(failure), productIntakeErrorMessage(code));
    assert.ok(!productIntakeFailureMessage(failure).includes(secret));
  }
  for (const [input, code, guidance] of [
    [
      "| product_name | category |\n| --- | --- |\n| TEST ONLY SYNTHETIC | fixture |",
      "source_labels_missing",
      "字段标签",
    ],
    [
      Array.from({ length: 513 }, () => "Product name: TEST ONLY SYNTHETIC").join("\n"),
      "source_locations_exceeded",
      "拆分文件",
    ],
  ] as const) {
    let failure: unknown;
    try {
      buildProductAgentEvidenceLocations("synthetic-evidence", input);
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof ProductSourceError);
    assert.equal(failure.code, code);
    assert.deepEqual(productIntakeFailureDiagnostic("start_run", failure), {
      stage: "start_run",
      category: "source",
      code,
    });
    const response = productIntakeFailureResponse(failure);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get(PRODUCT_INTAKE_ERROR_HEADER), code);
    assert.ok(productIntakeErrorMessage(code).includes(guidance));
    assert.deepEqual(await response.json(), { error: productIntakeErrorMessage(code) });
  }
  const response = productIntakeFailureResponse(new Error(secret));
  assert.equal(response.headers.get(PRODUCT_INTAKE_ERROR_HEADER), null);
  assert.ok(!(await response.text()).includes(secret));
  for (const code of [null, "__proto__", secret, "unknown"])
    assert.equal(productIntakeErrorMessage(code), productIntakeErrorMessage(null));
  for (const failure of [
    new Error(secret),
    { code: "upload_type_mismatch", message: secret },
    Object.assign(new ProductUploadError("upload_unavailable"), { code: secret }),
  ]) {
    assert.equal(productIntakeFailureMessage(failure), productIntakeErrorMessage(null));
    assert.equal(productIntakeFailureMessage(failure, "catalog fallback"), "catalog fallback");
    assert.ok(
      !JSON.stringify(productIntakeFailureDiagnostic("document", failure)).includes(secret),
    );
  }
  assert.equal(
    buildProductAgentEvidenceLocations("synthetic-evidence", "Product name: TEST ONLY SYNTHETIC")
      .length,
    1,
  );
  console.log(
    "PASS source-label guidance, location limit and unknown-error redaction without weakening source checks",
  );
}
void verifySourceFailures();
