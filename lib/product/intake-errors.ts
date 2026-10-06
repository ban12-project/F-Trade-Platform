export type ProductSourceErrorCode = "source_labels_missing" | "source_locations_exceeded";
export type ProductUploadErrorCode =
  | "upload_unavailable"
  | "upload_type_mismatch"
  | "upload_size_mismatch"
  | "upload_image_invalid"
  | "upload_image_animated"
  | "upload_changed";
type ProductIntakeErrorCode = ProductSourceErrorCode | ProductUploadErrorCode;

export const PRODUCT_INTAKE_ERROR_HEADER = "x-product-intake-error";
const fallbackMessage = "无法开始生成，请检查项目权限、证据和模型配置。";
const intakeMessages: Record<ProductIntakeErrorCode, string> = {
  source_labels_missing:
    "资料中未找到可核对的字段标签。请为表头或正文标明 Product name、Product type、Internal SKU 等字段后重新导入；也可改用手动录入。",
  source_locations_exceeded: "资料包含过多可核对字段。请拆分文件或使用产品目录选择单个产品后导入。",
  upload_unavailable:
    "上传文件当前不可用。请重新选择文件并上传；若仍失败，请联系管理员检查文件存储。",
  upload_type_mismatch: "文件内容与声明的类型不一致。请确认实际格式后重新上传，不要只修改扩展名。",
  upload_size_mismatch:
    "文件大小与上传记录不一致或超出限制。请重新上传，资料不超过 25 MiB、图片不超过 5 MiB。",
  upload_image_invalid:
    "图片无法完整解码。请选择未损坏的 PNG 或 JPEG 图片，每张不超过 2500 万像素。",
  upload_image_animated: "产品图片不能包含多帧或动画。请选择单帧 PNG 或 JPEG 图片后重新上传。",
  upload_changed: "文件在核验后发生变化。请重新选择原始文件并上传。",
};

export class ProductSourceError extends Error {
  constructor(readonly code: ProductSourceErrorCode) {
    super(
      code === "source_labels_missing"
        ? "Product Agent source contains no explicitly labelled evidence locations"
        : "Product Agent source contains more than 512 labelled evidence locations; split the catalog before extraction",
    );
    this.name = "ProductSourceError";
  }
}

/** Only verified file failures may create these codes; never derive them from exception text. */
export class ProductUploadError extends Error {
  constructor(readonly code: ProductUploadErrorCode) {
    super(intakeMessages[code]);
    this.name = "ProductUploadError";
  }
}

export function productIntakeErrorCode(error: unknown): ProductIntakeErrorCode | null {
  if (
    (error instanceof ProductSourceError || error instanceof ProductUploadError) &&
    Object.hasOwn(intakeMessages, error.code)
  )
    return error.code;
  return null;
}

/** Interpret only fixed codes; never display provider bodies or exception text. */
export function productIntakeErrorMessage(code: string | null) {
  return code && Object.hasOwn(intakeMessages, code)
    ? intakeMessages[code as ProductIntakeErrorCode]
    : fallbackMessage;
}

export function productIntakeFailureMessage(error: unknown, fallback = fallbackMessage) {
  const code = productIntakeErrorCode(error);
  return code ? productIntakeErrorMessage(code) : fallback;
}

export function productIntakeFailureResponse(error: unknown) {
  const code = productIntakeErrorCode(error);
  return Response.json(
    { error: productIntakeErrorMessage(code) },
    { status: 400, headers: code ? { [PRODUCT_INTAKE_ERROR_HEADER]: code } : undefined },
  );
}
