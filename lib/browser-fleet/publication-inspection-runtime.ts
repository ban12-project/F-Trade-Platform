import type { BrowserSandboxProvider } from "./sandbox-provider";
import { secureOrigin } from "./security";

/** A stored owner-selected gateway is not an SSRF allowlist. Self-hosted
 * inspection is enabled only for the exact deployment-owned VPS origin. */
export async function publicationInspectionRuntimeOrigin(
  nodeId: string,
  access: { origin: string; managed: boolean },
  provider: Pick<BrowserSandboxProvider, "get">,
  trustedVpsOrigin = process.env.BROWSER_VPS_GATEWAY_ORIGIN,
) {
  if (!access.managed) {
    if (!trustedVpsOrigin || secureOrigin(trustedVpsOrigin) !== access.origin)
      throw new Error("inspection_origin_invalid");
    return access.origin;
  }
  const sandbox = await provider.get({ name: `ftrade-browser-${nodeId}`, resume: false });
  if (
    sandbox.name !== `ftrade-browser-${nodeId}` ||
    sandbox.tags?.["ftrade-node"] !== nodeId ||
    !sandbox.persistent ||
    sandbox.status !== "running"
  )
    throw new Error("inspection_runtime_unavailable");
  const origin = secureOrigin(sandbox.domain(9400));
  if (origin !== access.origin || !new URL(origin).hostname.endsWith(".vercel.run"))
    throw new Error("inspection_origin_invalid");
  return origin;
}
