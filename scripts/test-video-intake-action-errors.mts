import assert from "node:assert/strict";
import { mock } from "node:test";
import * as access from "../lib/video/draft-write-access";

const moduleUrl = (p: string) => new URL(p, import.meta.url).href;
const projectId = "11111111-1111-4111-8111-111111111111",
  videoId = "22222222-2222-4222-8222-222222222222",
  mediaId = "33333333-3333-4333-8333-333333333333";
const privateValue = "SYNTHETIC private SQL, media URL, credentials and source facts";
const identity = { actorId: "synthetic-writer", sessionId: "synthetic-session", projectId };
let authorized = true,
  attempts = 0,
  refreshes = 0;
let failure: unknown, boundaryFailure: unknown;
const job = { status: "running", id: "synthetic-job", videoProjectId: videoId };
const assets = [
  {
    assetRef: "evidence-synthetic-media",
    mediaType: "image",
    rightsEvidenceRef: "evidence-synthetic-rights",
  },
];
const authorize = async () => {
  if (boundaryFailure) throw boundaryFailure;
};
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
    authorizedActionSession: async () =>
      authorized ? { user: { id: identity.actorId }, session: { id: identity.sessionId } } : null,
    refreshWorkspace: () => {
      refreshes++;
    },
  },
});
mock.module(moduleUrl("../lib/db/client.ts"), {
  exports: {
    getDatabase: () => ({
      transaction: async (callback: (tx: unknown) => Promise<void>) =>
        callback({
          select: (fields: Record<string, unknown>) => {
            const rows = [
              {
                id: "synthetic",
                kind: "marketing",
                status: "active",
                role: fields.expiresAt ? "user" : "editor",
                banned: false,
                expiresAt: new Date(Date.now() + 3600000),
              },
            ];
            const q = {
              from: () => q,
              innerJoin: () => q,
              where: () => q,
              for: async () => rows,
              // biome-ignore lint/suspicious/noThenProperty: Drizzle query adapter intentionally exposes an awaitable chain.
              then: (resolve: (v: unknown) => unknown) => resolve(rows),
            };
            return q;
          },
        }),
    }),
  },
});
mock.module(moduleUrl("../lib/workspace/store.ts"), {
  exports: { assertWorkspaceAggregateLink: authorize },
});
mock.module(moduleUrl("../lib/video/store.ts"), {
  exports: {
    assertMarketingVideoProjectLink: authorize,
    copyMarketingVideoDraftToProject: async () => {},
    updateMarketingVideoEditDraft: async () => {},
    saveMarketingVideoRenderRequest: async () => {},
    createMarketingVideoEditProject: async (
      _input: unknown,
      value: unknown,
      inputAssets: unknown,
    ) => {
      attempts++;
      assert.deepEqual(value, identity);
      assert.deepEqual(inputAssets, assets);
      if (failure) throw failure;
      return { id: videoId, processingJob: job, privateValue };
    },
  },
});
mock.module(moduleUrl("../lib/video/product-media-create.ts"), {
  exports: {
    createMarketingVideoEditProjectFromProductMedia: async (_input: unknown, value: unknown) => {
      attempts++;
      assert.deepEqual(value, identity);
      if (failure) throw failure;
      return { id: videoId, processingJob: job, privateValue };
    },
  },
});
mock.module(moduleUrl("../lib/video/upload-receipts.ts"), {
  exports: {
    claimCompletedVideoUploads: async (ids: unknown, value: unknown, rights: unknown) => {
      assert.deepEqual(ids, [mediaId]);
      assert.deepEqual(value, identity);
      assert.equal(rights, "evidence-synthetic-rights");
      return assets;
    },
  },
});
const searchSchema = (await import("../lib/video/internet-media-search"))
  .internetMediaSearchInputSchema;
