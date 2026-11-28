import assert from "node:assert/strict";
import { ZodError } from "zod";
import draftSchema from "../contracts/sales/rfq-draft.schema.json";
import readySchema from "../contracts/sales/rfq-ready.schema.json";
import { compileContract } from "../lib/contracts/validator";
import { assessRfq, promoteRfqReady, updateRfqDraft } from "../lib/rfq/completeness";
import { inquirySuggestionFieldsSchema, rfqFormSchema } from "../lib/rfq/form-schemas";
import { createRfq, reviseRfq } from "../lib/sales/store";

const draft = {
  rfq_id: "synthetic-rfq-test",
  customer: {},
  product: { product_type: "clutch_kit", vehicle_brand: "Synthetic" },
  commercial: { quantity: 1 },
};
assert.deepEqual(assessRfq(draft), {
  completeness_score: 35,
  missing_fields: ["vehicle_model_or_oe_number", "destination"],
  ready: false,
});
const filled = updateRfqDraft(draft, {
  product: { vehicle_model: "Demo" },
  commercial: { destination: "Synthetic" },
});
assert.equal(promoteRfqReady(filled).status, "ready");
assert.throws(() => promoteRfqReady(draft), /incomplete/);
console.log("PASS RFQ completeness rules");

assert.equal(
  assessRfq({ ...filled, commercial: { ...filled.commercial, quantity: "1" } }).ready,
  false,
);

for (const quantity of ["", "1", " 500 ", "9007199254740991"]) {
  assert.equal(rfqFormSchema.shape.quantity.safeParse(quantity).success, true);
  assert.equal(inquirySuggestionFieldsSchema.safeParse({ quantity }).success, true);
}
for (const quantity of [
  "0",
  "-1",
  "1.5",
  "1e3",
  "9007199254740992",
  "9007199254740993",
  "9".repeat(400),
]) {
  assert.equal(rfqFormSchema.shape.quantity.safeParse(quantity).success, false);
  assert.equal(inquirySuggestionFieldsSchema.safeParse({ quantity }).success, false);
}
const validateDraft = compileContract(draftSchema);
const validateReady = compileContract(readySchema);
for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, undefined]) {
  const unsafe = { ...filled, commercial: { ...filled.commercial, quantity } };
  assert.deepEqual(assessRfq(unsafe), {
    completeness_score: 75,
    missing_fields: ["quantity"],
    ready: false,
  });
  assert.throws(() => promoteRfqReady(unsafe), /incomplete/);
  assert.throws(
    () => validateReady({ ...promoteRfqReady(filled), commercial: unsafe.commercial }),
    /Contract validation failed/,
  );
  if (quantity !== undefined)
    assert.throws(() => validateDraft(unsafe), /Contract validation failed/);
}
const unknown = { ...filled, commercial: { destination: "Synthetic" } };
assert.doesNotThrow(() => validateDraft(updateRfqDraft(unknown, {})));
const largestSafe = {
  ...filled,
  commercial: { ...filled.commercial, quantity: Number.MAX_SAFE_INTEGER },
};
assert.equal(promoteRfqReady(largestSafe).commercial?.quantity, Number.MAX_SAFE_INTEGER);
console.log("PASS RFQ quantity integrity across input, suggestions, assessment and contracts");

async function checkStoreBoundary() {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "";
  try {
    const input = {
      customerName: "SYNTHETIC buyer",
      customerCompany: "",
      customerCountry: "",
      productType: "clutch_kit" as const,
      oeNumber: "",
      vehicleBrand: "",
      vehicleModel: "",
      quantity: "9007199254740993",
      destination: "",
      evidenceRef: "evidence-synthetic-rfq",
    };
    for (const operation of [
      () => createRfq(input, "synthetic-actor"),
      () => reviseRfq("synthetic-rfq", input, "synthetic-actor"),
    ]) {
      await assert.rejects(
        operation,
        (error) =>
          error instanceof ZodError && error.issues.some((issue) => issue.path[0] === "quantity"),
      );
    }
    console.log("PASS RFQ create/revise reject unsafe quantities before database access");
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}
checkStoreBoundary().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
