import assert from "node:assert/strict";
import { z } from "zod";
import { productIntakeFailureDiagnostic } from "../lib/product/intake-diagnostics";

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
