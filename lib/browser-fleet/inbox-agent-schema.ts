import { z } from "zod";

export const inboxAgentActionSchema = z.enum([
  "read",
  "navigate",
  "click",
  "input",
  "scroll",
  "upload",
  "finish",
]);

export const inboxAgentSnapshotSchema = z
  .object({
    controls: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(80),
            label: z.string().trim().min(1).max(160),
            actions: z
              .array(z.enum(["navigate", "scroll"]))
              .min(1)
              .max(4),
          })
          .strict(),
      )
      .max(30),
    state: z.string().min(1).max(12_000),
  })
  .strict();

export const inboxAgentContextSchema = z
  .object({
    remainingCalls: z.number().int().min(0).max(40),
    unchangedObservations: z.number().int().min(0).max(10),
    recentActions: z
      .array(
        z
          .object({
            action: inboxAgentActionSchema,
            changed: z.boolean(),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();

export type InboxAgentSnapshot = z.infer<typeof inboxAgentSnapshotSchema>;
export type InboxAgentContext = z.infer<typeof inboxAgentContextSchema>;
