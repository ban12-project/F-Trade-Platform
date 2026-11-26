import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { nodeRequestSchema } from "../lib/browser-fleet/contracts";
import { publicationStepProgress } from "../lib/social/publication-presentation";

const textQueued = publicationStepProgress({
  format: "text",
  status: "submitted",
  jobStatus: "queued",
});
assert.equal(textQueued.totalSteps, 6);
assert.equal(textQueued.completedSteps, 0);
assert.equal(textQueued.tone, "progressing");
assert.equal(textQueued.steps[0].status, "active");

const videoClaimed = publicationStepProgress({
  format: "video",
  status: "submitted",
  jobStatus: "claimed",
  executionStage: "launch",
});
assert.equal(videoClaimed.totalSteps, 7);
assert.equal(videoClaimed.completedSteps, 1);
assert.equal(videoClaimed.steps[0].status, "completed");
assert.equal(videoClaimed.steps[1].id, "browser");
assert.equal(videoClaimed.steps[1].status, "active");

const videoMedia = publicationStepProgress({
  format: "video",
  status: "submitted",
  jobStatus: "claimed",
  executionStage: "media",
});
assert.equal(videoMedia.completedSteps, 3);
assert.equal(videoMedia.steps[3].id, "media");
assert.equal(videoMedia.steps[3].status, "active");

const videoPrepare = publicationStepProgress({
  format: "video",
  status: "submitted",
  jobStatus: "claimed",
  executionStage: "prepare",
});
assert.equal(videoPrepare.completedSteps, 4);
assert.equal(videoPrepare.steps[4].id, "prepare");
assert.equal(videoPrepare.steps[4].status, "active");

const videoPublishing = publicationStepProgress({
  format: "video",
  status: "submitted",
  jobStatus: "claimed",
  hasAuthorization: true,
  executionStage: "observe",
});
assert.equal(videoPublishing.completedSteps, 5);
assert.equal(videoPublishing.steps[5].id, "publish");
assert.equal(videoPublishing.steps[5].status, "active");
assert.match(videoPublishing.steps[5].detail ?? "", /已授权点击发布/);

const publishedAuto = publicationStepProgress({
  format: "video",
  status: "published",
  humanConfirmed: false,
});
assert.equal(publishedAuto.completedSteps, 7);
assert.equal(publishedAuto.percent, 100);
assert.equal(publishedAuto.tone, "complete");
assert.equal(publishedAuto.steps[6].detail, "已取得平台回执链接");

const publishedHuman = publicationStepProgress({
  format: "text",
  status: "published",
  humanConfirmed: true,
});
assert.equal(publishedHuman.completedSteps, 6);
assert.equal(publishedHuman.steps[5].detail, "已由人工核对确认");

const preflightRejected = publicationStepProgress({
  format: "video",
  status: "paused",
  jobStatus: "paused",
  failureCode: "fleet_publication_preflight_rejected",
});
assert.equal(preflightRejected.completedSteps, 0);
assert.equal(preflightRejected.tone, "failed");
assert.equal(preflightRejected.steps[0].status, "failed");
assert.match(preflightRejected.steps[0].detail ?? "", /未向平台发送/);

const launchFailed = publicationStepProgress({
  format: "video",
  status: "failed",
  jobStatus: "paused",
  failureCode: "fleet_publication_not_authorized",
});
assert.equal(launchFailed.completedSteps, 1);
assert.equal(launchFailed.steps[1].id, "browser");
assert.equal(launchFailed.steps[1].status, "failed");

const mediaFailed = publicationStepProgress({
  format: "video",
  status: "failed",
  jobStatus: "paused",
  failureCode: "fleet_publication_not_authorized:media:publication_media_response_invalid",
});
assert.equal(mediaFailed.completedSteps, 3);
assert.equal(mediaFailed.steps[3].id, "media");
assert.equal(mediaFailed.steps[3].status, "failed");

const prepareFailed = publicationStepProgress({
  format: "video",
  status: "failed",
  jobStatus: "paused",
  failureCode: "fleet_publication_not_authorized:prepare:facebook_matching_post_already_exists",
});
assert.equal(prepareFailed.completedSteps, 4);
assert.equal(prepareFailed.steps[4].id, "prepare");
assert.equal(prepareFailed.steps[4].status, "failed");

const unknownResult = publicationStepProgress({
  format: "text",
  status: "unknown",
});
assert.equal(unknownResult.completedSteps, 4);
assert.equal(unknownResult.tone, "warning");
assert.equal(unknownResult.steps[4].id, "publish");
assert.equal(unknownResult.steps[4].status, "warning");
assert.equal(unknownResult.steps[5].status, "pending");

assert.equal(
  nodeRequestSchema.safeParse({
    operation: "heartbeat",
    installationId: randomUUID(),
    bootId: randomUUID(),
    runId: randomUUID(),
    leaseId: randomUUID(),
    ready: true,
    publicationStage: "prepare",
  }).success,
  true,
);
assert.equal(
  nodeRequestSchema.safeParse({
    operation: "heartbeat",
    installationId: randomUUID(),
    bootId: randomUUID(),
    runId: randomUUID(),
    leaseId: randomUUID(),
    ready: true,
    publicationStage: "invalid_stage",
  }).success,
  false,
);

console.log("PASS publication step progress mapping and heartbeat stage schema");
