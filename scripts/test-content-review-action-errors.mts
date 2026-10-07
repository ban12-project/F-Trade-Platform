import assert from "node:assert/strict";
import { mock } from "node:test";
import {
  CONTENT_REVIEW_ACCESS_MESSAGE,
  ContentReviewAccessError,
} from "../lib/content/review-write-access";

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
      assert.equal(permission, "content:review");
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
const projectId = "11111111-1111-4111-8111-111111111111";
mock.module(moduleUrl("../lib/content/store.ts"), {
  exports: {
    createContentDraft: async () => {},
    copyContentDraftToProject: async () => {},
    reviseContentDraft: async () => {},
    decideContentReview: async (_input: unknown, identity: unknown) => {
      attempts++;
      assert.deepEqual(identity, {
        actorId: "synthetic-reviewer",
        sessionId: "synthetic-session",
        projectId,
      });
      if (failure) throw failure;
      return { state: "CONTENT_APPROVED" };
    },
  },
});
const { decideContentReviewAction } = await import("../lib/actions/content");
const form = new FormData();
for (const [key, value] of Object.entries({
  projectId,
  contentId: "22222222-2222-4222-8222-222222222222",
  approvalId: "33333333-3333-4333-8333-333333333333",
  reviewedVersion: "1",
  decision: "approved",
  evidenceRef: "evidence-synthetic-review",
  notes: "SYNTHETIC reviewer notes",
}))
  form.set(key, value);
const run = () => decideContentReviewAction({ status: "idle", message: "" }, form);
const generic = "无法完成内容审核，请刷新并确认来源、登录与项目权限后重试。";
for (const error of [
  new Error(secret),
  Object.assign(new Error(secret), { code: "review_access_changed", cause: new Error(secret) }),
  { name: "ContentReviewAccessError", message: secret },
  Object.assign(new Error(secret), { name: "ContentReviewAccessError" }),
]) {
  failure = error;
  assert.deepEqual(await run(), { status: "error", message: generic });
}
failure = Object.assign(new ContentReviewAccessError(), {
  message: secret,
  cause: new Error(secret),
});
assert.deepEqual(await run(), { status: "error", message: CONTENT_REVIEW_ACCESS_MESSAGE });
for (const message of [
  "内容已更新，请刷新后重新审核当前版本。",
  "部分证据不存在或无权用于当前项目。",
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
assert.deepEqual(await run(), { status: "error", message: "无权执行 Gate 01 内容审核。" });
assert.equal(attempts, beforeBoundary);
authorized = true;
failure = undefined;
assert.deepEqual(await run(), {
  status: "success",
  message: "Gate 01 已批准，内容等待官方渠道发布。",
});
assert.equal(refreshes, 1);
console.log(
  "PASS actual Gate 01 Action redacts unknown/private errors, preserves controlled guidance and forwards current identity",
);
