import { z } from "zod";
import {
  maximumProductImageBytes,
  productImageContentType,
  productImageFilenameSchema,
} from "./source-image-contracts";

export const maximumProductDocumentBytes = 25 * 1024 * 1024;
export const documentUploadTypes = {
  pdf: "application/pdf",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

export const documentFilenameSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (name) =>
      !/[\\/]/.test(name) &&
      !Array.from(name).some((c) => c.charCodeAt(0) < 32) &&
      /\.(pdf|csv|xls|xlsx)$/i.test(name),
    "只支持 PDF、CSV、XLS 和 XLSX 文件。",
  );

export const documentFileSchema = z
  .file()
  .min(1)
  .max(maximumProductDocumentBytes, "文件不能超过 25 MiB。")
  .refine(
    (file) => documentFilenameSchema.safeParse(file.name).success,
    "只支持 PDF、CSV、XLS 和 XLSX 文件。",
  );
export const documentUploadFormSchema = z.object({ document: documentFileSchema });

export function documentContentType(filename: string) {
  const name = documentFilenameSchema.parse(filename);
  return documentUploadTypes[
    name.split(".").at(-1)?.toLowerCase() as keyof typeof documentUploadTypes
  ];
}

export const documentUploadPayloadSchema = z
  .object({
    receiptId: z.uuid(),
    projectId: z.uuid(),
    purpose: z.enum(["evidence", "agent", "agent_image"]),
    originalFilename: z.union([documentFilenameSchema, productImageFilenameSchema]),
    contentType: z.enum([...Object.values(documentUploadTypes), "image/png", "image/jpeg"]),
    sizeBytes: z.number().int().min(1).max(maximumProductDocumentBytes, "文件不能超过 25 MiB。"),
  })
  .strict()
  .refine(
    (value) =>
      value.purpose === "agent_image"
        ? productImageFilenameSchema.safeParse(value.originalFilename).success &&
          value.sizeBytes <= maximumProductImageBytes &&
          value.contentType === productImageContentType(value.originalFilename)
        : documentFilenameSchema.safeParse(value.originalFilename).success &&
          value.contentType === documentContentType(value.originalFilename),
    {
      message: "文件类型与扩展名不一致。",
    },
  );
export type DocumentUploadPayload = z.infer<typeof documentUploadPayloadSchema>;
export const documentUploadClaimSchema = z
  .object({
    receiptId: z.uuid(),
    projectId: z.uuid(),
    purpose: z.enum(["evidence", "agent", "agent_image"]),
  })
  .strict();

export function documentUploadPath(input: DocumentUploadPayload) {
  const value = documentUploadPayloadSchema.parse(input);
  return `product-documents/${value.projectId}/${value.receiptId}.${value.originalFilename.split(".").at(-1)?.toLowerCase()}`;
}
