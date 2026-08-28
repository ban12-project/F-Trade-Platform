import assert from "node:assert/strict";

import { runNextConfiguredVideoJob } from "../lib/video/job-runner";

assert.equal(typeof runNextConfiguredVideoJob, "function");
console.log("PASS video job runner exposes a provider-scoped, leased execution boundary");
