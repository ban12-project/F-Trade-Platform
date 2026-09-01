import { z } from "zod";

const allowedContentTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
] as const;

export const videoUploadContentTypeSchema = z.enum(allowedContentTypes);

/** One signed URL authorizes one non-multipart PUT to one exact private pathname. */
export const videoPresignedUploadUsesMultipart = false;

export const videoPresignedUploadPayloadSchema = z.object({
  receiptId: z.uuid(),
  projectId: z.uuid(),
  originalFilename: z.string().trim().min(1).max(240),
  contentType: videoUploadContentTypeSchema,
  sizeBytes: z.number().int().min(1).max(20 * 1024 * 1024),
  rightsEvidenceRef: z.string().trim().regex(/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i),
}).strict();

export const completedVideoUploadTokenSchema = videoPresignedUploadPayloadSchema.extend({
  actorId: z.string().trim().min(1).max(160),
  blobPath: z.string().trim().min(1).max(1_024),
}).strict().refine((value) => value.blobPath === videoUploadBlobPath(value), { path: ["blobPath"], message: "上传回调路径与签名载荷不一致。" });

export const claimVideoUploadReceiptsSchema = z.array(z.uuid()).min(1).max(3)
  .refine((value) => new Set(value).size === value.length, "上传回执不能重复。");

export function extensionForVideoUpload(contentType: z.infer<typeof videoUploadContentTypeSchema>) {
  return ({
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
  } as const)[contentType];
}

export function videoUploadBlobPath(input: Pick<VideoPresignedUploadPayload, "receiptId" | "projectId" | "contentType">) {
  const contentType = videoUploadContentTypeSchema.parse(input.contentType);
  return `video/uploads/${input.projectId}/${input.receiptId}${extensionForVideoUpload(contentType)}`;
}

export function mediaTypeForVideoUpload(contentType: z.infer<typeof videoUploadContentTypeSchema>) {
  return contentType.startsWith("image/") ? "image" as const : "video" as const;
}

export type VideoPresignedUploadPayload = z.infer<typeof videoPresignedUploadPayloadSchema>;
