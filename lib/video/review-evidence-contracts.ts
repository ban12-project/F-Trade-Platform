import { z } from "zod";

export const videoReviewWorkingEvidenceFormSchema = z
  .object({
    projectId: z.uuid(),
    videoId: z.uuid(),
    evidenceRef: z.string().regex(/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i),
    workingCopyOnly: z
      .boolean()
      .refine((value) => value, "请确认这份附件是工作副本，不是工厂原件或长期来源。"),
  })
  .strict();

export type VideoReviewEvidenceCopy = {
  evidenceRef: string;
  label: string;
  registered: boolean;
  canRegister: boolean;
  expiresAt: string;
};
