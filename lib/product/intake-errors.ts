export type ProductSourceErrorCode = "source_labels_missing" | "source_locations_exceeded";

export const PRODUCT_INTAKE_ERROR_HEADER = "x-product-intake-error";
const fallbackMessage = "无法开始生成，请检查项目权限、证据和模型配置。";
const sourceMessages: Record<ProductSourceErrorCode, string> = {
  source_labels_missing:
    "资料中未找到可核对的字段标签。请为表头或正文标明 Product name、Product type、Internal SKU 等字段后重新导入；也可改用手动录入。",
  source_locations_exceeded: "资料包含过多可核对字段。请拆分文件或使用产品目录选择单个产品后导入。",
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

/** Interpret only fixed codes; never display provider bodies or exception text. */
export function productIntakeErrorMessage(code: string | null) {
  return code && Object.hasOwn(sourceMessages, code)
    ? sourceMessages[code as ProductSourceErrorCode]
    : fallbackMessage;
}

export function productIntakeFailureResponse(error: unknown) {
  const code = error instanceof ProductSourceError ? error.code : null;
  return Response.json(
    { error: productIntakeErrorMessage(code) },
    { status: 400, headers: code ? { [PRODUCT_INTAKE_ERROR_HEADER]: code } : undefined },
  );
}
