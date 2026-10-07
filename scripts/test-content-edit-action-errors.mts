import assert from "node:assert/strict";
import { mock } from "node:test";
import {
  CONTENT_DRAFT_ACCESS_MESSAGE,
  ContentDraftAccessError,
} from "../lib/content/draft-write-access";

const secret = "SYNTHETIC private SQL, source URL, content and credential";
const projectId = "11111111-1111-4111-8111-111111111111";
const contentId = "22222222-2222-4222-8222-222222222222";
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
        ? { user: { id: "synthetic-editor" }, session: { id: "synthetic-session" } }
        : null;
    },
    actionError: () => {
      throw new Error("Raw error boundary must not be used for content edits");
    },
    refreshWorkspace: (id: string) => {
      assert.equal(id, projectId);
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
function save(id: string, identity: unknown) {
  attempts++;
  assert.equal(id, contentId);
  assert.deepEqual(identity, {
    actorId: "synthetic-editor",
    sessionId: "synthetic-session",
    projectId,
  });
  if (failure) throw failure;
  return { id: "synthetic-copied-id" };
}
mock.module(moduleUrl("../lib/content/store.ts"), {
  exports: {
    createContentDraft: async () => {},
    decideContentReview: async () => {},
    reviseContentDraft: async (id: string, _input: unknown, identity: unknown) =>
      save(id, identity),
    copyContentDraftToProject: async (id: string, identity: unknown) => save(id, identity),
  },
});
const { reviseContentDraftAction, copyContentDraftToProjectAction } = await import(
  "../lib/actions/content"
);
for (const operation of ["revise", "copy"] as const) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    projectId,
    contentId,
    sourceContentId: contentId,
    productId: "33333333-3333-4333-8333-333333333333",
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
  const action =
    operation === "revise" ? reviseContentDraftAction : copyContentDraftToProjectAction;
  const run = () => action({ status: "idle", message: "" }, form);
  const generic =
    operation === "revise"
      ? "无法保存内容修订，请刷新并确认来源、登录与项目权限后重试。"
      : "无法复制内容草稿，请刷新并确认来源、登录与项目权限后重试。";
  const beforeRefresh = refreshes;
  for (const error of [
    new Error(secret),
    Object.assign(new Error(secret), { cause: new Error(secret), code: "content_access_changed" }),
    { name: "ContentDraftAccessError", message: secret },
    Object.assign(new Error(secret), { name: "ContentDraftAccessError" }),
    new Error(`该内容当前不处于待修订状态。${secret}`),
  ]) {
    failure = error;
    assert.deepEqual(await run(), { status: "error", message: generic });
  }
  failure = Object.assign(new ContentDraftAccessError(), {
    message: secret,
    cause: new Error(secret),
  });
  assert.deepEqual(await run(), { status: "error", message: CONTENT_DRAFT_ACCESS_MESSAGE });
  for (const message of operation === "revise"
    ? [
        "该内容当前不处于待修订状态。",
        "修订不能改写内容所引用的产品。请另建内容草稿。",
        "所选产品字段没有已核验的证据，不能用于内容。",
        "内容修订与另一项操作冲突，请刷新后重试。",
      ]
    : [
        "内容只能复制到产品营销项目。",
        "该内容已经属于当前项目。",
        "源内容不存在或没有明确归属。",
        "源内容引用的产品已不再可用于新草稿。",
      ]) {
    failure = new Error(message);
    assert.deepEqual(await run(), { status: "error", message });
  }
  failure = new Error(`视觉说明不能声称或描绘工程事实：${secret}。`);
  assert.deepEqual(await run(), {
    status: "error",
    message: "视觉说明不能声称或描绘工程事实，请核对已授权素材。",
  });
  const beforeBoundary = attempts;
  boundaryFailure = new Error(secret);
  assert.deepEqual(await run(), { status: "error", message: generic });
  assert.equal(attempts, beforeBoundary);
  boundaryFailure = undefined;
  form.delete("projectId");
  assert.equal((await run()).status, "error");
  assert.equal(attempts, beforeBoundary);
  form.set("projectId", projectId);
  assert.equal(refreshes, beforeRefresh);
  authorized = false;
  assert.deepEqual(await run(), {
    status: "error",
    message: operation === "revise" ? "无权修订内容草稿。" : "无权复制内容草稿。",
  });
  assert.equal(attempts, beforeBoundary);
  authorized = true;
  failure = undefined;
  assert.deepEqual(
    await run(),
    operation === "revise"
      ? { status: "success", message: "内容修订已保存，并已重新提交 Gate 01 审核。", contentId }
      : {
          status: "success",
          message: "已复制为当前项目的新待审草稿，原记录不会共享修改。",
          contentId: "synthetic-copied-id",
        },
  );
  assert.equal(refreshes, beforeRefresh + 1);
  console.log(
    `PASS actual ${operation} Action identity forwarding, controlled guidance, error privacy and refresh only on success`,
  );
}
