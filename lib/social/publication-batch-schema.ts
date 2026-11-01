import { z } from "zod";
import { publicationConfirmationFormSchema } from "@/lib/form-schemas";
import { facebookMediaSubmitFormSchema } from "./facebook-account-forms";

const target = z
  .object({ channelRef: z.string().min(1).max(200), accountRef: z.string().min(1).max(200) })
  .strict();
export const publicationBatchSchema = z
  .object({
    batchId: z.uuid(),
    audience: z.literal("Public"),
    targets: z
      .array(target)
      .min(1, "请选择发布账号。")
      .max(16)
      .refine(
        (items) =>
          new Set(items.map((item) => JSON.stringify([item.channelRef, item.accountRef]))).size ===
          items.length,
        "发布账号不能重复。",
      ),
    content: z.discriminatedUnion("format", [
      publicationConfirmationFormSchema
        .omit({ channelRef: true, accountRef: true, confirmationRef: true })
        .extend({ format: z.literal("text") })
        .strict(),
      facebookMediaSubmitFormSchema
        .omit({ channelRef: true, accountRef: true, confirm: true })
        .extend({ format: z.literal("image") })
        .strict(),
      facebookMediaSubmitFormSchema
        .omit({ channelRef: true, accountRef: true, confirm: true })
        .extend({ format: z.literal("video") })
        .strict(),
    ]),
  })
  .strict();
export type PublicationBatchInput = z.infer<typeof publicationBatchSchema>;
export type PublicationBatchResult = {
  channelRef: string;
  accountRef: string;
  publicationId: string;
};
