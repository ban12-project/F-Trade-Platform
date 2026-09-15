import { z } from "zod";

export const maximumCatalogBatchRecords = 20;

export const catalogIntakeSchema = z.object({ projectId: z.uuid(), receiptId: z.uuid() }).strict();

export const catalogLookupSchema = z.object({ projectId: z.uuid(), importId: z.uuid() }).strict();

export const catalogSelectionSchema = z
  .object({
    projectId: z.uuid(),
    importId: z.uuid(),
    candidateIds: z
      .array(z.uuid())
      .min(1, "请选择至少一条目录记录。")
      .max(maximumCatalogBatchRecords, "每批最多选择 20 条目录记录。")
      .refine((ids) => new Set(ids).size === ids.length, "不能重复选择同一条记录。"),
    modelConfigId: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(240),
  })
  .strict();

export type CatalogSelection = z.infer<typeof catalogSelectionSchema>;
export type CatalogImportStatus = "queued" | "parsing" | "ready" | "failed";
export type CatalogCandidateStatus = "available" | "queued" | "running" | "completed" | "failed";
export type CatalogFailureCode =
  | "SOURCE_UNAVAILABLE"
  | "PREPROCESS_FAILED"
  | "MODEL_FAILED"
  | "ACCESS_REVOKED"
  | "DISPATCH_FAILED"
  | "ATTEMPT_EXPIRED";

/** The complete browser-facing view; never return persisted source text or storage paths. */
export type CatalogImportView = {
  id: string;
  status: CatalogImportStatus;
  failureCode: CatalogFailureCode | null;
  candidates: Array<{
    id: string;
    identifier: string;
    physicalPage: number | null;
    recordLine: number;
    duplicateIdentifier: boolean;
    status: CatalogCandidateStatus;
    attempts: number;
    failureCode: CatalogFailureCode | null;
    productId: string | null;
  }>;
};

export type CatalogActionResult =
  | { status: "success"; view: CatalogImportView }
  | { status: "error"; message: string };
