import { digestSocialWorkerPayload } from "./worker-protocol";
export type MediaPreview = {
  contentRef: string;
  format: "image" | "video";
  mediaId: string;
  contentVersion: number;
  caption: string;
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
