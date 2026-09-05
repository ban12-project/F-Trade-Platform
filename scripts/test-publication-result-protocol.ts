import assert from "node:assert/strict";

import {
  signPublicationWorkerResult,
  verifyPublicationWorkerResult,
} from "../lib/social/publication-result-protocol";

process.env.SOCIAL_WORKER_SIGNING_KEY = Buffer.alloc(32, 7).toString("base64");
const now = new Date("2026-09-04T08:00:00.000Z");
const result = {
  workerId: "synthetic-worker-001",
  jobId: "10000000-0000-4000-8000-000000000001",
  outcome: "published" as const,
  externalPublicationRef: "synthetic-platform-post-001",
  observedAt: now.toISOString(),
};
const signed = signPublicationWorkerResult(result);
assert.deepEqual(verifyPublicationWorkerResult(signed, result.workerId, now), result);
assert.throws(
  () =>
    verifyPublicationWorkerResult(
      { ...signed, signature: `${signed.signature.slice(0, -1)}x` },
      result.workerId,
      now,
    ),
  /signature/,
);
assert.throws(
  () => verifyPublicationWorkerResult(signed, "other-worker", now),
  /unexpected worker/,
);
assert.throws(
  () =>
    verifyPublicationWorkerResult(
      signed,
      result.workerId,
      new Date(now.getTime() + 5 * 60_000 + 1),
    ),
  /expired/,
);
assert.throws(
  () =>
    signPublicationWorkerResult({
      ...result,
      outcome: "unknown",
      externalPublicationRef: undefined,
    }),
  /failure code/,
);
console.log("PASS signed publication result protocol");
