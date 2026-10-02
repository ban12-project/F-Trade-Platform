import assert from "node:assert/strict";
import { SelectionExecutionClock } from "../evals/harbor/product-agent/execution-health";

const normal = new SelectionExecutionClock(1000);
normal.observe(2000);
normal.observe(3050);
assert.equal(
  normal.assess([5000, 75020]).valid,
  true,
  "Normal model timeout remains a valid observation",
);
const suspended = new SelectionExecutionClock(1000);
suspended.observe(2000);
suspended.observe(1_700_000);
assert.equal(
  suspended.assess([5000]).valid,
  false,
  "Host suspension invalidates even otherwise short trials",
);
assert.equal(
  normal.assess([80502]).valid,
  false,
  "Observed deadline overrun cannot rank as model latency",
);
assert.equal(normal.assess([null]).valid, false);
assert.equal(normal.assess([Number.NaN]).valid, false);
const reversed = new SelectionExecutionClock(2000);
reversed.observe(1000);
assert.equal(reversed.assess([1000]).valid, false);
console.log(
  "PASS measurement validity: host sleep, clock reversal, deadline overrun and valid model timeouts",
);
