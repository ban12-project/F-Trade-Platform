import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  DeliveryPanel,
  LeadPanel,
  PublicationPanel,
  QuotationPanel,
} from "@/components/workspace/closing-panels";
import { ContentCreatePanel } from "@/components/workspace/content-create-panel";
import { ContentReview } from "@/components/workspace/content-review";
import { WorkspaceDirtyProvider } from "@/components/workspace/dirty-state";
import { ProductIntakePanel } from "@/components/workspace/product-intake-panel";
import { ProductReview } from "@/components/workspace/product-review";
import { RecordFrame } from "@/components/workspace/record-frame";
import { RfqDetail } from "@/components/workspace/rfq-detail";
import { SalesContext } from "@/components/workspace/sales-context";
import { WorkspaceLink } from "@/components/workspace/workspace-link";
import type { ProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import type { ContentCatalogDetail } from "@/lib/content/store";
import type { ProductCatalogDetail } from "@/lib/products";
import type {
  DeliveryConfirmationEntry,
  LeadEntry,
  QuotationEntry,
} from "@/lib/sales/closing-store";
import type { SalesRelationRecord } from "@/lib/sales/journey";
import type { RfqEntry } from "@/lib/sales/store";
import type { WorkspaceProjectSummary } from "@/lib/workspace/types";

const syntheticMarketingProject: WorkspaceProjectSummary = {
  id: "00000000-0000-4000-8000-000000000202",
  title: "Synthetic project canvas",
  kind: "marketing",
  status: "active",
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

const syntheticSalesProject: WorkspaceProjectSummary = {
  ...syntheticMarketingProject,
  id: "00000000-0000-4000-8000-000000000203",
  title: "Synthetic sales canvas",
  kind: "sales",
};
const _syntheticProjects: WorkspaceProjectSummary[] = [
  syntheticMarketingProject,
  syntheticSalesProject,
];
const syntheticLead: LeadEntry = {
  id: "00000000-0000-4000-8000-000000000601",
  state: "FOLLOW_UP",
  createdAt: new Date("2026-09-04T08:00:00.000Z"),
  replyAvailable: true,
  confirmedDelivery: {
    id: "30000000-0000-4000-8000-000000000010",
    leadTimeDays: 21,
    validUntil: "2027-09-11T12:00:00.000Z",
  },
  lead: {
    lead_id: "00000000-0000-4000-8000-000000000601",
    channel_ref: "synthetic-facebook",
    conversation_ref: "synthetic-conversation-001",
    rfq_ref: "00000000-0000-4000-8000-000000000602",
    quotation_ref: "00000000-0000-4000-8000-000000000603",
    delivery_confirmation_ref: "30000000-0000-4000-8000-000000000010",
    status: "follow_up",
    follow_up_context: "quote_sent_read_no_reply",
    score: 35,
    score_band: "WARM",
    score_reasons: [
      { rule_id: "active_inquiry", points: 20 },
      { rule_id: "asks_lead_time", points: 15 },
    ],
    next_action: "ask_one_specific_question",
  },
  timeline: [
    {
      id: "synthetic-message-001",
      direction: "inbound",
      body: "Synthetic buyer asks for the verified lead time.",
      receivedAt: new Date("2026-09-04T08:30:00.000Z"),
      deliveryStatus: "received",
    },
    {
      id: "synthetic-message-002",
      direction: "outbound",
      body: "Synthetic acknowledgement pending channel delivery.",
      receivedAt: new Date("2026-09-04T08:35:00.000Z"),
      deliveryStatus: "queued",
    },
  ],
};

const syntheticProduct = {
  id: "00000000-0000-4000-8000-000000000301",
  productName: "Verified clutch kit",
  internalSku: "SYN-001",
  factOptions: [
    {
      path: "product.product_name",
      label: "产品名称",
      value: "Verified clutch kit",
      evidenceRef: "evidence-product-001",
    },
  ],
};
const syntheticGenerationProducts = [
  {
    ...syntheticProduct,
    factOptions: [
      ...syntheticProduct.factOptions,
      {
        path: "product.oe_numbers",
        label: "OE 编号",
        value: "MOCK-OE-001",
        evidenceRef: "evidence-product-001",
      },
    ],
  },
  {
    ...syntheticProduct,
    id: "00000000-0000-4000-8000-000000000305",
    productName: "MOCK second product",
    internalSku: "SYN-002",
    factOptions: [
      {
        path: "product.product_name",
        label: "产品名称",
        value: "MOCK second product",
        evidenceRef: "evidence-product-002",
      },
    ],
  },
];
const syntheticRfq: RfqEntry = {
  id: "00000000-0000-4000-8000-000000000602",
  state: "RFQ_READY",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  productType: "clutch_kit",
  quantity: 500,
  destination: "Synthetic Port",
  completenessScore: 100,
  missingFields: [],
  formValues: {
    leadId: syntheticLead.id,
    customerName: "Synthetic Buyer",
    customerCompany: "MOCK parts",
    customerCountry: "Synthetic Country",
    productType: "clutch_kit",
    oeNumber: "SYN-OE-001",
    vehicleBrand: "",
    vehicleModel: "",
    quantity: "500",
    destination: "Synthetic Port",
  },
};
const syntheticQuote: QuotationEntry = {
  id: "00000000-0000-4000-8000-000000000603",
  version: 2,
  state: "QUOTE_REVISION_REQUIRED",
  createdAt: syntheticRfq.createdAt,
  productId: syntheticProduct.id,
  approvalId: "00000000-0000-4000-8000-000000000604",
  approvalStatus: "rejected",
  reviewNotes: "MOCK: 请核对付款条件后再次送审。",
  quotation: {
    handoff_id: "00000000-0000-4000-8000-000000000603",
    rfq_id: syntheticRfq.id,
    product_id: syntheticProduct.id,
    status: "revision_required",
    quote: {
      unit_price: 12.5,
      currency: "USD",
      moq: 100,
      lead_time_days: 30,
      payment_terms: "MOCK terms; synthetic only",
      validity_days: 30,
    },
    created_by_actor_type: "human",
    created_by_actor_id: "synthetic-reviewer",
  },
};
const syntheticDelivery: DeliveryConfirmationEntry = {
  id: "30000000-0000-4000-8000-000000000010",
  state: "DELIVERY_CONFIRMATION_CONFIRMED",
  createdAt: syntheticRfq.createdAt,
  approvalId: null,
  approvalStatus: "approved",
  confirmation: {
    related_entity_type: "rfq",
    related_entity_id: syntheticRfq.id,
    result: {
      confirmed_lead_time_days: 21,
      valid_until: syntheticLead.confirmedDelivery?.validUntil,
    },
  },
};
const syntheticRelations: SalesRelationRecord[] = [
  {
    kind: "lead",
    id: syntheticLead.id,
    state: syntheticLead.state,
    title: "Synthetic Buyer · 客户会话",
    rfqId: syntheticRfq.id,
    quotationId: syntheticQuote.id,
    deliveryId: syntheticDelivery.id,
  },
  {
    kind: "rfq",
    id: syntheticRfq.id,
    state: syntheticRfq.state,
    title: "Synthetic Buyer · 500",
    leadId: syntheticLead.id,
  },
  {
    kind: "quotation",
    id: syntheticQuote.id,
    state: syntheticQuote.state,
    title: "MOCK 报价 USD 12.5",
    rfqId: syntheticRfq.id,
  },
  {
    kind: "delivery",
    id: syntheticDelivery.id,
    state: syntheticDelivery.state,
    title: "MOCK 工厂交期确认",
    rfqId: syntheticRfq.id,
  },
];
const syntheticAgentModels: ProductAgentModelSettings[] = [
  {
    id: "00000000-0000-4000-8000-000000000501",
    name: "日常产品导入",
    isDefault: true,
    provider: "openai",
    model: "gpt-5-mini",
    discoveredModels: ["gpt-5-mini", "gpt-5.6-terra"],
    baseUrl: "",
    headersJson: "{}",
    providerName: "",
    organization: "",
    project: "",
    apiKeyConfigured: true,
    authTokenConfigured: false,
    source: "database",
  },
  {
    id: "00000000-0000-4000-8000-000000000502",
    name: "复杂目录识别",
    isDefault: false,
    provider: "anthropic",
    model: "claude-sonnet-test",
    discoveredModels: ["claude-sonnet-test"],
    baseUrl: "",
    headersJson: "{}",
    providerName: "",
    organization: "",
    project: "",
    apiKeyConfigured: true,
    authTokenConfigured: false,
    source: "database",
  },
];
const syntheticProductDetail: ProductCatalogDetail = {
  sourceImages: [],
  version: 1,
  id: syntheticProduct.id,
  state: "PRODUCT_REVIEW_REQUIRED",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  productName: syntheticProduct.productName,
  internalSku: syntheticProduct.internalSku,
  productType: "clutch_kit",
  verificationStatus: "review_required",
  blockingFields: [],
  approvalStatus: "pending",
  approvalId: "00000000-0000-4000-8000-000000000302",
  draft: {
    record_id: syntheticProduct.id,
    source_ref: "source-product-001",
    evidence_refs: ["evidence-product-001"],
    field_evidence: {
      "product.product_name": "evidence-product-001",
      "product.product_type": "evidence-product-001",
      "product.internal_sku": "evidence-product-001",
      "product.oe_numbers": "evidence-product-001",
    },
    verification_status: "review_required",
    blocking_missing_fields: [],
    optional_missing_fields: [],
    product: {
      product_name: syntheticProduct.productName,
      product_type: "clutch_kit",
      internal_sku: syntheticProduct.internalSku,
      oe_numbers: ["OE-SYN-001"],
    },
  },
};
const syntheticContentDetail: ContentCatalogDetail = {
  version: 2,
  id: "00000000-0000-4000-8000-000000000303",
  state: "CONTENT_REVISION_REQUIRED",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  contentType: "product",
  productId: syntheticProduct.id,
  productName: syntheticProduct.productName,
  hook: "Ask about this verified clutch kit",
  approvalStatus: "rejected",
  approvalId: "00000000-0000-4000-8000-000000000304",
  content: {
    content_id: "00000000-0000-4000-8000-000000000303",
    product_id: syntheticProduct.id,
    content_type: "product",
    objective: "Generate qualified distributor inquiries",
    target_customer: "Overseas automotive parts distributors",
    platform: "pending-channel-decision",
    hook: "Ask about this verified clutch kit",
    body: "A concise, evidence-grounded product introduction.",
    product_facts: [
      {
        field: "product.product_name",
        value: syntheticProduct.productName,
        evidence_ref: "evidence-product-001",
      },
    ],
    call_to_action: "Contact our sales team",
    hashtags: ["#clutch"],
    visual_instruction: "Show only the supplied product image.",
    status: "revision_required",
  },
};

async function ProjectWorkflowFixture({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; kind?: string; record?: string }>;
}) {
  const { state, kind, record } = await searchParams;
  if (kind === "sales") {
    const context = (recordKind: SalesRelationRecord["kind"], id: string) => (
      <SalesContext
        projectId={syntheticSalesProject.id}
        records={syntheticRelations}
        kind={recordKind}
        id={id}
        canWrite
      />
    );
    const panels = {
      rfq: (
        <RfqDetail
          projectId={syntheticSalesProject.id}
          entry={syntheticRfq}
          leads={[syntheticLead]}
        >
          {context("rfq", syntheticRfq.id)}
        </RfqDetail>
      ),
      quotation: (
        <div className="space-y-6">
          {state === "quote-revision" ? context("quotation", syntheticQuote.id) : null}
          <QuotationPanel
            projectId={syntheticSalesProject.id}
            rfqs={[syntheticRfq]}
            products={[{ ...syntheticProduct, id: syntheticProduct.id }]}
            entries={state === "quote-revision" ? [syntheticQuote] : []}
            showCreateForm={state !== "quote-revision"}
            canReview
          />
        </div>
      ),
      lead: (
        <div className="space-y-6">
          {context("lead", syntheticLead.id)}
          <LeadPanel
            projectId={syntheticSalesProject.id}
            entries={[syntheticLead]}
            deliveries={[syntheticDelivery]}
          />
        </div>
      ),
      delivery: (
        <div className="space-y-6">
          {context("delivery", syntheticDelivery.id)}
          <DeliveryPanel
            projectId={syntheticSalesProject.id}
            entries={[syntheticDelivery]}
            canReview
          />
        </div>
      ),
      opportunity: <LeadPanel projectId={syntheticSalesProject.id} entries={[]} />,
    };
    const active = record === "lead" ? "lead" : (record ?? "lead");
    return (
      <WorkspaceDirtyProvider>
        <RecordFrame
          header={<h1 className="text-2xl font-semibold">{syntheticSalesProject.title}</h1>}
        >
          {panels[active as keyof typeof panels]}
        </RecordFrame>
      </WorkspaceDirtyProvider>
    );
  }
  const productDetail = state === "product-review" ? syntheticProductDetail : null;
  const contentDetail = state === "content-revision" ? syntheticContentDetail : null;
  const panels = {
    product: productDetail ? (
      <ProductReview
        projectId={syntheticMarketingProject.id}
        detail={productDetail}
        canReview
        evidenceOptions={[
          {
            id: "evidence-product-001",
            sourceLabel: "Synthetic review evidence",
            contentType: "text/plain",
            classification: "internal",
            createdAt: new Date("2026-09-01T00:00:00Z"),
          },
        ]}
        sourceDocuments={[
          {
            id: "evidence-product-001",
            label: "MOCK mixed source coverage",
            href: "/api/product-evidence/00000000-0000-4000-8000-000000000202/00000000-0000-4000-8000-000000000301/evidence-product-001",
            contentType: "text/plain",
            fields: [
              {
                path: "product.product_name",
                reference: "evidence-loc-synthetic-name",
                excerpt: "MOCK source text: Verified clutch kit",
              },
              { path: "product.internal_sku", reference: "evidence-product-001" },
            ],
          },
        ]}
      />
    ) : (
      <ProductIntakePanel
        projectId={syntheticMarketingProject.id}
        canReview
        agentModelConfigs={syntheticAgentModels}
        evidenceOptions={[]}
      />
    ),
    content: contentDetail ? (
      <ContentReview
        projectId={syntheticMarketingProject.id}
        detail={contentDetail}
        product={syntheticProduct}
        canReview
      />
    ) : (
      <ContentCreatePanel
        projectId={syntheticMarketingProject.id}
        products={state === "content-generation" ? syntheticGenerationProducts : [syntheticProduct]}
      />
    ),
    video: (
      <WorkspaceLink href={`/workspace/${syntheticMarketingProject.id}/video?new=1`}>
        按需制作视频
      </WorkspaceLink>
    ),
    publication: (
      <PublicationPanel
        projectId={syntheticMarketingProject.id}
        candidates={[]}
        channels={[]}
        publications={
          state === "unknown"
            ? [
                {
                  id: "22222222-2222-4222-8222-222222222222",
                  projectId: syntheticMarketingProject.id,
                  contentRef: "33333333-3333-4333-8333-333333333333",
                  format: "text",
                  channelRef: "synthetic-channel",
                  accountRef: "synthetic-account",
                  externalPublicationRef: null,
                  status: "unknown",
                  createdAt: new Date("2026-09-20T00:00:00Z"),
                },
              ]
            : []
        }
      />
    ),
  };
  const active = record ?? "product";
  return (
    <WorkspaceDirtyProvider>
      <RecordFrame
        header={<h1 className="text-2xl font-semibold">{syntheticMarketingProject.title}</h1>}
      >
        {panels[active as keyof typeof panels]}
      </RecordFrame>
    </WorkspaceDirtyProvider>
  );
}

/** Test-only fixture: production project access remains permission protected. */
export default function ProjectWorkflowTestingPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; kind?: string; record?: string }>;
}) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <Suspense fallback={null}>
      <ProjectWorkflowFixture searchParams={searchParams} />
    </Suspense>
  );
}
