import { z } from "zod";

const allowedContentTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
] as const;

export const videoUploadContentTypeSchema = z.enum(allowedContentTypes);
export const maximumVideoUploadImageBytes = 20 * 1024 * 1024;
export const maximumVideoUploadVideoBytes = 1024 * 1024 * 1024 - 1;
export const maximumVideoUploadBatchBytes = maximumVideoUploadVideoBytes * 3;
export const videoUploadMultipartThresholdBytes = 100 * 1024 * 1024;

/** Vercel recommends multipart above 100MB; the signed token remains exact-path and put-only. */
export function shouldUseMultipartVideoUpload(sizeBytes: number) {
  return sizeBytes > videoUploadMultipartThresholdBytes;
}

export const videoPresignedUploadPayloadSchema = z.object({
  receiptId: z.uuid(),
  projectId: z.uuid(),
  originalFilename: z.string().trim().min(1).max(240),
  contentType: videoUploadContentTypeSchema,
  sizeBytes: z.number().int().min(1).max(maximumVideoUploadVideoBytes),
  rightsEvidenceRef: z.string().trim().regex(/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i),
}).strict().superRefine((value, context) => {
  if (value.contentType.startsWith("image/") && value.sizeBytes > maximumVideoUploadImageBytes) {
    context.addIssue({ code: "custom", path: ["sizeBytes"], message: "单张图片不能超过 20MB。" });
  }
});

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
