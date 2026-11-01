import { z } from "zod";

const common = { nodeId: z.uuid(), runId: z.uuid() };
export const publicationSetupInputSchema = z.discriminatedUnion("operation", [
  z.object({ ...common, operation: z.enum(["inspect", "prepare"]) }).strict(),
  z
    .object({
      ...common,
      operation: z.literal("activate"),
      candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export const publicationSetupResultSchema = z
  .object({
    version: z.literal(1),
    stage: z.enum([
      "reviewed",
      "ready",
      "entry",
      "composer",
      "receipt",
      "identity",
      "draft",
      "audience",
      "page",
    ]),
    entry: z.boolean(),
    composer: z.boolean(),
    receipt: z.boolean(),
    audience: z.string().max(100).nullable(),
    candidateHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    active: z.boolean(),
    observedAt: z.iso.datetime(),
    textOnly: z.literal(true),
  })
  .strict();
export type PublicationSetupResult = z.infer<typeof publicationSetupResultSchema>;
