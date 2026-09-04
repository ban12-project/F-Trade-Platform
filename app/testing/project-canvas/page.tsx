import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ContentPanel } from "@/components/workspace/content-panel";
import { DeliveryPanel, LeadPanel, PublicationPanel, QuotationPanel } from "@/components/workspace/closing-panels";
import { ProjectCanvas } from "@/components/workspace/project-canvas";
import { ProductPanel } from "@/components/workspace/product-panel";
import { ProductReferencePanel, RfqPanel } from "@/components/workspace/sales-panels";
import type { ContentCatalogDetail } from "@/lib/content/store";
import type { ProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import type { ProductCatalogDetail } from "@/lib/products";
import type { LeadEntry } from "@/lib/sales/closing-store";
import type { WorkspaceProjectDetail, WorkspaceProjectSummary } from "@/lib/workspace/store";
import { createWorkspaceTemplate } from "@/lib/workspace/contracts";

const syntheticMarketingProject: WorkspaceProjectDetail = {
  id: "00000000-0000-4000-8000-000000000202",
  title: "Synthetic project canvas",
  kind: "marketing",
  status: "active",
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  revision: 1,
  document: createWorkspaceTemplate("marketing"),
};

const syntheticSalesProject: WorkspaceProjectDetail = {
  ...syntheticMarketingProject,
  id: "00000000-0000-4000-8000-000000000203",
  title: "Synthetic sales canvas",
  kind: "sales",
  document: createWorkspaceTemplate("sales"),
};
const syntheticProjects: WorkspaceProjectSummary[] = [syntheticMarketingProject, syntheticSalesProject].map(({ document: _document, revision: _revision, ...project }) => project);
const syntheticLead: LeadEntry = {
  id: "00000000-0000-4000-8000-000000000601",
  state: "FOLLOW_UP",
  createdAt: new Date("2026-09-04T08:00:00.000Z"),
  replyAvailable: true,
  confirmedDelivery: { id: "30000000-0000-4000-8000-000000000010", leadTimeDays: 21, validUntil: "2027-09-11T12:00:00.000Z" },
  lead: { lead_id: "00000000-0000-4000-8000-000000000601", channel_ref: "synthetic-facebook", conversation_ref: "synthetic-conversation-001", status: "follow_up", follow_up_context: "quote_sent_read_no_reply", score: 35, score_band: "WARM", score_reasons: [{ rule_id: "active_inquiry", points: 20 }, { rule_id: "asks_lead_time", points: 15 }], next_action: "ask_one_specific_question" },
  timeline: [
    { id: "synthetic-message-001", direction: "inbound", body: "Synthetic buyer asks for the verified lead time.", receivedAt: new Date("2026-09-04T08:30:00.000Z"), deliveryStatus: "received" },
    { id: "synthetic-message-002", direction: "outbound", body: "Synthetic acknowledgement pending channel delivery.", receivedAt: new Date("2026-09-04T08:35:00.000Z"), deliveryStatus: "queued" },
  ],
};

const syntheticProduct = { id: "00000000-0000-4000-8000-000000000301", productName: "Verified clutch kit", internalSku: "SYN-001", factOptions: [{ path: "product.product_name", label: "product.product_name", value: "Verified clutch kit", evidenceRef: "evidence-product-001" }] };
const syntheticAgentModels: ProductAgentModelSettings[] = [
  { id: "00000000-0000-4000-8000-000000000501", name: "日常产品导入", isDefault: true, provider: "openai", model: "gpt-5-mini", discoveredModels: ["gpt-5-mini", "gpt-5.6-terra"], baseUrl: "", headersJson: "{}", providerName: "", organization: "", project: "", apiKeyConfigured: true, authTokenConfigured: false, source: "database" },
  { id: "00000000-0000-4000-8000-000000000502", name: "复杂目录识别", isDefault: false, provider: "anthropic", model: "claude-sonnet-test", discoveredModels: ["claude-sonnet-test"], baseUrl: "", headersJson: "{}", providerName: "", organization: "", project: "", apiKeyConfigured: true, authTokenConfigured: false, source: "database" },
];
const syntheticProductDetail: ProductCatalogDetail = {
  id: syntheticProduct.id, state: "PRODUCT_REVIEW_REQUIRED", createdAt: new Date("2026-09-01T00:00:00.000Z"), productName: syntheticProduct.productName, internalSku: syntheticProduct.internalSku, productType: "clutch_kit", verificationStatus: "review_required", blockingFields: [], approvalStatus: "pending", approvalId: "00000000-0000-4000-8000-000000000302",
  draft: { record_id: syntheticProduct.id, source_ref: "source-product-001", evidence_refs: ["evidence-product-001"], field_evidence: { "product.product_name": "evidence-product-001", "product.product_type": "evidence-product-001", "product.internal_sku": "evidence-product-001", "product.oe_numbers": "evidence-product-001" }, verification_status: "review_required", blocking_missing_fields: [], optional_missing_fields: [], product: { product_name: syntheticProduct.productName, product_type: "clutch_kit", internal_sku: syntheticProduct.internalSku, oe_numbers: ["OE-SYN-001"] } },
};
const syntheticContentDetail: ContentCatalogDetail = {
  id: "00000000-0000-4000-8000-000000000303", state: "CONTENT_REVISION_REQUIRED", createdAt: new Date("2026-09-01T00:00:00.000Z"), contentType: "product", productId: syntheticProduct.id, productName: syntheticProduct.productName, hook: "Ask about this verified clutch kit", approvalStatus: "rejected", approvalId: "00000000-0000-4000-8000-000000000304",
  content: { content_id: "00000000-0000-4000-8000-000000000303", product_id: syntheticProduct.id, content_type: "product", objective: "Generate qualified distributor inquiries", target_customer: "Overseas automotive parts distributors", platform: "pending-channel-decision", hook: "Ask about this verified clutch kit", body: "A concise, evidence-grounded product introduction.", product_facts: [{ field: "product.product_name", value: syntheticProduct.productName, evidence_ref: "evidence-product-001" }], call_to_action: "Contact our sales team", hashtags: ["#clutch"], visual_instruction: "Show only the supplied product image.", status: "revision_required" },
};

async function ProjectCanvasFixture({ searchParams }: { searchParams: Promise<{ state?: string; kind?: string; view?: string }> }) {
  const { state, kind, view } = await searchParams;
  const reviewState = state === "review";
  const approvedState = state === "approved";
  if (kind === "sales") return <ProjectCanvas readOnly={view === "flow"} project={syntheticSalesProject} projects={syntheticProjects} tasks={[]} panels={{
    rfq: <RfqPanel projectId={syntheticSalesProject.id} entries={[]} />,
    product: <ProductReferencePanel projectId={syntheticSalesProject.id} available={[syntheticProduct]} linked={[]} />,
    quotation: <QuotationPanel projectId={syntheticSalesProject.id} rfqs={[]} products={[]} entries={[]} canReview />,
    lead: <LeadPanel projectId={syntheticSalesProject.id} entries={[syntheticLead]} />,
    delivery: <DeliveryPanel projectId={syntheticSalesProject.id} entries={[]} canReview />,
  }} />;
  const productDetail = state === "product-review" ? syntheticProductDetail : null;
  const contentDetail = state === "content-revision" ? syntheticContentDetail : null;
  return <ProjectCanvas readOnly={view === "flow"} project={syntheticMarketingProject} projects={syntheticProjects} tasks={[]} panels={{
    product: <ProductPanel projectId={syntheticMarketingProject.id} entries={productDetail ? [productDetail] : []} detail={productDetail} canReview agentModelConfigs={syntheticAgentModels} />,
    content: <ContentPanel projectId={syntheticMarketingProject.id} products={[syntheticProduct]} entries={contentDetail ? [contentDetail] : []} copyCandidates={[]} detail={contentDetail} canReview />,
    publication: <PublicationPanel projectId={syntheticMarketingProject.id} candidates={[]} channels={[]} publications={[]} />,
  }} videoEditor={{
    canReview: true,
    copyCandidates: [],
    products: [{ id: "00000000-0000-4000-8000-000000000301", productName: "Verified clutch kit", internalSku: "SYN-001", factOptions: [{ value: "product.product_name", label: "product.product_name" }] }],
    entries: [{
      id: "00000000-0000-4000-8000-000000000401",
      state: approvedState ? "VIDEO_APPROVED" : reviewState ? "VIDEO_REVIEW_REQUIRED" : "VIDEO_DRAFT",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      productId: "00000000-0000-4000-8000-000000000301",
      productName: "Verified clutch kit",
      objective: "Create a concise product inquiry video",
      targetAudience: "Overseas distributors",
      platforms: ["facebook"],
      approvalStatus: approvedState ? "approved" : reviewState ? "pending" : null,
      previewAssetRef: approvedState || reviewState ? "asset-rendered-preview-001" : null,
      captionFactOptions: [
        { field: "product.product_name", value: "Verified clutch kit" },
        { field: "product.oe_numbers", value: "OE-SYN-001" },
      ],
      downloadAvailable: approvedState,
      privateTestOnly: false,
      processingJob: null,
      draft: { version: 3, creativeFramework: "google_abcd", platform: "facebook", ctaText: "Contact us", clips: [
        { clipId: "clip-001", assetRef: "evidence-video-001", mediaType: "video", trimStartMs: 0, durationMs: 5_000, fitMode: "contain", audioMode: "muted", caption: { kind: "none" }, abcdRoles: ["attention", "branding"], motionPreset: "punch_in" },
        { clipId: "clip-002", assetRef: "evidence-image-002", mediaType: "image", trimStartMs: 0, durationMs: 3_000, fitMode: "contain", audioMode: "muted", caption: { kind: "none" }, abcdRoles: ["connection", "direction"], motionPreset: "cta_hold" },
      ] },
    }],
  }} />;
}

/** Test-only fixture: production project canvas access remains permission protected. */
export default function ProjectCanvasTestingPage({ searchParams }: { searchParams: Promise<{ state?: string; kind?: string; view?: string }> }) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return <Suspense fallback={null}><ProjectCanvasFixture searchParams={searchParams} /></Suspense>;
}
