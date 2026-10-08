import assert from "node:assert/strict";
import type { Database } from "../lib/db/client";
import { videoProcessingFailureMessage } from "../lib/video/processing-failures";
import { failVideoJob, latestVideoProcessingJobs } from "../lib/video/processing-jobs";

void (async () => {
  const secret = "https://private.example.invalid/source.png?token=SYNTHETIC-SECRET";
  let saved: Record<string, unknown> | undefined;
  const chain = {
    set(value: Record<string, unknown>) {
      saved = value;
      return this;
    },
    where() {
      return this;
    },
    async returning() {
      return [];
    },
  };
  const selectChain = {
    from() {
      return this;
    },
    where() {
      return this;
    },
    for() {
      return this;
    },
    // biome-ignore lint/suspicious/noThenProperty: matches Drizzle's awaitable query in this privacy test.
    then(resolve: (rows: Array<{ videoId: string; id: string }>) => unknown) {
      return Promise.resolve(resolve([{ videoId: "synthetic-video", id: "synthetic-video" }]));
    },
  };
  const writeDb = {
    transaction: async (callback: (tx: unknown) => Promise<void>) =>
      callback({ update: () => chain, select: () => selectChain }),
  } as unknown as Database;
  await failVideoJob("synthetic-job", "RENDER_FAILED", writeDb);
  assert.equal(saved?.failureMessage, videoProcessingFailureMessage("RENDER_FAILED"));
  await failVideoJob("synthetic-source-job", "AI_DRAFT_SOURCE_INVALID", writeDb);
  assert.equal(
    saved?.failureMessage,
    "无法确认产品事实或素材授权，AI 初稿未保存。请核对来源后重试。",
  );
  const rows = [
    {
      id: "render",
      videoProjectId: "video-1",
      kind: "render",
      status: "failed",
      failureCode: "RENDER_FAILED",
      failureMessage: `Error loading image with src: ${secret}`,
    },
    {
      id: "draft",
      videoProjectId: "video-2",
      kind: "ai_draft",
      status: "failed",
      failureCode: "AI_DRAFT_FAILED",
      failureMessage: secret,
    },
    {
      id: "stale",
      videoProjectId: "video-5",
      kind: "ai_draft",
      status: "failed",
      failureCode: "AI_DRAFT_STALE",
      failureMessage: secret,
    },
    {
      id: "source",
      videoProjectId: "video-6",
      kind: "ai_draft",
      status: "failed",
      failureCode: "AI_DRAFT_SOURCE_INVALID",
      failureMessage: secret,
    },
    {
      id: "legacy",
      videoProjectId: "video-3",
      kind: "render",
      status: "failed",
      failureCode: null,
      failureMessage: secret,
    },
    {
      id: "active",
      videoProjectId: "video-4",
      kind: "render",
      status: "running",
      failureCode: null,
      failureMessage: secret,
    },
  ];
  const readDb = {
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) }),
  } as unknown as Database;
  const result = await latestVideoProcessingJobs(
    rows.map((row) => row.videoProjectId),
    readDb,
  );
  assert.equal(
    result.get("video-1")?.failureMessage,
    videoProcessingFailureMessage("RENDER_FAILED"),
  );
  assert.equal(
    result.get("video-2")?.failureMessage,
    videoProcessingFailureMessage("AI_DRAFT_FAILED"),
  );
  assert.equal(result.get("video-3")?.failureMessage, videoProcessingFailureMessage(null));
  assert.equal(result.get("video-4")?.failureMessage, null);
  assert.equal(
    result.get("video-5")?.failureMessage,
    videoProcessingFailureMessage("AI_DRAFT_STALE"),
  );
  assert.equal(
    result.get("video-6")?.failureMessage,
    "无法确认产品事实或素材授权，AI 初稿未保存。请核对来源后重试。",
  );
  assert.equal(JSON.stringify([...result]).includes("SYNTHETIC-SECRET"), false);
  assert.equal(JSON.stringify([...result]).includes("private.example"), false);
  console.log(
    "PASS video failure privacy: safe persistence input and legacy summary projection without raw provider messages",
  );
})();
