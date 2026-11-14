import assert from "node:assert/strict";
import test from "node:test";
import type { ProductCatalogForm } from "../lib/product/catalog-form-schema";
import { productFormReadiness } from "../lib/product/form-readiness";

const ref = "evidence-synthetic-catalog-001";
const core: Partial<ProductCatalogForm> = {
  productName: "SYNTHETIC disc",
  productNameEvidenceRef: ref,
  productType: "clutch_disc",
  productTypeEvidenceRef: ref,
  internalSku: "SYNTHETIC-001",
  internalSkuEvidenceRef: ref,
  sourceRef: ref,
};

test("unknown optional facts never lower coverage or imply Product Ready", () => {
  const summary = productFormReadiness(core, [ref]);
  assert.equal(summary.filled, 3);
  assert.equal(summary.linked, 3);
  assert.equal(summary.needsAttention.length, 0);
  assert.match(summary.identity, /^待补充/);
  assert.equal(summary.sourceStatus, "已选择主要来源资料");
  assert.equal("ready" in summary, false);
});

test("empty forms and a default product type do not report full coverage", () => {
  assert.equal(productFormReadiness({}, [ref]).filled, 0);
  const summary = productFormReadiness({ productType: "clutch_disc" }, [ref]);
  assert.equal(summary.filled, 1);
  assert.equal(summary.linked, 0);
  assert.equal(summary.sourceStatus, "待选择主要来源资料");
  assert.equal(summary.core[0].status, "missing");
  assert.equal(summary.core[1].status, "unlinked");
});

test("optional facts require evidence while explicit no and zero remain facts", () => {
  const values: Partial<ProductCatalogForm> = {
    ...core,
    sampleAvailable: "no",
    estimatedLeadTimeDays: "0",
  };
  const pending = productFormReadiness(values, [ref]);
  assert.equal(pending.filled, 5);
  assert.equal(pending.linked, 3);
  assert.equal(pending.needsAttention.length, 2);
  const linked = productFormReadiness(
    { ...values, sampleAvailableEvidenceRef: ref, estimatedLeadTimeDaysEvidenceRef: ref },
    [ref],
  );
  assert.equal(linked.linked, 5);
});

test("clearing a value removes coverage and identifies orphaned sources", () => {
  const summary = productFormReadiness({ ...core, productName: "   " }, [ref]);
  assert.equal(summary.filled, 2);
  assert.equal(summary.linked, 2);
  assert.deepEqual(
    summary.orphaned.map((fact) => fact.name),
    ["productName"],
  );
});

test("OE or complete application are alternatives, both still need human verification", () => {
  const oe = productFormReadiness(
    { ...core, oeNumbers: "SYNTHETIC-OE", oeNumbersEvidenceRef: ref },
    [ref],
  );
  assert.match(oe.identity, /^OE 资料已关联，仍需人工核实$/);
  const application = {
    ...core,
    application: "SYNTHETIC application",
    applicationEvidenceRef: ref,
    vehicleBrand: "SYNTHETIC brand",
    vehicleBrandEvidenceRef: ref,
    vehicleModel: "SYNTHETIC model",
    vehicleModelEvidenceRef: ref,
  };
  assert.match(productFormReadiness(application, [ref]).identity, /^完整适配资料已关联，须由人工/);
  assert.match(
    productFormReadiness({ ...application, vehicleModelEvidenceRef: "" }, [ref]).identity,
    /^待补充/,
  );
  assert.match(
    productFormReadiness({ ...core, oeNumbers: ", ;，；", oeNumbersEvidenceRef: ref }, [ref])
      .identity,
    /^待补充/,
  );
});

test("unknown or removed evidence is not counted as covered", () => {
  const summary = productFormReadiness(core, []);
  assert.equal(summary.linked, 0);
  assert.equal(summary.needsAttention.length, 3);
  assert.equal(summary.core[0].status, "unavailable");
  assert.equal(summary.sourceStatus, "主要来源当前不可选，请重新选择");
});

test("retained locations are distinct from currently available sources", () => {
  const location = `evidence-loc-line-000001-000001-${"a".repeat(32)}`;
  const original = { ...core, productNameEvidenceRef: location };
  const summary = productFormReadiness(original, [ref], original);
  assert.equal(summary.linked, 2);
  assert.equal(summary.retained, 1);
  for (const values of [
    { ...original, productName: "SYNTHETIC changed" },
    { ...original, sourceRef: "evidence-synthetic-other" },
  ]) {
    const changed = productFormReadiness(values, [ref], original);
    assert.equal(changed.retained, 0);
    assert.equal(changed.core[0].status, "unavailable");
  }
  assert.equal(productFormReadiness(original, [ref]).retained, 0);
});

test("kit-only facts follow the product type without rewarding empty optional facts", () => {
  const kit: Partial<ProductCatalogForm> = {
    ...core,
    productType: "clutch_kit",
    kitContents: "clutch_disc",
    kitContentsEvidenceRef: ref,
  };
  assert.equal(productFormReadiness(kit, [ref]).linked, 4);
  assert.equal(productFormReadiness({ ...kit, productType: "clutch_disc" }, [ref]).linked, 3);
});

test("invalid core values do not report prepared and evidence changes update coverage", () => {
  const summary = productFormReadiness({ ...core, productName: "x".repeat(161) }, [ref]);
  assert.equal(summary.core[0].status, "invalid");
  assert.equal(summary.linked, 2);
  assert.equal(productFormReadiness({ ...core, productNameEvidenceRef: "" }, [ref]).linked, 2);
  assert.equal(
    productFormReadiness({ ...core, productNameEvidenceRef: "evidence-other" }, [ref]).linked,
    2,
  );
});

test("preparation feedback does not mutate input or invent optional facts", () => {
  const input = structuredClone(core);
  productFormReadiness(input, [ref]);
  assert.deepEqual(input, core);
  assert.equal(input.frictionMaterial, undefined);
  assert.equal(input.moq, undefined);
});
