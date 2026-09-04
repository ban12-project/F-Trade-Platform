import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { aggregateRecord, evidence, user } from "./schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

/**
 * Reusable, rights-governed source media attached to one ProductReady record.
 * Binary data remains in private evidence storage; this table stores metadata
 * and review decisions only.
 */
export const productMediaAsset = pgTable(
  "product_media_asset",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => aggregateRecord.id, { onDelete: "restrict" }),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    origin: text("origin").notNull(),
    mediaType: text("media_type").notNull(),
    role: text("role").notNull(),

    contentType: text("content_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    durationMs: integer("duration_ms"),
    fps: real("fps"),
    hasAudio: boolean("has_audio").default(false).notNull(),

    description: text("description").default("").notNull(),
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),
    productVisible: boolean("product_visible").default(false).notNull(),
    logoVisible: boolean("logo_visible").default(false).notNull(),
    textPresent: boolean("text_present").default(false).notNull(),

    rightsEvidenceRef: text("rights_evidence_ref")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    editingAllowed: boolean("editing_allowed").default(false).notNull(),
    publicDistributionAllowed: boolean("public_distribution_allowed").default(false).notNull(),
    paidAdvertisingAllowed: boolean("paid_advertising_allowed").default(false).notNull(),
    imageToVideoAllowed: boolean("image_to_video_allowed").default(false).notNull(),
    referenceToVideoAllowed: boolean("reference_to_video_allowed").default(false).notNull(),
    rightsExpiresAt: timestamp("rights_expires_at", { withTimezone: true }),

    reviewStatus: text("review_status").default("pending").notNull(),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewEvidenceRef: text("review_evidence_ref").references(() => evidence.id, {
      onDelete: "restrict",
    }),
    reviewNotes: text("review_notes").default("").notNull(),

    version: integer("version").default(1).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("product_media_product_evidence_uidx").on(table.productId, table.evidenceId),
    index("product_media_product_review_idx").on(table.productId, table.reviewStatus),
    index("product_media_evidence_idx").on(table.evidenceId),
    index("product_media_rights_expiry_idx").on(table.rightsExpiresAt),
    check(
      "product_media_origin_allowed",
      sql`${table.origin} in ('factory', 'user_upload', 'licensed')`,
    ),
    check("product_media_type_allowed", sql`${table.mediaType} in ('image', 'video')`),
    check(
      "product_media_role_allowed",
      sql`${table.role} in ('product_hero', 'product_detail', 'packaging', 'factory', 'inspection', 'application', 'other')`,
    ),
    check(
      "product_media_review_status_allowed",
      sql`${table.reviewStatus} in ('pending', 'approved', 'rejected')`,
    ),
    check(
      "product_media_dimensions_bounded",
      sql`${table.width} between 1 and 32768 and ${table.height} between 1 and 32768`,
    ),
    check("product_media_version_positive", sql`${table.version} > 0`),
    check(
      "product_media_content_type_matches",
      sql`lower(${table.contentType}) like (${table.mediaType} || '/%')`,
    ),
    check("product_media_description_bounded", sql`length(${table.description}) <= 500`),
    check("product_media_review_notes_bounded", sql`length(${table.reviewNotes}) <= 1000`),
    check("product_media_tags_array", sql`jsonb_typeof(${table.tags}) = 'array'`),
    check(
      "product_media_technical_consistent",
      sql`(${table.mediaType} = 'image' and ${table.durationMs} is null and ${table.fps} is null and not ${table.hasAudio}) or (${table.mediaType} = 'video' and ${table.durationMs} between 1 and 120000 and ${table.fps} > 0 and ${table.fps} <= 240)`,
    ),
    check(
      "product_media_generation_requires_editing",
      sql`not (${table.imageToVideoAllowed} or ${table.referenceToVideoAllowed}) or ${table.editingAllowed}`,
    ),
    check(
      "product_media_image_to_video_type",
      sql`not ${table.imageToVideoAllowed} or ${table.mediaType} = 'image'`,
    ),
    check(
      "product_media_review_consistent",
      sql`(${table.reviewStatus} = 'pending' and ${table.reviewedBy} is null and ${table.reviewedAt} is null and ${table.reviewEvidenceRef} is null) or (${table.reviewStatus} in ('approved', 'rejected') and ${table.reviewedBy} is not null and ${table.reviewedAt} is not null and ${table.reviewEvidenceRef} is not null and length(btrim(${table.reviewEvidenceRef})) > 0)`,
    ),
    check(
      "product_media_rights_evidence_nonempty",
      sql`length(btrim(${table.rightsEvidenceRef})) > 0`,
    ),
    check("product_media_creator_nonempty", sql`length(btrim(${table.createdBy})) > 0`),
  ],
);
