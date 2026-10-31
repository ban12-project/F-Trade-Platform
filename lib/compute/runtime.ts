import { VpsCompute, vpsComputeEnabled } from "./vps";

export type ComputeRuntime = VpsCompute;

/** Retired cloud providers cannot be re-enabled by stale deployment configuration. */
export async function createComputeRuntime() {
  vpsComputeEnabled();
  return VpsCompute.create();
}

export async function downloadComputeSource(
  runtime: ComputeRuntime,
  source: { signedGetUrl: string; hostname: string },
  destination: string,
) {
  await runtime.download(source.signedGetUrl, source.hostname, destination);
}
