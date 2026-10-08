import assert from "node:assert/strict";
import { mock } from "node:test";
import { VIDEO_DRAFT_ACCESS_MESSAGE, VideoDraftAccessError } from "../lib/video/draft-write-access";
import { marketingVideoDraftSchema } from "../lib/video/edit-contracts";

const privateValue = "SYNTHETIC private SQL, source media, product fact and credential";
const projectId = "11111111-1111-4111-8111-111111111111",
  videoId = "22222222-2222-4222-8222-222222222222";
const copiedId = "33333333-3333-4333-8333-333333333333";
const draft = marketingVideoDraftSchema.parse({
  version: 3,
  creativeFramework: "google_abcd",
  platform: "facebook",
  ctaText: "SYNTHETIC contact",
  clips: [
    {
      clipId: "clip-synthetic",
      assetRef: "evidence-synthetic-image",
      mediaType: "image",
      trimStartMs: 0,
      durationMs: 3000,
      fitMode: "contain",
      audioMode: "muted",
      caption: { kind: "none" },
      abcdRoles: ["attention", "branding", "connection", "direction"],
      motionPreset: "cta_hold",
    },
  ],
});
let authorized = true,
  attempts = 0,
  refreshes = 0,
  jobs = 0;
let failure: unknown = new Error(privateValue),
  boundaryFailure: unknown;
const moduleUrl = (path: string) => new URL(path, import.meta.url).href;
const expectedIdentity = { actorId: "synthetic-writer", sessionId: "synthetic-session", projectId };
mock.module("workflow/api", {
  exports: {
    start: async () => {
      throw Error("External Workflow execution forbidden in Action privacy tests");
    },
  },
});
mock.module("next/cache", { exports: { revalidatePath: () => {} } });
mock.module(moduleUrl("../lib/action-boundary.ts"), {
  exports: {
    authorizedActionSession: async (permission: string) => {
      assert.equal(permission, "video:write");
      return authorized
        ? { user: { id: expectedIdentity.actorId }, session: { id: expectedIdentity.sessionId } }
        : null;
    },
    actionError: () => {
      throw new Error("Raw error formatter must not be used for video draft writes");
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
    createMarketingVideoEditProject: async () => {},
    saveMarketingVideoRenderRequest: async (id: string, value: unknown, identity: unknown) => {
      attempts++;
      assert.equal(id, videoId);
      assert.deepEqual(value, draft);
      assert.deepEqual(identity, expectedIdentity);
      if (failure) throw failure;
      jobs++;
      return { status: "running", id: "synthetic-job" };
    },
    updateMarketingVideoEditDraft: async (id: string, value: unknown, identity: unknown) => {
      attempts++;
      assert.equal(id, videoId);
      assert.deepEqual(value, draft);
      assert.deepEqual(identity, expectedIdentity);
      if (failure) throw failure;
      return { privateValue };
    },
    copyMarketingVideoDraftToProject: async (id: string, identity: unknown) => {
      attempts++;
      assert.equal(id, videoId);
      assert.deepEqual(identity, expectedIdentity);
      if (failure) throw failure;
      return { id: copiedId, project: { privateValue } };
    },
  },
});
mock.module(moduleUrl("../lib/video/processing-jobs.ts"), {
  exports: {
    attachVideoWorkflowRun: async () => {},
    releaseVideoWorkflowStart: async () => {},
    reserveVideoWorkflowStart: async () => {
      throw Error("Workflow start forbidden in privacy test");
    },
    queueVideoProcessingJob: async () => {
      jobs++;
      return { job: { status: "running", id: "synthetic-job" } };
    },
  },
});
mock.module(moduleUrl("../workflows/marketing-video-processing.ts"), {
  exports: {
    generateMarketingVideoAiDraftWorkflow: async () => {},
    renderMarketingVideoPreviewWorkflow: async () => {},
  },
});
const {
  saveMarketingVideoDraftAction,
  copyMarketingVideoDraftAction,
  renderMarketingVideoDraftAction,
} = await import("../lib/actions/marketing-video");
for (const op of ["save", "copy", "render"] as const) {
  const run = () =>
    op === "copy"
      ? copyMarketingVideoDraftAction(projectId, videoId)
      : op === "save"
        ? saveMarketingVideoDraftAction(projectId, videoId, draft)
        : renderMarketingVideoDraftAction(projectId, videoId, draft);
  const generic = `无法${op === "copy" ? "复制营销视频" : op === "render" ? "合成营销视频" : "保存剪辑稿"}，请刷新并确认来源、登录与项目权限后重试。`;
  for (const error of [
    new Error(privateValue),
    { name: "VideoDraftAccessError", message: privateValue },
    Object.assign(new Error(privateValue), {
      name: "VideoDraftAccessError",
      cause: new Error(privateValue),
    }),
  ]) {
    failure = error;
    assert.deepEqual(await run(), { status: "error", message: generic });
  }
  failure = Object.assign(new VideoDraftAccessError(), {
    message: privateValue,
    cause: new Error(privateValue),
  });
  assert.deepEqual(await run(), { status: "error", message: VIDEO_DRAFT_ACCESS_MESSAGE });
  failure = new Error("剪辑稿引用了不属于当前视频的素材。");
  assert.deepEqual(await run(), { status: "error", message: failure.message });
  const before = attempts;
  boundaryFailure = new Error(privateValue);
  if (op !== "copy") {
    assert.deepEqual(await run(), { status: "error", message: generic });
    assert.equal(attempts, before);
  }
  boundaryFailure = undefined;
  const invalid =
    op === "copy"
      ? await copyMarketingVideoDraftAction("invalid", videoId)
      : op === "save"
        ? await saveMarketingVideoDraftAction("invalid", videoId, draft)
        : await renderMarketingVideoDraftAction("invalid", videoId, draft);
  assert.deepEqual(invalid, { status: "error", message: generic });
  assert.equal(attempts, before);
  if (op !== "copy") {
    const badDraft = { ...draft, ctaText: privateValue.repeat(100) };
    assert.deepEqual(
      op === "save"
        ? await saveMarketingVideoDraftAction(projectId, videoId, badDraft)
        : await renderMarketingVideoDraftAction(projectId, videoId, badDraft),
      { status: "error", message: generic },
    );
    assert.equal(attempts, before);
  }
  authorized = false;
  assert.deepEqual(await run(), { status: "error", message: VIDEO_DRAFT_ACCESS_MESSAGE });
  assert.equal(attempts, before);
  authorized = true;
  failure = undefined;
  const result = await run();
  assert.equal(result.status, "success");
  assert.deepEqual(Object.keys(result).sort(), ["message", "status", "videoId"]);
  assert.equal(result.videoId, op === "copy" ? copiedId : videoId);
}
assert.equal(refreshes, 3);
assert.equal(jobs, 1);
mock.restoreAll();
console.log(
  "PASS actual save/copy/render-save Actions validate inputs and current identity, redact private errors, return minimal results and never queue denied writes",
);
