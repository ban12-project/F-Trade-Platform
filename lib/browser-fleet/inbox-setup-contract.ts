import { z } from "zod";

const common = { nodeId: z.uuid(), runId: z.uuid() };
export const inboxSetupInputSchema = z.discriminatedUnion("operation", [
  z.object({ ...common, operation: z.enum(["inspect", "prepare"]) }).strict(),
  z
    .object({
      ...common,
      operation: z.literal("activate"),
      candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export const inboxSetupResultSchema = z
  .object({
    version: z.literal(1),
    stage: z.enum(["reviewed", "ready", "identity", "attention", "page"]),
    inboxVerified: z.boolean(),
    threadCount: z.number().int().min(0).max(200),
    emptyInbox: z.boolean(),
    candidateHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    active: z.boolean(),
    observedAt: z.iso.datetime(),
  })
  .strict();
export type InboxSetupResult = z.infer<typeof inboxSetupResultSchema>;
