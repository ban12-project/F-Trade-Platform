import assert from "node:assert/strict";
import { mock } from "node:test";
import { productCatalogFormSchema } from "../lib/product/catalog-form-schema";
import { ProductFactRevisionError } from "../lib/product/retained-evidence";
import {
  PRODUCT_REVIEW_ACCESS_MESSAGE,
  ProductReviewAccessError,
} from "../lib/product/review-write-access";

const secret = "SYNTHETIC private SQL, product value, source URL and credential";
let authorized = true;
let failure: unknown = new Error(secret);
let boundaryFailure: unknown;
let attempts = 0;
let refreshes = 0;
let revisionFailure: unknown = new Error(secret);
const moduleUrl = (path: string) => new URL(path, import.meta.url).href;
mock.module(moduleUrl("../lib/action-boundary.ts"), {
  exports: {
    authorizedActionSession: async (permission: string) => {
      assert.ok(["product:review", "product:write"].includes(permission));
      return authorized
        ? { user: { id: "synthetic-reviewer" }, session: { id: "synthetic-session" } }
        : null;
    },
    actionError: () => {
      throw new Error("Raw error boundary must not be used for review");
    },
    refreshWorkspace: () => {
      refreshes++;
    },
  },
});
mock.module(moduleUrl("../lib/workspace/store.ts"), {
  exports: {
    assertWorkspaceProjectKind: async () => {},
    assertWorkspaceAggregateLink: async () => {
      if (boundaryFailure) throw boundaryFailure;
    },
  },
});
mock.module(moduleUrl("../lib/product/evidence-bound-catalog.ts"), {
  exports: {
    createEvidenceBoundProductCatalogDraft: async () => {
      throw new Error("Unexpected write");
    },
    reviseEvidenceBoundProductCatalogDraft: async () => {
      throw revisionFailure;
    },
  },
});
const projectId = "11111111-1111-4111-8111-111111111111";
mock.module(moduleUrl("../lib/products.ts"), {
  exports: {
    decideProductCatalogReview: async (_input: unknown, identity: unknown) => {
      attempts++;
      assert.deepEqual(identity, {
        actorId: "synthetic-reviewer",
        sessionId: "synthetic-session",
        projectId,
      });
      if (failure) throw failure;
      return { state: "PRODUCT_READY" };
    },
  },
});
const { decideProductCatalogReviewAction } = await import("../lib/actions/products");
const form = new FormData();
for (const [key, value] of Object.entries({
  projectId,
  productId: "22222222-2222-4222-8222-222222222222",
  approvalId: "33333333-3333-4333-8333-333333333333",
  reviewedVersion: "1",
  decision: "approved",
  evidenceRef: "evidence-synthetic-review",
  notes: "SYNTHETIC reviewer notes",
}))
  form.set(key, value);
const run = () => decideProductCatalogReviewAction({ status: "idle", message: "" }, form);
const generic = "无法完成 Gate 01 审核，请刷新并确认来源、登录与项目权限后重试。";
for (const error of [
  new Error(secret),
  Object.assign(new Error(secret), { code: "review_access_changed", cause: new Error(secret) }),
  { name: "ProductReviewAccessError", message: secret },
  Object.assign(new Error(secret), { name: "ProductReviewAccessError" }),
]) {
  failure = error;
  assert.deepEqual(await run(), { status: "error", message: generic });
}
failure = Object.assign(new ProductReviewAccessError(), {
  message: secret,
  cause: new Error(secret),
});
assert.deepEqual(await run(), { status: "error", message: PRODUCT_REVIEW_ACCESS_MESSAGE });
failure = new Error(`Product cannot be Ready: ${secret}`);
assert.deepEqual(await run(), {
  status: "error",
  message: "产品事实或逐字段证据尚未完整核验，请补齐资料后重新审核。",
});
for (const message of [
  "产品资料已更新，请刷新并重新审核当前版本。",
  "请先核对原始产品图片，并明确确认与当前产品一致。无法确认时请退回。",
]) {
  failure = new Error(message);
  assert.deepEqual(await run(), { status: "error", message });
}
const beforeBoundary = attempts;
boundaryFailure = new Error(secret);
assert.deepEqual(await run(), { status: "error", message: generic });
assert.equal(attempts, beforeBoundary);
boundaryFailure = undefined;
form.delete("projectId");
assert.deepEqual(await run(), { status: "error", message: generic });
assert.equal(attempts, beforeBoundary);
form.set("projectId", projectId);
assert.equal(refreshes, 0);
authorized = false;
assert.deepEqual(await run(), { status: "error", message: "无权执行 Gate 01 审核。" });
assert.equal(attempts, beforeBoundary);
authorized = true;
failure = undefined;
assert.deepEqual(await run(), { status: "success", message: "Gate 01 已批准，产品已进入 Ready。" });
assert.equal(refreshes, 1);
console.log(
  "PASS actual Gate 01 Action redacts unknown/private errors, preserves controlled guidance and forwards current identity",
);

const { reviseProductCatalogDraftAction } = await import("../lib/actions/products");
const revisionForm = new FormData();
for (const key of Object.keys(productCatalogFormSchema.shape)) revisionForm.set(key, "");
for (const [key, value] of Object.entries({
  projectId,
  productId: "22222222-2222-4222-8222-222222222222",
  sourceRef: "source-synthetic-catalog",
  productName: "SYNTHETIC disc",
  productType: "clutch_disc",
  internalSku: "SYNTHETIC-001",
  productNameEvidenceRef: "evidence-synthetic-original",
  productTypeEvidenceRef: "evidence-synthetic-original",
  internalSkuEvidenceRef: "evidence-synthetic-original",
}))
  revisionForm.set(key, value);
const revise = () => reviseProductCatalogDraftAction({ status: "idle", message: "" }, revisionForm);
for (const error of [
  new Error(secret),
  { name: "ProductFactRevisionError", message: secret },
  Object.assign(new Error(secret), { name: "ProductFactRevisionError", cause: new Error(secret) }),
]) {
  revisionFailure = error;
  assert.deepEqual(await revise(), {
    status: "error",
    message: "无法保存产品修订，请确认字段证据并重试。",
  });
}
revisionFailure = Object.assign(new ProductFactRevisionError("changed_location"), {
  message: secret,
});
assert.deepEqual(await revise(), {
  status: "error",
  message: "修改字段值或来源后，请为该字段重新选择已上传证据。",
});
console.log(
  "PASS actual revision Action keeps private correction/database failures out of client results",
);
