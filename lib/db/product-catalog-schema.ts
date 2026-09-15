import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ProductAgentSource } from "../product/agent";
import type {
  CatalogCandidateStatus,
  CatalogFailureCode,
  CatalogImportStatus,
} from "../product/catalog-import-contracts";
import {
  aggregateRecord,
  evidence,
  productDocumentUploadReceipt,
  user,
  workspaceProject,
} from "./schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

export const productCatalogImport = pgTable(
  "product_catalog_import",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => workspaceProject.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => productDocumentUploadReceipt.id, { onDelete: "restrict" }),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    status: text("status").$type<CatalogImportStatus>().notNull(),
    activeAttemptId: text("active_attempt_id"),
    failureCode: text("failure_code").$type<CatalogFailureCode>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("product_catalog_receipt_uidx").on(table.receiptId),
    index("product_catalog_project_idx").on(table.projectId, table.actorId),
    check("product_catalog_status", sql`${table.status} IN ('queued','parsing','ready','failed')`),
  ],
);

export const productCatalogCandidate = pgTable(
  "product_catalog_candidate",
  {
    id: text("id").primaryKey(),
    importId: text("import_id")
      .notNull()
      .references(() => productCatalogImport.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    identifier: text("identifier").notNull(),
    source: jsonb("source").$type<ProductAgentSource>().notNull(),
    physicalPage: integer("physical_page"),
    recordLine: integer("record_line").notNull(),
    reviewStatus: text("review_status")
      .$type<"source_review_required" | "duplicate_identifier_review_required">()
      .notNull(),
    status: text("status").$type<CatalogCandidateStatus>().default("available").notNull(),
    activeAttemptId: text("active_attempt_id"),
    failureCode: text("failure_code").$type<CatalogFailureCode>(),
    productId: text("product_id").references(() => aggregateRecord.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("product_catalog_ordinal_uidx").on(table.importId, table.ordinal),
    uniqueIndex("product_catalog_product_uidx").on(table.productId),
    check(
      "product_catalog_candidate_status",
      sql`${table.status} IN ('available','queued','running','completed','failed')`,
    ),
    check(
      "product_catalog_candidate_result",
      sql`(${table.status} = 'completed') = (${table.productId} IS NOT NULL)`,
    ),
    check(
      "product_catalog_candidate_location",
      sql`${table.ordinal} >= 0 AND ${table.recordLine} > 0 AND (${table.physicalPage} IS NULL OR ${table.physicalPage} > 0)`,
    ),
  ],
);

/** A durable history entry, also used as a fencing token for late worker results. */
export const productCatalogAttempt = pgTable(
  "product_catalog_attempt",
  {
    id: text("id").primaryKey(),
    importId: text("import_id")
      .notNull()
      .references(() => productCatalogImport.id, { onDelete: "cascade" }),
    candidateId: text("candidate_id").references(() => productCatalogCandidate.id, {
      onDelete: "cascade",
    }),
    sessionId: text("session_id").notNull(),
    status: text("status").$type<"queued" | "running" | "completed" | "failed">().notNull(),
    failureCode: text("failure_code").$type<CatalogFailureCode>(),
    modelConfigId: text("model_config_id"),
    model: text("model"),
    workflowRunId: text("workflow_run_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("product_catalog_attempt_import_idx").on(table.importId),
    check(
      "product_catalog_attempt_status",
      sql`${table.status} IN ('queued','running','completed','failed')`,
    ),
    check(
      "product_catalog_attempt_model",
      sql`(${table.candidateId} IS NULL AND ${table.modelConfigId} IS NULL AND ${table.model} IS NULL) OR (${table.candidateId} IS NOT NULL AND ${table.modelConfigId} IS NOT NULL AND ${table.model} IS NOT NULL)`,
    ),
  ],
);
