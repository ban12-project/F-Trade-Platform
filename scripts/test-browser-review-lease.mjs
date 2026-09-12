import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { localDeadline, prepareClaimBeforeStart } from "../ops/browser-node/lease.mjs";

const result = {
  serverNow: 1_000,
  roundTripMs: 120,
  run: { id: randomUUID(), leaseId: randomUUID(), leaseUntil: 91_000 },
};
test("local deadline subtracts network delay and safety margin, independent of wallclock skew", () => {
  const before = Date.now();
  const deadline = localDeadline(result, result.run.leaseUntil);
  assert.ok(deadline >= before + 84_800 && deadline <= Date.now() + 84_880);
  assert.throws(() => localDeadline({ ...result, roundTripMs: 90_000 }, result.run.leaseUntil));
});
test("invalid claim metadata releases the remote reservation without starting Docker", async () => {
  let stopped;
  const prepared = await prepareClaimBeforeStart(
    result,
    () => {
      throw new Error("malformed proxy");
    },
    async (v) => {
      stopped = v;
    },
  );
  assert.equal(prepared, null);
  assert.deepEqual(stopped, {
    runId: result.run.id,
    leaseId: result.run.leaseId,
    stopped: true,
    outcome: "failed",
  });
});
test("lost stop acknowledgement propagates so the caller retains its claim id", async () => {
  await assert.rejects(
    prepareClaimBeforeStart(
      result,
      () => {
        throw new Error("expired");
      },
      async () => {
        throw new Error("network unavailable");
      },
    ),
    /network unavailable/,
  );
});
test("valid preparation never releases a live reservation", async () => {
  const prepared = await prepareClaimBeforeStart(
    result,
    () => ({ spec: "synthetic" }),
    async () => {
      assert.fail("unexpected release");
    },
  );
  assert.deepEqual(prepared, { spec: "synthetic" });
});
