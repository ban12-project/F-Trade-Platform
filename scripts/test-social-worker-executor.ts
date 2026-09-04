import assert from "node:assert/strict";
import { CamofoxWorkerClient } from "../lib/social/camofox-client";
import { executeControlledObservation } from "../lib/social/worker-executor";
import {
  digestSocialWorkerPayload,
  signSocialWorkerCommand,
  type WorkerNonceStore,
} from "../lib/social/worker-protocol";

process.env.SOCIAL_WORKER_SIGNING_KEY = Buffer.alloc(32, 9).toString("base64");
const seen = new Set<string>();
const nonces: WorkerNonceStore = {
  async claim(worker, nonce) {
    const key = `${worker}:${nonce}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  },
};
const now = new Date();
const command = signSocialWorkerCommand({
  commandId: "command-001",
  workerId: "worker-001",
  jobId: "job-001",
  kind: "observe_inbound",
  payloadRef: "payload-001",
  payloadDigest: digestSocialWorkerPayload({ observation: "passive" }),
  nonce: "abcdefghijklmnopqrstuvwxyz012345-_",
  issuedAt: new Date(now.getTime() - 1_000),
  expiresAt: new Date(now.getTime() + 60_000),
});
const fetchMock = async (input: URL | RequestInfo) =>
  new Response(
    JSON.stringify(
      String(input).endsWith("/health")
        ? { ok: true, browserConnected: true }
        : String(input).endsWith("/tabs")
          ? { tabId: "tab-001" }
          : { snapshot: "document", refsCount: 1 },
    ),
    { status: 200 },
  );
const camofox = new CamofoxWorkerClient(
  {
    baseUrl: "http://127.0.0.1:9377",
    accessKey: "a".repeat(32),
    userId: "profile-001",
    sessionKey: "session-001",
  },
  fetchMock as typeof fetch,
);
async function main() {
  assert.equal(
    (
      await executeControlledObservation(
        command,
        "worker-001",
        "198.51.100.2",
        nonces,
        {
          async currentIp() {
            return "198.51.100.2";
          },
        },
        camofox,
      )
    ).status,
    "observed",
  );
  const bad = signSocialWorkerCommand({
    ...command.command,
    commandId: "command-002",
    nonce: "zyxwvutsrqponmlkjihgfedc-_",
  });
  await assert.rejects(
    () =>
      executeControlledObservation(
        bad,
        "worker-001",
        "198.51.100.2",
        nonces,
        {
          async currentIp() {
            return "198.51.100.3";
          },
        },
        camofox,
      ),
    /egress_ip_mismatch/,
  );
  console.log("PASS controlled Worker verifies signature and fixed egress before observation");
}
void main();
