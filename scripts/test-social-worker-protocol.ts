import assert from "node:assert/strict";

import { signSocialWorkerCommand, verifySocialWorkerCommand, type WorkerNonceStore } from "../lib/social/worker-protocol";

process.env.SOCIAL_WORKER_SIGNING_KEY = Buffer.alloc(32, 13).toString("base64");

const claimed = new Set<string>();
const nonceStore: WorkerNonceStore = {
  async claim(workerId, nonce) {
    const key = `${workerId}:${nonce}`;
    if (claimed.has(key)) return false;
    claimed.add(key);
    return true;
  },
};
const now = new Date("2026-08-31T00:00:00.000Z");
const command = {
  commandId: "command-001",
  workerId: "worker-us-east-001",
  jobId: "job-001",
  kind: "publish" as const,
  payloadRef: "social-payload-001",
  nonce: "0123456789abcdefghijklmn-_",
  issuedAt: new Date("2026-08-30T23:59:00.000Z"),
  expiresAt: new Date("2026-08-31T00:04:00.000Z"),
};
async function main() {
  const signed = signSocialWorkerCommand(command);
  assert.equal((await verifySocialWorkerCommand(signed, command.workerId, nonceStore, now)).jobId, command.jobId);
  await assert.rejects(() => verifySocialWorkerCommand(signed, command.workerId, nonceStore, now), /already been used/);
  assert.throws(() => signSocialWorkerCommand({ ...command, nonce: "abcdefghijklmnopqrstuvwxyz012345-_", expiresAt: new Date("2026-08-31T00:06:00.000Z") }), /lifetime/);
  const tampered = signSocialWorkerCommand({ ...command, nonce: "zyxwvutsrqponmlkjihgfedc-_" });
  await assert.rejects(() => verifySocialWorkerCommand({ ...tampered, command: { ...tampered.command, payloadRef: "other-payload" } }, command.workerId, nonceStore, now), /signature/);
  console.log("PASS signed social worker commands reject replay, expiry, and tampering");
}

void main();
