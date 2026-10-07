import assert from "node:assert/strict";
import { mock } from "node:test";
import type { ProductIntakeStage } from "../lib/product/intake-diagnostics";
import { productIntakeErrorMessage } from "../lib/product/intake-errors";

const privateMarker = "SYNTHETIC private URL / product source / credential";
const projectId = "11111111-1111-4111-8111-111111111111";
const actorId = "SYNTHETIC-private-actor";
const sessionId = "SYNTHETIC-private-session";
const expectedHeader = "x-product-intake-diagnostic";
const callerId = "99999999-9999-4999-8999-999999999999";
let failingStage: ProductIntakeStage = "document";
let role = "admin";
let startCalls = 0;
let writes = 0;
const diagnostics: unknown[][] = [];
const moduleUrl = (path: string) => new URL(path, import.meta.url).href;
const failAt = (stage: ProductIntakeStage) => {
  if (failingStage === stage)
    throw Object.assign(new Error(privateMarker), { code: "ECONNRESET", url: privateMarker });
};
const source = {
  record_id: "SYNTHETIC-private-record",
  source_ref: privateMarker,
  evidence_refs: [privateMarker],
  source_text: "Product name: SYNTHETIC",
  image_availability: "none",
  image_refs: [],
};
mock.method(console, "warn", (...args: unknown[]) => diagnostics.push(args));
mock.module(moduleUrl("../lib/auth.ts"), {
  exports: {
    auth: {
      api: {
        getSession: async () => ({ user: { id: actorId, role }, session: { id: sessionId } }),
      },
    },
  },
});
mock.module(moduleUrl("../lib/workspace/store.ts"), {
  exports: { assertWorkspaceProjectKind: async () => failAt("project_access") },
});
mock.module(moduleUrl("../lib/ai/product-agent-model-config.ts"), {
  exports: {
    resolveProductAgentModelConfig: async () => {
      failAt("model_config");
      return { provider: "SYNTHETIC", model: "SYNTHETIC" };
    },
  },
});
mock.module(moduleUrl("../lib/ai/model-provider.ts"), {
  exports: { createProductAgentModel: () => ({}) },
});
mock.module(moduleUrl("../lib/product/claimed-document.ts"), {
  exports: {
    prepareClaimedProductDocument: async () => {
      failAt("document");
      return { source };
    },
  },
});
mock.module(moduleUrl("../lib/product/claimed-source-images.ts"), {
  exports: {
    attachClaimedProductImages: async () => {
      failAt("images");
      return source;
    },
  },
});
mock.module(moduleUrl("../lib/product/stream-model.ts"), {
  exports: {
    PRODUCT_STREAM_PROMPT_HASH: "SYNTHETIC",
    PRODUCT_STREAM_PROMPT_VERSION: "SYNTHETIC",
    streamProductProposals: () => {
      throw new Error("Unexpected model request");
    },
  },
});
mock.module(moduleUrl("../lib/product/stream-store.ts"), {
  exports: {
    startProductStreamRun: async () => {
      startCalls++;
      failAt("start_run");
      writes++;
      throw new Error("Unexpected run creation");
    },
    persistProductStreamDraft: async () => {
      writes++;
      throw new Error("Unexpected draft write");
    },
    finishProductStreamRun: async () => {
      writes++;
      throw new Error("Unexpected finish write");
    },
  },
});
const { POST } = await import("../app/api/product-agent/stream/route");

function request(origin = "https://intake.synthetic.invalid") {
  const form = new FormData();
  form.set("projectId", projectId);
  form.set("modelConfigId", "SYNTHETIC-model-config");
  form.set("model", "SYNTHETIC-model");
  form.set("sourceText", "");
  form.set("receiptId", "22222222-2222-4222-8222-222222222222");
  if (failingStage === "input") form.delete("model");
  return new Request("https://intake.synthetic.invalid/api/product-agent/stream", {
    method: "POST",
    headers: { origin, [expectedHeader]: callerId },
    body: form,
  });
}

const ids = new Set<string>();
for (const stage of [
  "input",
  "project_access",
  "model_config",
  "document",
  "images",
  "start_run",
] satisfies ProductIntakeStage[]) {
  failingStage = stage;
  const previousStarts = startCalls;
  const response = await POST(request());
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: productIntakeErrorMessage(null) });
  const id = response.headers.get(expectedHeader);
  assert.match(id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(id);
  assert.ok(!ids.has(id));
  ids.add(id);
  const expected =
    stage === "input"
      ? { diagnosticId: id, stage, category: "validation" }
      : { diagnosticId: id, stage, category: "transport", code: "ECONNRESET" };
  assert.deepEqual(diagnostics.at(-1), ["[product-intake-failure]", expected]);
  const visible = JSON.stringify({ headers: [...response.headers], logs: diagnostics });
  for (const privateValue of [privateMarker, projectId, actorId, sessionId, callerId])
    assert.ok(!visible.includes(privateValue));
  assert.equal(startCalls - previousStarts, stage === "start_run" ? 1 : 0);
  assert.equal(writes, 0);
}

// Identical failures can overlap; each response must still identify its own log entry.
failingStage = "document";
const concurrent = await Promise.all([POST(request()), POST(request())]);
for (const response of concurrent) {
  const id = response.headers.get(expectedHeader);
  assert.ok(id);
  assert.ok(!ids.has(id));
  ids.add(id);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: productIntakeErrorMessage(null) });
  assert.equal(
    diagnostics.filter(([, value]) => (value as { diagnosticId?: string }).diagnosticId === id)
      .length,
    1,
  );
}
assert.equal(ids.size, 8);
for (const value of [privateMarker, projectId, actorId, sessionId, callerId])
  assert.ok(!JSON.stringify(diagnostics).includes(value));
assert.equal(startCalls, 1);
assert.equal(writes, 0);

const previousLogs = diagnostics.length;
const foreign = await POST(request("https://foreign.synthetic.invalid"));
assert.equal(foreign.status, 403);
assert.equal(foreign.headers.get(expectedHeader), null);
role = "viewer";
const denied = await POST(request());
assert.equal(denied.status, 403);
assert.equal(denied.headers.get(expectedHeader), null);
assert.equal(diagnostics.length, previousLogs);
assert.equal(writes, 0);
console.log(
  "PASS actual intake handler correlates eight pre-run failures, including concurrent requests, without private data, caller IDs, retries or writes",
);
