import { BlockList, isIP } from "node:net";
import { z } from "zod";

const matcher = z.union([
  z.object({ exact: z.string() }).strict(),
  z.object({ startsWith: z.string() }).strict(),
  z.object({ regex: z.string() }).strict(),
]);
const entryMatcher = z.object({ key: matcher.optional(), value: matcher.optional() }).strict();
const match = z
  .object({
    path: matcher.optional(),
    method: z.array(z.string()).optional(),
    queryString: z.array(entryMatcher).optional(),
    headers: z.array(entryMatcher).optional(),
  })
  .strict();
const rule = z.union([
  z
    .object({
      match: match.optional(),
      transform: z.array(
        z.object({ headers: z.record(z.string(), z.string()).optional() }).strict(),
      ),
    })
    .strict(),
  z
    .object({
      match: match.optional(),
      forwardURL: z.url().refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" && !url.search && !url.hash && !url.username && !url.password
        );
      }),
    })
    .strict(),
]);

// Mirrors the installed SDK's restricted policy shapes. Approval of destinations
// is an operational prerequisite; parsing cannot establish that approval.
export const browserSandboxNetworkPolicySchema = z.union([
  z.literal("deny-all"),
  z
    .object({
      allow: z
        .union([z.array(z.string().min(1)), z.record(z.string().min(1), z.array(rule))])
        .optional(),
      subnets: z
        .object({
          allow: z.array(z.string().min(1)).optional(),
          deny: z.array(z.string().min(1)).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);
export type BrowserSandboxNetworkPolicy = z.infer<typeof browserSandboxNetworkPolicySchema>;

export function configuredBrowserSandboxNetworkPolicy(): BrowserSandboxNetworkPolicy {
  try {
    return browserSandboxNetworkPolicySchema.parse(
      JSON.parse(process.env.BROWSER_SANDBOX_NETWORK_POLICY_JSON ?? ""),
    );
  } catch {
    // Policies may contain proxy URLs or header transforms. Never report inputs.
    throw new Error("sandbox_network_policy_configuration_invalid");
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function browserSandboxNetworkPolicyMatches(
  observed: unknown,
  expected: BrowserSandboxNetworkPolicy,
) {
  const parsed = browserSandboxNetworkPolicySchema.safeParse(observed);
  // Ignore object key ordering only. Preserve rule/transform order and all
  // explicit fields; uncertain semantic equivalence must require reconciliation.
  return parsed.success && canonical(parsed.data) === canonical(expected);
}

/** Detect literal proxy IPs blocked by a managed Sandbox before saving a
 * replacement proxy. Hostname routing remains the provider's responsibility;
 * an HTTP domain allow rule does not authorize an arbitrary TCP proxy port.
 */
export function assertBrowserSandboxProxyIpAllowed(
  host: string,
  policy: BrowserSandboxNetworkPolicy,
) {
  const family = isIP(host);
  if (!family) return;
  const type = family === 4 ? "ipv4" : "ipv6";
  const matchesSubnet = (cidr: string) => {
    const [address, prefix, extra] = cidr.split("/");
    const version = isIP(address);
    if (!version || extra !== undefined || (prefix !== undefined && !/^\d+$/.test(prefix)))
      throw new Error("sandbox_network_policy_configuration_invalid");
    const bits = prefix === undefined ? (version === 4 ? 32 : 128) : Number(prefix);
    if (bits > (version === 4 ? 32 : 128))
      throw new Error("sandbox_network_policy_configuration_invalid");
    const list = new BlockList();
    list.addSubnet(address, bits, version === 4 ? "ipv4" : "ipv6");
    return list.check(host, type);
  };
  if (
    policy === "deny-all" ||
    (policy.subnets?.deny ?? []).some(matchesSubnet) ||
    !(policy.subnets?.allow ?? []).some(matchesSubnet)
  )
    throw new Error("sandbox_proxy_ip_not_allowed");
}
