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
  const writeDb = {
    transaction: async (callback: (tx: unknown) => Promise<void>) =>
      callback({ update: () => chain }),
  } as unknown as Database;
  await failVideoJob("synthetic-job", "RENDER_FAILED", writeDb);
  assert.equal(saved?.failureMessage, videoProcessingFailureMessage("RENDER_FAILED"));
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
  assert.equal(JSON.stringify([...result]).includes("SYNTHETIC-SECRET"), false);
  assert.equal(JSON.stringify([...result]).includes("private.example"), false);
  console.log(
    "PASS video failure privacy: safe persistence input and legacy summary projection without raw provider messages",
  );
})();
