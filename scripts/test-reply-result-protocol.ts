import assert from "node:assert/strict";

import {
  replyResultSchema,
  signReplyWorkerResult,
  verifyReplyWorkerResult,
} from "../lib/social/reply-result-protocol";

process.env.SOCIAL_WORKER_SIGNING_KEY = Buffer.alloc(32, 9).toString("base64");
const now = new Date("2026-09-04T09:00:00.000Z");
const result = {
  workerId: "synthetic-worker-001",
  jobId: "20000000-0000-4000-8000-000000000001",
  outcome: "sent" as const,
  externalMessageRef: "synthetic-message-001",
  observedAt: now.toISOString(),
};
const signed = signReplyWorkerResult(result);
assert.deepEqual(verifyReplyWorkerResult(signed, result.workerId, now), result);
assert.throws(
  () =>
    verifyReplyWorkerResult(
      { ...signed, signature: `${signed.signature.slice(0, -1)}x` },
      result.workerId,
      now,
    ),
  /signature/,
);
assert.throws(
  () => signReplyWorkerResult({ ...result, outcome: "failed", externalMessageRef: undefined }),
  /failure code/,
);
assert.throws(
  () => replyResultSchema.parse({ jobId: result.jobId, outcome: "sent" }),
  /external message reference/,
);
assert.equal(
  replyResultSchema.parse({
    jobId: result.jobId,
    outcome: "unknown",
    failureCode: "external_result_unknown",
  }).outcome,
  "unknown",
);
console.log("PASS signed reply result protocol");
