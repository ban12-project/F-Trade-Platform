import { is, type SQLWrapper, sql } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { videoRetentionDays } from "./retention-policy";

/** Source/rights uses, including historical fact bindings, always protect bytes. */
export function reviewEvidenceSourceProtectedCondition(ref: SQLWrapper) {
  // Drizzle strips column qualification in single-table SELECT projections.
  // These correlated subqueries must retain the outer table explicitly.
  if (is(ref, PgColumn)) ref = sql`${ref.table}.${sql.identifier(ref.name)}`;
  return sql`(
    EXISTS (SELECT 1 FROM product_media_asset p WHERE p.evidence_id = ${ref} OR p.rights_evidence_ref = ${ref} OR p.review_evidence_ref = ${ref})
    OR EXISTS (SELECT 1 FROM product_source_image p WHERE p.evidence_id = ${ref})
    OR EXISTS (SELECT 1 FROM product_catalog_import p WHERE p.evidence_id = ${ref})
    OR EXISTS (SELECT 1 FROM product_document_upload_receipt p WHERE p.evidence_id = ${ref} AND p.purpose <> 'evidence')
    OR EXISTS (SELECT 1 FROM approval p JOIN aggregate_record a ON a.id = p.aggregate_id WHERE p.evidence_ref = ${ref} AND a.type <> 'video')
    OR EXISTS (SELECT 1 FROM aggregate_record p WHERE p.type <> 'video' AND strpos(p.payload::text, ${ref}) > 0)
    OR EXISTS (SELECT 1 FROM workflow_event w JOIN aggregate_record a ON a.id = w.aggregate_id WHERE a.type <> 'video' AND w.evidence_refs @> jsonb_build_array(${ref}::text))
    OR EXISTS (SELECT 1 FROM audit_event w JOIN aggregate_record a ON a.id = w.aggregate_id WHERE a.type <> 'video' AND strpos(w.metadata::text, ${ref}) > 0)
    OR EXISTS (SELECT 1 FROM aggregate_record p WHERE p.type = 'video' AND (
      p.payload @> jsonb_build_object('factualClaims', jsonb_build_array(jsonb_build_object('evidenceRef', ${ref}::text)))
      OR p.payload @> jsonb_build_object('sourceAssets', jsonb_build_array(jsonb_build_object('assetRef', ${ref}::text)))
      OR p.payload @> jsonb_build_object('sourceAssets', jsonb_build_array(jsonb_build_object('rightsEvidenceRef', ${ref}::text)))
    ))
  )`;
}

export function videoReviewEvidenceExpiredCondition(ref: SQLWrapper) {
  return sql`EXISTS (
    SELECT 1 FROM video_review_working_evidence w JOIN aggregate_record a ON a.id = w.video_id
    WHERE w.evidence_id = ${ref} AND a.type = 'video' AND a.created_at <= clock_timestamp() - (${videoRetentionDays} * interval '1 day')
  )`;
}
