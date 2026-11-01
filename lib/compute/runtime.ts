import { VercelCompute } from "./vercel";
import { type ComputeProfile, VpsCompute, vpsComputeEnabled } from "./vps";

export type ComputeRuntime = VpsCompute | VercelCompute;

/** Explicit provider selection only; execution failures never cross providers. */
export async function createComputeRuntime(profile: ComputeProfile = "heavy") {
  const provider = process.env.COMPUTE_PROVIDER ?? "vercel";
  if (provider === "vercel") return VercelCompute.create(profile);
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
