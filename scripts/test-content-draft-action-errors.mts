import assert from "node:assert/strict";
import { mock } from "node:test";
import {
  CONTENT_DRAFT_ACCESS_MESSAGE,
  ContentDraftAccessError,
} from "../lib/content/draft-write-access";

const secret = "SYNTHETIC private SQL, content value, source URL and credential";
let authorized = true;
let failure: unknown = new Error(secret);
let boundaryFailure: unknown;
let attempts = 0;
let refreshes = 0;
const moduleUrl = (path: string) => new URL(path, import.meta.url).href;
mock.module(moduleUrl("../lib/action-boundary.ts"), {
  exports: {
    authorizedActionSession: async (permission: string) => {
      assert.equal(permission, "content:write");
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
    assertWorkspaceProjectKind: async () => {
      if (boundaryFailure) throw boundaryFailure;
    },
    assertWorkspaceAggregateLink: async () => {
      if (boundaryFailure) throw boundaryFailure;
    },
  },
});
const projectId = "11111111-1111-4111-8111-111111111111";
mock.module(moduleUrl("../lib/content/store.ts"), {
  exports: {
    copyContentDraftToProject: async () => {},
    reviseContentDraft: async () => {},
    createContentDraft: async (_input: unknown, identity: unknown) => {
      attempts++;
      assert.deepEqual(identity, {
        actorId: "synthetic-reviewer",
        sessionId: "synthetic-session",
        projectId,
      });
      if (failure) throw failure;
      return { id: "synthetic-content-id" };
    },
  },
});
const { createContentDraftAction } = await import("../lib/actions/content");
const form = new FormData();
for (const [key, value] of Object.entries({
  projectId,
  productId: "22222222-2222-4222-8222-222222222222",
  contentType: "product",
  factPath: "product.product_name",
  objective: "SYNTHETIC objective",
  targetCustomer: "SYNTHETIC buyer",
  hook: "SYNTHETIC hook",
  body: "SYNTHETIC body",
  callToAction: "SYNTHETIC contact",
  hashtags: "#Synthetic",
  visualInstruction: "SYNTHETIC text card",
}))
  form.set(key, value);
const run = () => createContentDraftAction({ status: "idle", message: "" }, form);
const generic = "无法创建内容草稿，请刷新并确认来源、登录与项目权限后重试。";
for (const error of [
  new Error(secret),
  Object.assign(new Error(secret), { code: "review_access_changed", cause: new Error(secret) }),
  { name: "ContentDraftAccessError", message: secret },
  Object.assign(new Error(secret), { name: "ContentDraftAccessError" }),
]) {
  failure = error;
  assert.deepEqual(await run(), { status: "error", message: generic });
}
failure = Object.assign(new ContentDraftAccessError(), {
  message: secret,
  cause: new Error(secret),
});
assert.deepEqual(await run(), { status: "error", message: CONTENT_DRAFT_ACCESS_MESSAGE });
for (const message of [
  "只能引用已通过 Gate 01 的产品。",
  "所选产品字段没有已核验的证据，不能用于内容。",
]) {
  failure = new Error(message);
  assert.deepEqual(await run(), { status: "error", message });
}
failure = new Error(`视觉说明不能声称或描绘工程事实：${secret}。`);
assert.deepEqual(await run(), {
  status: "error",
  message: "视觉说明不能声称或描绘工程事实，请核对已授权素材。",
});
const afterControlledGuidance = attempts;
boundaryFailure = new Error(secret);
assert.deepEqual(await run(), { status: "error", message: generic });
assert.equal(attempts, afterControlledGuidance);
boundaryFailure = undefined;
form.delete("projectId");
assert.deepEqual(await run(), { status: "error", message: generic });
assert.equal(attempts, afterControlledGuidance);
form.set("projectId", projectId);
assert.equal(refreshes, 0);
authorized = false;
assert.deepEqual(await run(), { status: "error", message: "无权创建内容草稿。" });
assert.equal(attempts, afterControlledGuidance);
authorized = true;
failure = undefined;
assert.deepEqual(await run(), {
  status: "success",
  message: "内容草稿已创建（syntheti），仍需 Gate 01 人工审核。",
  contentId: "synthetic-content-id",
});
assert.equal(refreshes, 1);
console.log(
  "PASS actual manual content creation Action redacts unknown/private errors, preserves controlled guidance and forwards current identity",
);
