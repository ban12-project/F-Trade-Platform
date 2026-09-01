import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ContentPanel } from "@/components/workspace/content-panel";
import { ProjectCanvas } from "@/components/workspace/project-canvas";
import { ProductPanel } from "@/components/workspace/product-panel";
import { ProductReferencePanel, QuotationHandoffPanel, RfqPanel } from "@/components/workspace/sales-panels";
import type { ContentCatalogDetail } from "@/lib/content/store";
import type { ProductCatalogDetail } from "@/lib/products";
import type { WorkspaceProjectDetail } from "@/lib/workspace/store";

const syntheticMarketingProject: WorkspaceProjectDetail = {
  id: "00000000-0000-4000-8000-000000000202",
  title: "Synthetic project canvas",
  kind: "marketing",
  status: "active",
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  revision: 1,
  document: {
    version: 1,
    nodes: [
      { id: "product", kind: "product", position: { x: 0, y: 0 }, locked: true, label: "产品资料" },
      { id: "content", kind: "content", position: { x: 280, y: 120 }, locked: true, label: "营销内容" },
      { id: "video", kind: "video", position: { x: 560, y: 0 }, locked: true, label: "营销视频" },
    ],
    edges: [],
  },
};

const syntheticSalesProject: WorkspaceProjectDetail = {
  ...syntheticMarketingProject,
  id: "00000000-0000-4000-8000-000000000203",
  title: "Synthetic sales canvas",
  kind: "sales",
  document: { version: 1, nodes: [
    { id: "rfq", kind: "rfq", position: { x: 0, y: 0 }, locked: true, label: "客户询盘" },
    { id: "product", kind: "product", position: { x: 280, y: 120 }, locked: true, label: "产品引用" },
    { id: "quotation", kind: "quotation", position: { x: 560, y: 0 }, locked: true, label: "报价交接" },
  ], edges: [] },
};

const syntheticProduct = { id: "00000000-0000-4000-8000-000000000301", productName: "Verified clutch kit", internalSku: "SYN-001", factOptions: [{ path: "product.product_name", label: "product.product_name", value: "Verified clutch kit", evidenceRef: "evidence-product-001" }] };
const syntheticProductDetail: ProductCatalogDetail = {
  id: syntheticProduct.id, state: "PRODUCT_REVIEW_REQUIRED", createdAt: new Date("2026-09-01T00:00:00.000Z"), productName: syntheticProduct.productName, internalSku: syntheticProduct.internalSku, productType: "clutch_kit", verificationStatus: "review_required", blockingFields: [], approvalStatus: "pending", approvalId: "00000000-0000-4000-8000-000000000302",
  draft: { record_id: syntheticProduct.id, source_ref: "source-product-001", evidence_refs: ["evidence-product-001"], field_evidence: { "product.product_name": "evidence-product-001", "product.product_type": "evidence-product-001", "product.internal_sku": "evidence-product-001", "product.oe_numbers": "evidence-product-001" }, verification_status: "review_required", blocking_missing_fields: [], optional_missing_fields: [], product: { product_name: syntheticProduct.productName, product_type: "clutch_kit", internal_sku: syntheticProduct.internalSku, oe_numbers: ["OE-SYN-001"] } },
};
const syntheticContentDetail: ContentCatalogDetail = {
  id: "00000000-0000-4000-8000-000000000303", state: "CONTENT_REVISION_REQUIRED", createdAt: new Date("2026-09-01T00:00:00.000Z"), contentType: "product", productId: syntheticProduct.id, productName: syntheticProduct.productName, hook: "Ask about this verified clutch kit", approvalStatus: "rejected", approvalId: "00000000-0000-4000-8000-000000000304",
  content: { content_id: "00000000-0000-4000-8000-000000000303", product_id: syntheticProduct.id, content_type: "product", objective: "Generate qualified distributor inquiries", target_customer: "Overseas automotive parts distributors", platform: "pending-channel-decision", hook: "Ask about this verified clutch kit", body: "A concise, evidence-grounded product introduction.", product_facts: [{ field: "product.product_name", value: syntheticProduct.productName, evidence_ref: "evidence-product-001" }], call_to_action: "Contact our sales team", hashtags: ["#clutch"], visual_instruction: "Show only the supplied product image.", status: "revision_required" },
};

async function ProjectCanvasFixture({ searchParams }: { searchParams: Promise<{ state?: string; kind?: string }> }) {
  const { state, kind } = await searchParams;
  const reviewState = state === "review";
  if (kind === "sales") return <ProjectCanvas project={syntheticSalesProject} panels={{
    rfq: <RfqPanel projectId={syntheticSalesProject.id} entries={[]} />,
    product: <ProductReferencePanel projectId={syntheticSalesProject.id} available={[syntheticProduct]} linked={[]} />,
    quotation: <QuotationHandoffPanel rfqs={[]} products={[]} />,
  }} />;
  const productDetail = state === "product-review" ? syntheticProductDetail : null;
  const contentDetail = state === "content-revision" ? syntheticContentDetail : null;
  return <ProjectCanvas project={syntheticMarketingProject} panels={{
    product: <ProductPanel projectId={syntheticMarketingProject.id} entries={productDetail ? [productDetail] : []} detail={productDetail} canReview agentConfigured />,
    content: <ContentPanel projectId={syntheticMarketingProject.id} products={[syntheticProduct]} entries={contentDetail ? [contentDetail] : []} detail={contentDetail} canReview />,
  }} videoEditor={{
    canReview: true,
    products: [{ id: "00000000-0000-4000-8000-000000000301", productName: "Verified clutch kit", internalSku: "SYN-001", factOptions: [{ value: "product.product_name", label: "product.product_name" }] }],
    entries: [{
      id: "00000000-0000-4000-8000-000000000401",
      state: reviewState ? "VIDEO_REVIEW_REQUIRED" : "VIDEO_DRAFT",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      productId: "00000000-0000-4000-8000-000000000301",
      productName: "Verified clutch kit",
      objective: "Create a concise product inquiry video",
      targetAudience: "Overseas distributors",
      platforms: ["facebook"],
      approvalStatus: reviewState ? "pending" : null,
      previewAssetRef: reviewState ? "asset-rendered-preview-001" : null,
      draft: { version: 1, platform: "facebook", ctaText: "Contact us", clips: [
        { clipId: "clip-001", assetRef: "evidence-video-001", mediaType: "video", trimStartMs: 0, durationMs: 5_000, fitMode: "contain", audioMode: "muted", subtitle: "", claimRefs: [] },
        { clipId: "clip-002", assetRef: "evidence-image-002", mediaType: "image", trimStartMs: 0, durationMs: 3_000, fitMode: "contain", audioMode: "muted", subtitle: "", claimRefs: [] },
      ] },
    }],
  }} />;
}

/** Test-only fixture: production project canvas access remains permission protected. */
export default function ProjectCanvasTestingPage({ searchParams }: { searchParams: Promise<{ state?: string; kind?: string }> }) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return <Suspense fallback={null}><ProjectCanvasFixture searchParams={searchParams} /></Suspense>;
}
