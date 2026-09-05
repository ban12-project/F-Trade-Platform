import type { CamofoxWorkerClient } from "./camofox-client";
import {
  type SignedSocialWorkerCommand,
  verifySocialWorkerCommand,
  type WorkerNonceStore,
} from "./worker-protocol";

export interface FixedEgressVerifier {
  currentIp(): Promise<string>;
}

/** Executes only verified observation jobs; every mismatch or browser failure fails closed for the caller to pause the channel. */
export async function executeControlledObservation(
  signed: SignedSocialWorkerCommand,
  workerId: string,
  expectedEgressIp: string,
  nonces: WorkerNonceStore,
  egress: FixedEgressVerifier,
  camofox: CamofoxWorkerClient,
) {
  const command = await verifySocialWorkerCommand(signed, workerId, nonces);
  if (command.kind !== "observe_inbound")
    throw new Error("Worker executor only accepts passive inbound observation jobs");
  if ((await egress.currentIp()) !== expectedEgressIp) throw new Error("egress_ip_mismatch");
  try {
    await camofox.healthcheck();
    const tabId = await camofox.createFacebookTab();
    const observation = await camofox.snapshot(tabId);
    return { status: "observed" as const, jobId: command.jobId, observation };
  } catch {
    throw new Error("external_result_unknown");
  }
}
