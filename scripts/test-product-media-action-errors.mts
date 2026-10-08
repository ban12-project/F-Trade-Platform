import assert from "node:assert/strict";
import { mock } from "node:test";
import { VideoDraftAccessError } from "../lib/video/draft-write-access";

const moduleUrl = (p: string) => new URL(p, import.meta.url).href;
const projectId = "11111111-1111-4111-8111-111111111111",
  productId = "22222222-2222-4222-8222-222222222222",
  assetId = "33333333-3333-4333-8333-333333333333";
const identity = { actorId: "synthetic-reviewer", sessionId: "synthetic-session", projectId };
const privateValue = "SYNTHETIC private SQL, cloud URL, source fact and credential";
let authorized = true,
  attempts = 0;
let failure: unknown = new Error(privateValue);
mock.module("next/cache", { exports: { revalidatePath: () => {} } });
mock.module(moduleUrl("../lib/action-boundary.ts"), {
  exports: {
    authorizedActionSession: async () =>
      authorized ? { user: { id: identity.actorId }, session: { id: identity.sessionId } } : null,
  },
});
mock.module(moduleUrl("../lib/workspace/store.ts"), {
  exports: { assertWorkspaceAggregateLink: async () => {} },
});
mock.module(moduleUrl("../lib/product/media-store.ts"), {
  exports: {
    listProductMediaAssets: async () => [{ id: assetId }],
    registerProductMediaAsset: async (_input: unknown, _probe: unknown, value: unknown) => {
      attempts++;
      assert.deepEqual(value, identity);
      if (failure) throw failure;
      return { id: assetId };
    },
    reviewProductMediaAsset: async (_input: unknown, value: unknown) => {
      attempts++;
      assert.deepEqual(value, identity);
      if (failure) throw failure;
      return { id: assetId, review: { status: "approved" } };
    },
  },
});
mock.module(moduleUrl("../lib/video/upload-receipts.ts"), {
  exports: {
    claimCompletedVideoUploads: async (_ids: unknown, value: unknown) => {
      assert.deepEqual(value, identity);
      return [{ assetRef: "evidence-synthetic-image" }];
    },
  },
});
mock.module(moduleUrl("../lib/video/sandbox-sources.ts"), {
  exports: { issueSandboxVideoSources: async () => new Map() },
});
mock.module(moduleUrl("../lib/product/media-sandbox-probe.ts"), {
  exports: { probeProductMediaEvidenceInSandbox: async () => ({}) },
});
const { registerProductMediaAction, reviewProductMediaAction } = await import(
  "../lib/actions/product-media"
);
const form = (op: string) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(
    op === "review"
      ? {
          projectId,
          productId,
          assetId,
          decision: "approved",
          evidenceRef: "evidence-synthetic-review",
          notes: "SYNTHETIC",
        }
      : {
          projectId,
          productId,
          receiptId: assetId,
          origin: "factory",
          role: "product_hero",
          description: "SYNTHETIC",
          tags: "",
          productVisible: "true",
          logoVisible: "false",
          textPresent: "false",
          rightsEvidenceRef: "evidence-synthetic-rights",
          editingAllowed: "true",
          publicDistributionAllowed: "true",
          paidAdvertisingAllowed: "false",
          imageToVideoAllowed: "false",
          referenceToVideoAllowed: "false",
          rightsExpiresAt: "",
        },
  ))
    d.set(k, v);
  return d;
};
for (const op of ["register", "review"]) {
  const run = () =>
    op === "register"
      ? registerProductMediaAction({ status: "idle", message: "" }, form(op))
      : reviewProductMediaAction({ status: "idle", message: "" }, form(op));
  for (const err of [
    new Error(privateValue),
    { name: "VideoDraftAccessError", message: privateValue },
    Object.assign(new Error(privateValue), { name: "VideoDraftAccessError", cause: privateValue }),
  ]) {
    failure = err;
    assert.deepEqual(await run(), {
      status: "error",
      message: "无法保存产品媒体，请刷新并确认资料、登录与项目权限后重试。",
    });
  }
  failure = Object.assign(new VideoDraftAccessError(), {
    message: privateValue,
    cause: privateValue,
  });
  const denied = {
    status: "error",
    message: "无法确认当前登录或产品媒体权限，本次请求未提交。请重新登录并确认项目权限后重试。",
  };
  assert.deepEqual(await run(), denied);
  const before = attempts;
  authorized = false;
  assert.deepEqual(await run(), denied);
  assert.equal(attempts, before);
  authorized = true;
  failure = undefined;
  assert.deepEqual(await run(), {
    status: "success",
    message:
      op === "register"
        ? "产品媒体已登记并完成技术探测，等待管理员审核权利与内容。"
        : "产品媒体已批准，可按其授权范围进入营销视频。",
    productId,
    assetId,
  });
}
mock.restoreAll();
console.log(
  "PASS actual ProductMedia Actions forward mandatory current identity, redact private errors and return minimal results",
);