mock.module(moduleUrl("../lib/video/internet-media-search.ts"), {
  exports: {
    internetMediaSearchInputSchema: searchSchema,
    importInternetVideoMedia: async (_input: unknown, value: unknown) => {
      assert.deepEqual(value, identity);
      return assets;
    },
    searchInternetVideoMedia: async () => {
      attempts++;
      if (failure) throw failure;
      return [];
    },
  },
});
mock.module(moduleUrl("../lib/video/processing-jobs.ts"), {
  exports: {
    attachVideoWorkflowRun: async () => {},
    releaseVideoWorkflowStart: async () => {},
    reserveVideoWorkflowStart: async () => {
      throw Error("Workflow dispatch forbidden in privacy test");
    },
    queueVideoProcessingJob: async (id: unknown, kind: unknown, value: unknown) => {
      attempts++;
      assert.equal(id, videoId);
      assert.equal(kind, "ai_draft");
      assert.deepEqual(value, identity);
      if (failure) throw failure;
      return { job };
    },
  },
});
mock.module(moduleUrl("../workflows/marketing-video-processing.ts"), {
  exports: {
    generateMarketingVideoAiDraftWorkflow: async () => {},
    renderMarketingVideoPreviewWorkflow: async () => {},
  },
});
const actions = await import("../lib/actions/marketing-video");
const form = (mode: string) => {
  const d = new FormData();
  for (const [k, v] of Object.entries({
    projectId,
    productId: videoId,
    factPath: "product.product_name",
    objective: "SYNTHETIC objective",
    targetAudience: "SYNTHETIC buyers",
    platform: "facebook",
    sourceMode: mode,
    rightsEvidenceRef: mode === "upload" ? "evidence-synthetic-rights" : "",
    productMediaIds: JSON.stringify([mediaId]),
    receiptIds: JSON.stringify([mediaId]),
    internetSearchQuery: "SYNTHETIC",
    internetMediaIds: JSON.stringify(["wikimedia:123"]),
  }))
    d.set(k, v);
  return d;
};
for (const mode of ["product_media", "upload", "internet_search", "generate", "search"]) {
  const run = () =>
    mode === "generate"
      ? actions.generateMarketingVideoAiDraftAction(projectId, videoId)
      : mode === "search"
        ? actions.searchInternetVideoMediaAction({
            projectId,
            productId: videoId,
            query: "SYNTHETIC",
          })
        : actions.createMarketingVideoDraftAction({ status: "idle", message: "" }, form(mode));
  const generic = access.videoDraftFailureMessage(
    new Error(privateValue),
    mode === "generate" ? "generate" : mode === "search" ? "search" : "create",
  );
  const expected = (message: string) => ({
    status: "error",
    message,
    ...(mode === "search" ? { results: [] } : {}),
  });
  for (const err of [
    new Error(privateValue),
    { name: "VideoDraftAccessError", message: privateValue },
    Object.assign(new Error(privateValue), { name: "VideoDraftAccessError", cause: privateValue }),
  ]) {
    failure = err;
    assert.deepEqual(await run(), expected(generic));
  }
  failure = Object.assign(new access.VideoDraftAccessError(), {
    message: privateValue,
    cause: privateValue,
  });
  assert.deepEqual(await run(), expected(access.VIDEO_DRAFT_ACCESS_MESSAGE));
  const before = attempts;
  boundaryFailure = new Error(privateValue);
  assert.deepEqual(await run(), expected(generic));
  assert.equal(attempts, before);
  boundaryFailure = undefined;
  authorized = false;
  assert.deepEqual(await run(), expected(access.VIDEO_DRAFT_ACCESS_MESSAGE));
  assert.equal(attempts, before);
  authorized = true;
  const bad =
    mode === "generate"
      ? await actions.generateMarketingVideoAiDraftAction("invalid", videoId)
      : mode === "search"
        ? await actions.searchInternetVideoMediaAction({
            projectId,
            productId: videoId,
            query: privateValue.repeat(100),
          })
        : await actions.createMarketingVideoDraftAction(
            { status: "idle", message: "" },
            form("invalid"),
          );
  assert.deepEqual(bad, expected(generic));
  assert.equal(attempts, before);
  failure = undefined;
  const result = await run();
  assert.equal(result.status, "success");
  assert.deepEqual(
    Object.keys(result).sort(),
    mode === "search" ? ["message", "results", "status"] : ["message", "status", "videoId"],
  );
}
assert.equal(refreshes, 4);
mock.restoreAll();
console.log(
  "PASS actual video creation modes, AI submission and search Actions carry mandatory current identity, validate inputs, redact private errors and return minimal results",
);
