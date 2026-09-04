import assert from "node:assert/strict";
import {
  beginVideoJob,
  cancelVideoJob,
  completeVideoJob,
  createVideoJob,
  failVideoJob,
} from "../lib/video/jobs";

const queued = createVideoJob("job-1", "idempotency-1");
const running = beginVideoJob(queued, "provider-job-1");
assert.equal(completeVideoJob(running).status, "succeeded");
assert.equal(failVideoJob(running, "timeout", true).status, "queued");
assert.equal(cancelVideoJob(queued).status, "cancelled");
assert.throws(() => cancelVideoJob(completeVideoJob(running)), /Terminal/);
console.log("PASS video job state machine");
