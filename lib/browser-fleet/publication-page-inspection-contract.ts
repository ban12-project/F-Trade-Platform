import { z } from "zod";

export const publicationPageInspectionInputSchema = z
  .object({ nodeId: z.uuid(), runId: z.uuid() })
  .strict();
const count = z.number().int().min(0).max(25);
export const publicationPageInspectionSchema = z
  .object({
    version: z.literal(1),
    observedAt: z.iso.datetime(),
    candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
    candidateExpiresAt: z.iso.datetime({ offset: true }),
    candidateExpired: z.boolean(),
    identityMatched: z.boolean(),
    controls: z
      .object({
        identity: count,
        openComposer: count,
        composer: count,
        textbox: count,
        submit: count,
        audience: count,
        fileInput: count,
        attachmentName: count,
      })
      .strict(),
    composerIdentityMatched: z.boolean().nullable(),
    composerEmpty: z.boolean().nullable(),
    audienceMatchesCandidate: z.boolean().nullable(),
    videoPreviewCount: count,
    videoReceiptVisible: z.boolean().nullable(),
  })
  .strict();
export type PublicationPageInspection = z.infer<typeof publicationPageInspectionSchema>;
export const publicationPageInspectionFailureSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("publication_inspection_failure"),
    stage: z.enum(["active", "tab", "candidate", "browser", "page", "response"]),
  })
  .strict();
