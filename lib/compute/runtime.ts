import { type ComputeProfile, VpsCompute, vpsComputeEnabled } from "./vps";

export type ComputeRuntime = VpsCompute;

/** Retired cloud providers cannot be re-enabled by stale deployment configuration. */
export async function createComputeRuntime(profile: ComputeProfile = "heavy") {
  vpsComputeEnabled();
  return VpsCompute.create(profile);
}

export async function downloadComputeSource(
  runtime: ComputeRuntime,
  source: { signedGetUrl: string; hostname: string },
  destination: string,
) {
  await runtime.download(source.signedGetUrl, source.hostname, destination);
}
