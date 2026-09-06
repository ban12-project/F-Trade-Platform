import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { nodeFormSchema, nodeRequestSchema, ownerCommandSchema } from "../lib/browser-fleet/contracts";
const installationId = randomUUID();
const bootId = randomUUID();
test("node protocol rejects arbitrary commands, OTPs and configuration injection", () => {
  for (const operation of ["reply", "evaluate", "exec", "cookies", "login"]) {
    assert.equal(nodeRequestSchema.safeParse({ operation, installationId, bootId }).success, false);
  }
  assert.equal(nodeRequestSchema.safeParse({ operation: "sync", installationId, bootId, otp: "123456" }).success, false);
  assert.equal(nodeRequestSchema.safeParse({ operation: "claim", installationId, bootId, requestId: randomUUID(), availableMemoryMb: 8192, localSlots: 4, image: "untrusted/image" }).success, false);
});
test("stop acknowledgement must explicitly confirm that the runtime stopped", () => {
  const input = { operation: "finish", installationId, bootId, runId: randomUUID(), leaseId: randomUUID(), outcome: "completed" };
  assert.equal(nodeRequestSchema.safeParse(input).success, false);
  assert.equal(nodeRequestSchema.safeParse({ ...input, stopped: false }).success, false);
  assert.equal(nodeRequestSchema.safeParse({ ...input, stopped: true }).success, true);
});
test("node limits and gateway origin are checked server-side", () => {
  const value = { name: "Synthetic node", gatewayOrigin: "https://browser.example", maxBrowsers: 1, memoryBudgetMb: 3072, browserMemoryMb: 2048 };
  assert.equal(nodeFormSchema.safeParse(value).success, true);
  assert.equal(nodeFormSchema.safeParse({ ...value, gatewayOrigin: "http://browser.example" }).success, false);
  assert.equal(nodeFormSchema.safeParse({ ...value, memoryBudgetMb: 1024 }).success, false);
  assert.equal(nodeFormSchema.safeParse({ ...value, maxBrowsers: 999 }).success, false);
});
test("owners cannot bypass publication approval by queueing a raw publish command", () => {
  assert.equal(ownerCommandSchema.safeParse({ operation: "publish", nodeId: randomUUID(), accountId: randomUUID(), text: "unreviewed" }).success, false);
});
