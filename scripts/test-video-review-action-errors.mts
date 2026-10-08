import assert from "node:assert/strict";
import { mock } from "node:test";
import {
  VIDEO_REVIEW_ACCESS_MESSAGE,
  VideoReviewAccessError,
} from "../lib/video/review-write-access";

const privateValue = "SYNTHETIC private SQL, media URL, source fact and credential";
const projectId = "11111111-1111-4111-8111-111111111111";
const videoId = "22222222-2222-4222-8222-222222222222";
let authorized = true,
  attempts = 0,
  refreshes = 0;
let failure: unknown = new Error(privateValue),
  boundaryFailure: unknown;
const moduleUrl = (path: string) => new URL(path, import.meta.url).href;
mock.module("next/cache", { exports: { revalidatePath: () => {} } });
mock.module(moduleUrl("../lib/action-boundary.ts"), {
  exports: {
    authorizedActionSession: async (permission: string) => {
      assert.equal(permission, "content:review");
      return authorized
        ? { user: { id: "synthetic-reviewer" }, session: { id: "synthetic-session" } }
        : null;
    },
    actionError: () => {
      throw new Error("Raw error formatter must not be used for review");
    },
    refreshWorkspace: () => {
      refreshes++;
    },
  },
});
mock.module(moduleUrl("../lib/video/store.ts"), {
  exports: {
    assertMarketingVideoProjectLink: async () => {
      if (boundaryFailure) throw boundaryFailure;
    },
    copyMarketingVideoDraftToProject: async () => {},
    createMarketingVideoEditProject: async () => {},
    updateMarketingVideoEditDraft: async () => {},
  },
});
mock.module(moduleUrl("../workflows/marketing-video-processing.ts"), {
  exports: {
    generateMarketingVideoAiDraftWorkflow: async () => {},
    renderMarketingVideoPreviewWorkflow: async () => {},
  },
});
mock.module(moduleUrl("../lib/video/product-media-guarded-operations.ts"), {
  exports: {
    decideGuardedVideoReview: async (_input: unknown, identity: unknown) => {
      attempts++;
      assert.deepEqual(identity, {
        actorId: "synthetic-reviewer",
        sessionId: "synthetic-session",
        projectId,
      });
      if (failure) throw failure;
    },
  },
});
const { reviewMarketingVideoAction } = await import("../lib/actions/marketing-video");
const run = () =>
  reviewMarketingVideoAction(
    projectId,
    videoId,
    "approved",
    "evidence-synthetic-review",
    "SYNTHETIC notes",
  );
const generic = "无法完成视频审核，请刷新并确认来源、登录与项目权限后重试。";
for (const error of [
  new Error(privateValue),
  { name: "VideoReviewAccessError", message: privateValue },
  Object.assign(new Error(privateValue), {
    name: "VideoReviewAccessError",
    cause: new Error(privateValue),
  }),
]) {
  failure = error;
  assert.deepEqual(await run(), { status: "error", message: generic });
}
failure = Object.assign(new VideoReviewAccessError(), {
  message: privateValue,
  cause: new Error(privateValue),
});
assert.deepEqual(await run(), { status: "error", message: VIDEO_REVIEW_ACCESS_MESSAGE });
failure = new Error("部分证据不存在或无权用于当前项目。");
assert.deepEqual(await run(), { status: "error", message: failure.message });
const before = attempts;
boundaryFailure = new Error(privateValue);
assert.deepEqual(await run(), { status: "error", message: generic });
assert.equal(attempts, before);
boundaryFailure = undefined;
assert.deepEqual(
  await reviewMarketingVideoAction("invalid", videoId, "approved", "evidence-synthetic-review"),
  { status: "error", message: generic },
);
assert.equal(attempts, before);
for (const [id, decision, evidence] of [
  ["invalid", "approved", "evidence-synthetic-review"],
  [videoId, "untrusted-decision", "evidence-synthetic-review"],
  [videoId, "approved", privateValue],
] as const) {
  assert.deepEqual(
    await reviewMarketingVideoAction(projectId, id, decision as "approved", evidence),
    { status: "error", message: generic },
  );
  assert.equal(attempts, before);
}
authorized = false;
assert.deepEqual(await run(), { status: "error", message: VIDEO_REVIEW_ACCESS_MESSAGE });
assert.equal(attempts, before);
assert.equal(refreshes, 0);
authorized = true;
failure = undefined;
assert.deepEqual(await run(), {
  status: "success",
  message: "成片已通过人工审核；不会自动发布。",
  videoId,
});
assert.equal(refreshes, 1);
mock.restoreAll();
console.log(
  "PASS actual video review Action forwards current identity, returns minimal results and redacts private/unknown errors",
);
