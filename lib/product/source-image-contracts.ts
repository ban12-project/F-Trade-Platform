import { z } from "zod";

export const maximumProductImageBytes = 5 * 1024 * 1024;
export const maximumProductImages = 4;
export const productImageFilenameSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (name) =>
      !/[\\/]/.test(name) &&
      !Array.from(name).some((c) => c.charCodeAt(0) < 32) &&
      /\.(png|jpe?g)$/i.test(name),
    "产品图片只支持 PNG 和 JPEG。",
  );
export const productImageFilesSchema = z
  .array(
    z
      .file()
      .min(1)
      .max(maximumProductImageBytes, "每张图片不能超过 5 MiB。")
      .refine(
        (file) => productImageFilenameSchema.safeParse(file.name).success,
        "产品图片只支持 PNG 和 JPEG。",
      ),
  )
  .max(maximumProductImages, "最多上传 4 张产品图片。");
export const productImageReceiptIdsSchema = z
  .array(z.uuid())
  .max(maximumProductImages)
  .refine((ids) => new Set(ids).size === ids.length, "不能重复提交图片回执。");
export function productImageContentType(filename: string): "image/png" | "image/jpeg" {
  return /\.png$/i.test(productImageFilenameSchema.parse(filename)) ? "image/png" : "image/jpeg";
}
