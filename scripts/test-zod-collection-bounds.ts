import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { productStreamModelProposalSchema } from "../lib/product/stream-model-schema";

const require = createRequire(import.meta.url);
const authRequire = createRequire(require.resolve("better-auth"));
const authZod: typeof z = authRequire("zod").z;

const libraries: [string, typeof z][] = [
  ["application", z],
  ["auth", authZod],
];
// Verify each exact-parent override at its installed resolution, not just root Zod.
const parentPins = [
  "@remotion/media@4.0.520",
  "@remotion/studio-protocol@4.0.520",
  "@remotion/studio-server@4.0.520",
  "@remotion/studio@4.0.520",
  "@vercel/cli-auth@0.0.1",
  "@vercel/cli-config@0.2.4",
  "@workflow/cli@4.3.12",
  "@workflow/core@4.8.8",
  "@workflow/world-local@4.4.1",
  "@workflow/world-vercel@4.7.4",
  "@workflow/world@4.5.0",
];
const store = resolve("node_modules/.pnpm");
const entries = readdirSync(store);
for (const pin of parentPins) {
  const separator = pin.lastIndexOf("@");
  const name = pin.slice(0, separator);
  const encoded = pin.replace("/", "+");
  const matches = entries.filter((entry) => entry === encoded || entry.startsWith(`${encoded}_`));
  assert.ok(matches.length > 0, `missing installed parent ${pin}`);
  for (const entry of matches) {
    const parentRequire = createRequire(
      resolve(store, entry, "node_modules", name, "package.json"),
    );
    const library: typeof z = parentRequire("zod").z;
    libraries.push([pin, library]);
  }
}

for (const [scope, library] of libraries) {
  test(`${scope}: leading array/set bounds reject before element validation`, async () => {
    let visits = 0;
    const element = library.preprocess((value) => {
      visits++;
      return value;
    }, library.string());
    const array = library.array(element).min(1).max(2);
    const oversized = array.safeParse(Array(16).fill(0));
    assert.equal(oversized.success, false);
    assert.equal(visits, 0, "oversized array must not walk its elements");
    assert.deepEqual(
      oversized.error?.issues.map((issue) => issue.code),
      ["too_big"],
    );
    assert.deepEqual(array.parse(["one", "two"]), ["one", "two"]);
    assert.equal(visits, 2);
    visits = 0;
    assert.equal((await array.safeParseAsync(Array(16).fill(0))).success, false);
    assert.equal(visits, 0);
    const set = library.set(element).max(2);
    assert.equal(set.safeParse(new Set([0, 1, 2, 3])).success, false);
    assert.equal(visits, 0);
    // The patch must not claim or silently invent limits for an unbounded schema.
    assert.equal(library.array(element).safeParse(Array(16).fill(0)).success, false);
    assert.equal(visits, 16);
  });
}

test("actual product model OE bound rejects one oversized collection without per-item issues", () => {
  const oe = productStreamModelProposalSchema.options.find(
    (schema) => schema.shape.field.value === "product.oe_numbers",
  );
  assert.ok(oe);
  const invalid = oe.safeParse({
    field: "product.oe_numbers",
    value: Array(101).fill(0),
    evidenceRef: null,
  });
  assert.equal(invalid.success, false);
  assert.deepEqual(
    invalid.error?.issues.map((issue) => ({ code: issue.code, path: issue.path })),
    [{ code: "too_big", path: ["value"] }],
  );
  const valid = {
    field: "product.oe_numbers",
    value: ["SYNTHETIC-OE-001"],
    evidenceRef: "evidence-synthetic",
  };
  assert.deepEqual(oe.parse(valid), valid);
  assert.equal(oe.safeParse({ ...valid, unreviewedEngineeringFact: true }).success, false);
});

test("actual Workflow queue schemas retain date coercion, namespace parsing and rejection", () => {
  const parent = createRequire(
    resolve(store, "@workflow+world@4.5.0/node_modules/@workflow/world/package.json"),
  );
  const { WorkflowInvokePayloadSchema, parseQueueName, getQueueTopicPrefix } =
    parent("./dist/queue.js");
  const payload = {
    runId: "SYNTHETIC-run",
    requestedAt: "2026-10-30T00:00:00.000Z",
    traceCarrier: { traceparent: "SYNTHETIC-trace" },
  };
  assert.deepEqual(WorkflowInvokePayloadSchema.parse(payload), {
    ...payload,
    requestedAt: new Date(payload.requestedAt),
  });
  assert.equal(
    WorkflowInvokePayloadSchema.safeParse({ ...payload, traceCarrier: { traceparent: 42 } })
      .success,
    false,
  );
  assert.equal(getQueueTopicPrefix("workflow", "synthetic"), "__synthetic_wkf_workflow_");
  assert.deepEqual(parseQueueName("__synthetic_wkf_workflow_run1"), {
    prefix: "__synthetic_wkf_workflow_",
    kind: "workflow",
    id: "run1",
  });
  assert.throws(() => getQueueTopicPrefix("workflow", "INVALID namespace"));
});

test("actual CLI config schemas retain passthrough fields and reject invalid settings", () => {
  const parent = createRequire(
    resolve(store, "@vercel+cli-config@0.2.4/node_modules/@vercel/cli-config/package.json"),
  );
  const { globalConfigSchema, authConfigSchema } = parent("./dist/schema.js");
  const config = {
    credStorage: "file",
    telemetry: { enabled: false },
    futureSyntheticOption: "retained",
  };
  assert.deepEqual(globalConfigSchema.parse(config), config);
  assert.equal(globalConfigSchema.safeParse({ credStorage: "invalid" }).success, false);
  assert.equal(globalConfigSchema.safeParse({ telemetry: { enabled: "false" } }).success, false);
  const auth = { token: "SYNTHETIC-only", expiresAt: 123, futureSyntheticOption: true };
  assert.deepEqual(authConfigSchema.parse(auth), auth);
});
