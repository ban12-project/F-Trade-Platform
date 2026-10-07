import assert from "node:assert/strict";
import { mock } from "node:test";
import {
  ProductSourceError,
  ProductUploadError,
  productIntakeErrorMessage,
} from "../lib/product/intake-errors";

const secret = "SYNTHETIC provider response / private URL / credential must stay private";
let authorized = true;
let failure: unknown = new Error(secret);
let imageFailure: unknown;
let evidenceFailure: unknown = new Error(secret);
let writes = 0;
const moduleUrl = (path: string) => new URL(path, import.meta.url).href;
mock.module(moduleUrl("../lib/action-boundary.ts"), {
  exports: {
    authorizedActionSession: async () => (authorized ? { user: { id: "synthetic-actor" } } : null),
    refreshWorkspace: () => {},
  },
});
mock.module(moduleUrl("../lib/ai/model-provider.ts"), {
  exports: { createProductAgentModel: () => ({}) },
});
mock.module(moduleUrl("../lib/ai/product-agent-model-config.ts"), {
  exports: { resolveProductAgentModelConfig: async () => ({}) },
});
mock.module(moduleUrl("../lib/product/claimed-document.ts"), {
  exports: {
    prepareClaimedProductDocument: async () => ({
      source: {
        record_id: "synthetic-record",
        source_ref: "synthetic-source",
        evidence_refs: ["synthetic-evidence"],
        source_text: "Product name: SYNTHETIC",
        image_availability: "none",
        image_refs: [],
      },
    }),
  },
});
mock.module(moduleUrl("../lib/product/claimed-source-images.ts"), {
  exports: {
    attachClaimedProductImages: async (source: unknown) => {
      if (imageFailure) throw imageFailure;
      return source;
    },
  },
});
mock.module(moduleUrl("../lib/product/document-upload-receipts.ts"), {
  exports: {
    claimDocumentUpload: async () => {
      throw evidenceFailure;
    },
  },
});
mock.module(moduleUrl("../lib/product/evidence-located-agent.ts"), {
  exports: {
    EvidenceLocatedProductAgent: class {
      async run() {
        throw failure;
      }
    },
  },
});
mock.module(moduleUrl("../lib/products.ts"), {
  exports: {
    createProductAgentDraft: async () => {
      writes++;
      throw new Error("Unexpected synthetic product write");
    },
  },
});
mock.module(moduleUrl("../lib/workspace/access.ts"), {
  exports: { assertAndLinkProjectEvidence: async () => {} },
});
mock.module(moduleUrl("../lib/workspace/store.ts"), {
  exports: { assertWorkspaceProjectKind: async () => {} },
});
const { runProductAgentAction } = await import("../lib/actions/product-agent");
const { uploadProductEvidenceAction } = await import("../lib/actions/product-evidence");
const form = new FormData();
form.set("projectId", "11111111-1111-4111-8111-111111111111");
form.set("modelConfigId", "synthetic-model-config");
form.set("model", "synthetic-model");
form.set("receiptId", "22222222-2222-4222-8222-222222222222");
const run = () => runProductAgentAction({ status: "idle", message: "" }, form);
for (const error of [
  new Error(secret),
  Object.assign(new Error(secret), { code: "upload_unavailable" }),
  { message: secret, code: "source_labels_missing" },
]) {
  failure = error;
  assert.deepEqual(await run(), {
    status: "error",
    message: productIntakeErrorMessage(null),
  });
}
failure = new ProductSourceError("source_labels_missing");
assert.deepEqual(await run(), {
  status: "error",
  message: productIntakeErrorMessage("source_labels_missing"),
});
imageFailure = new ProductUploadError("upload_type_mismatch");
assert.deepEqual(await run(), {
  status: "error",
  message: productIntakeErrorMessage("upload_type_mismatch"),
});
assert.equal(writes, 0);
const upload = () => uploadProductEvidenceAction({ status: "idle", message: "" }, form);
assert.deepEqual(await upload(), {
  status: "error",
  message: "无法上传产品证据，请检查项目权限及上传回执。",
});
evidenceFailure = new ProductUploadError("upload_unavailable");
assert.deepEqual(await upload(), {
  status: "error",
  message: productIntakeErrorMessage("upload_unavailable"),
});
authorized = false;
assert.deepEqual(await run(), { status: "error", message: "无权运行 Product Agent。" });
assert.deepEqual(await upload(), { status: "error", message: "无权上传产品证据。" });
console.log(
  "PASS actual product intake Actions redact unknown errors and map verified failures without writes",
);
