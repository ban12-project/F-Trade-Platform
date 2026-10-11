import { z } from "zod";
import { digestSocialWorkerPayload } from "./worker-protocol";
export const facebookCaptionSourceSchema = z
  .object({
    contentRef: z.uuid(),
    contentVersion: z.number().int().positive(),
    approvalRef: z.uuid(),
  })
  .strict();
export type FacebookCaptionSource = z.infer<typeof facebookCaptionSourceSchema>;
export type MediaPreview = {
  contentRef: string;
  format: "image" | "video";
  mediaId: string;
  contentVersion: number;
  caption: string;
  captionSource?: FacebookCaptionSource;
};
export function facebookMediaPreviewDigest(preview: MediaPreview) {
  return digestSocialWorkerPayload(preview);
}
export function assertFacebookMediaPreview(
  input: { contentVersion: number; previewDigest: string },
  preview: MediaPreview,
) {
  if (
    input.contentVersion !== preview.contentVersion ||
    input.previewDigest !== facebookMediaPreviewDigest(preview)
  )
    throw new Error("media_changed_since_preview");
}
