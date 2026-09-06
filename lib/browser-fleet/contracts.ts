import { z } from "zod";
import { facebookCredentialFormSchema } from "@/lib/social/facebook-account-forms";

const id = z.uuid();
const reference = z.string().trim().min(1).max(160);
const origin = z.url().refine((v) => {
  const u = new URL(v);
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    u.pathname === "/" &&
    !u.search &&
    !u.hash
  );
}, "请填写不带路径的 HTTPS 域名。");
export const nodeFormSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    gatewayOrigin: origin,
    maxBrowsers: z.number().int().min(1).max(16),
    memoryBudgetMb: z.number().int().min(1024).max(131072),
    browserMemoryMb: z.number().int().min(1024).max(8192),
  })
  .strict()
  .refine((v) => v.memoryBudgetMb >= v.browserMemoryMb, {
    path: ["memoryBudgetMb"],
    message: "内存预算至少容纳一个浏览器。",
  });
export const accountFormSchema = z
  .object({
    nodeId: id,
    channelRef: reference,
    accountRef: reference,
    pollSeconds: z
      .number()
      .int()
      .min(0)
      .max(86400)
      .refine((v) => v === 0 || v >= 300),
    credentials: facebookCredentialFormSchema,
  })
  .strict();
export const ownerCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), value: nodeFormSchema }).strict(),
  z.object({ operation: z.literal("grant"), value: accountFormSchema }).strict(),
  z.object({ operation: z.literal("rotate"), nodeId: id }).strict(),
  z.object({ operation: z.literal("revoke"), nodeId: id }).strict(),
  z
    .object({ operation: z.literal("account"), nodeId: id, accountId: id, enabled: z.boolean() })
    .strict(),
  z
    .object({
      operation: z.literal("confirm-login"),
      nodeId: id,
      accountId: id,
      confirmed: z.literal(true),
    })
    .strict(),
  z.object({ operation: z.literal("open"), nodeId: id, accountId: id }).strict(),
  z.object({ operation: z.literal("stop"), nodeId: id, runId: id }).strict(),
  z.object({ operation: z.literal("ticket"), nodeId: id, runId: id }).strict(),
]);
const common = { installationId: id, bootId: id };
export const nodeRequestSchema = z.discriminatedUnion("operation", [
  z.object({ ...common, operation: z.literal("sync") }).strict(),
  z
    .object({
      ...common,
      operation: z.literal("recover"),
      stoppedRunIds: z.array(id).max(100),
      capabilities: z.array(z.enum(["interactive", "inbox", "publish"])).max(3),
    })
    .strict(),
  z
    .object({
      ...common,
      operation: z.literal("claim"),
      requestId: id,
      availableMemoryMb: z.number().int().min(0).max(1048576),
      localSlots: z.number().int().min(0).max(16),
    })
    .strict(),
  z
    .object({
      ...common,
      operation: z.literal("heartbeat"),
      runId: id,
      leaseId: id,
      ready: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...common,
      operation: z.literal("finish"),
      runId: id,
      leaseId: id,
      stopped: z.literal(true),
      outcome: z.enum(["completed", "failed", "needs_login", "needs_2fa", "checkpoint", "unknown"]),
    })
    .strict(),
  z
    .object({ ...common, operation: z.literal("admit"), ticket: z.string().min(70).max(128) })
    .strict(),
]);
export type NodeRequest = z.infer<typeof nodeRequestSchema>;
export type OwnerCommand = z.infer<typeof ownerCommandSchema>;
