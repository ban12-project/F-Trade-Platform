import assert from "node:assert/strict";
import { Pool } from "pg";
import { getProjectContentCatalogDetail } from "../lib/content/store";
import { closeDatabase, getDatabase } from "../lib/db/client";
import { getProjectProductCatalogDetail } from "../lib/products";
import {
  listProjectDeliveryConfirmations,
  listProjectLeads,
  listProjectQuotations,
} from "../lib/sales/closing-store";
import { listProjectRfqEntries } from "../lib/sales/store";
import { listProjectPublicationData } from "../lib/social/publication-store";
import { getMarketingVideoEditProject } from "../lib/video/store";

// Copy this script into the previous revision; all readers above must resolve there.
const connection = process.env.WORKSPACE_ROLLBACK_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_browser_test"
)
  throw new Error("Dedicated synthetic browser database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
process.env.SOCIAL_MESSAGE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

type Stored = {
  id: string;
  state: string;
  version: number;
  payload: Record<string, any>;
  project_id: string;
  created_by_id: string;
};
const pool = new Pool({ connectionString: connection });
void (async () => {
  try {
    const {
      rows: [product],
    } = await pool.query<Stored>(
      "SELECT a.*, i.project_id FROM aggregate_record a JOIN workspace_project_item i ON i.aggregate_id=a.id WHERE a.type='product' AND a.state='PRODUCT_READY' AND a.payload->'product'->>'internal_sku' LIKE 'MOCK-BROWSER-%' AND i.relation='owned' ORDER BY a.created_at DESC LIMIT 1",
    );
    assert.ok(product, "completed real product form journey is required");
    const previousProduct = await getProjectProductCatalogDetail(product.project_id, product.id);
    assert.ok(previousProduct);
    assert.equal(previousProduct.state, product.state);
    assert.equal(previousProduct.version, product.version);
    assert.deepEqual(previousProduct.draft, product.payload);
    assert.equal(previousProduct.approvalStatus, "approved");
    assert.ok(Object.keys(previousProduct.draft.field_evidence ?? {}).length);
    console.log(
      "PASS previous product reader preserves id, version, approved Gate 01 and field evidence",
    );

    const {
      rows: [content],
    } = await pool.query<Stored>(
      "SELECT a.*, i.project_id FROM aggregate_record a JOIN workspace_project_item i ON i.aggregate_id=a.id JOIN social_publication p ON p.content_ref=a.id WHERE a.type='content' AND a.payload->>'product_id'=$1 AND p.status='published' ORDER BY a.created_at DESC LIMIT 1",
      [product.id],
    );
    assert.ok(content, "completed real content form journey is required");
    const previousContent = await getProjectContentCatalogDetail(content.project_id, content.id);
    assert.ok(previousContent);
    assert.equal(previousContent.state, content.state);
    assert.equal(previousContent.version, content.version);
    assert.equal(previousContent.productId, product.id);
    assert.deepEqual(previousContent.content, content.payload);
    assert.equal(previousContent.approvalStatus, "approved");
    const publication = await listProjectPublicationData(content.project_id);
    assert.ok(
      publication.publications.some(
        (item) => item.contentRef === content.id && item.status === "published",
      ),
    );
    console.log(
      "PASS previous content/publication readers preserve product source, approval and published receipt",
    );

    const {
      rows: [delivery],
    } = await pool.query<Stored>(
      "SELECT a.*, i.project_id FROM aggregate_record a JOIN workspace_project_item i ON i.aggregate_id=a.id JOIN workspace_project p ON p.id=i.project_id WHERE a.type='delivery_confirmation' AND a.state='DELIVERY_CONFIRMATION_CONFIRMED' AND p.title='MOCK browser integration only' AND a.created_by_id LIKE 'synthetic-browser-%' ORDER BY a.created_at DESC LIMIT 1",
    );
    assert.ok(delivery, "completed real sales form journey is required");
    const { rows } = await pool.query<Stored>(
      "SELECT a.*, i.project_id FROM aggregate_record a JOIN workspace_project_item i ON i.aggregate_id=a.id WHERE i.project_id=$1 AND a.type IN ('rfq','quotation','lead','delivery_confirmation')",
      [delivery.project_id],
    );
    const [rfqs, quotations, leads, deliveries] = await Promise.all([
      listProjectRfqEntries(delivery.project_id),
      listProjectQuotations(delivery.project_id),
      listProjectLeads(delivery.project_id, delivery.created_by_id),
      listProjectDeliveryConfirmations(delivery.project_id),
    ]);
    for (const [type, read] of [
      ["rfq", rfqs],
      ["quotation", quotations],
      ["lead", leads],
      ["delivery_confirmation", deliveries],
    ] as const) {
      const stored = rows.find((row) => (row as Stored & { type: string }).type === type);
      assert.ok(stored);
      const entry = read.find((item) => item.id === stored.id);
      assert.ok(entry, `previous ${type} reader must retain exact id`);
      assert.equal(entry.state, stored.state);
    }
    assert.ok(
      quotations.some((item) => item.approvalStatus === "approved" && item.state === "QUOTE_SENT"),
    );
    assert.ok(
      leads.some(
        (item) => item.state === "OPPORTUNITY" && item.lead.quotation_ref === quotations[0]?.id,
      ),
    );
    assert.ok(
      deliveries.some((item) => item.approvalStatus === "approved" && item.id === delivery.id),
    );
    console.log(
      "PASS previous RFQ/quotation/customer/delivery readers preserve explicit relations and Gate 02/03",
    );

    const {
      rows: [video],
    } = await pool.query<Stored>(
      "SELECT a.*, e.metadata->>'project_id' AS project_id FROM aggregate_record a JOIN audit_event e ON e.aggregate_id=a.id WHERE a.type='video' AND e.action='marketing_video_edit.copied_to_project' ORDER BY a.created_at DESC LIMIT 1",
    );
    assert.ok(video, "real video copy Action result is required");
    const previousVideo = await getMarketingVideoEditProject(video.id, getDatabase());
    assert.equal(previousVideo.state, video.state);
    assert.equal(previousVideo.project.id, video.id);
    assert.equal(previousVideo.project.productId, video.payload.productId);
    assert.deepEqual(previousVideo.project.editDraft, video.payload.editDraft);
    console.log(
      "PASS previous video reader preserves copied draft id, product source and edit version",
    );
  } finally {
    await pool.end();
    await closeDatabase();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
