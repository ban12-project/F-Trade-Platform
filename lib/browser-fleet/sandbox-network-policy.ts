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
