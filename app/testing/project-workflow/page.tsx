import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  DeliveryPanel,
  LeadPanel,
  PublicationPanel,
  QuotationPanel,
} from "@/components/workspace/closing-panels";
import { ContentPanel } from "@/components/workspace/content-panel";
import { ProductPanel } from "@/components/workspace/product-panel";
import {
  type ProjectStage,
  ProjectWorkspace,
  VideoStageEntry,
} from "@/components/workspace/project-workspace";
import { SalesContext } from "@/components/workspace/sales-context";
import { RfqPanel } from "@/components/workspace/sales-panels";
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
import type { WorkspaceProjectSummary } from "@/lib/workspace/store";

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
const syntheticProjects: WorkspaceProjectSummary[] = [
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
  id: syntheticLead.confirmedDelivery!.id,
  state: "DELIVERY_CONFIRMATION_CONFIRMED",
  createdAt: syntheticRfq.createdAt,
  approvalId: null,
  approvalStatus: "approved",
  confirmation: {
    related_entity_type: "rfq",
    related_entity_id: syntheticRfq.id,
    result: {
      confirmed_lead_time_days: 21,
      valid_until: syntheticLead.confirmedDelivery!.validUntil,
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

const marketingStages: ProjectStage[] = [
  {
    id: "product",
    panelKind: "product",
    label: "产品资料",
    description: "导入资料，补全字段并完成产品事实核验。",
  },
  {
    id: "content",
    panelKind: "content",
    label: "营销内容",
    description: "基于已核验产品事实生成、修改并审核营销内容。",
  },
  {
    id: "video",
    panelKind: "video",
    label: "营销视频",
    description: "选择授权素材，在独立编辑器生成剪辑初稿、预览并提审。",
  },
  {
    id: "publication",
    panelKind: "publication",
    label: "发布",
    description: "人工确认渠道、账户与载荷，提交后等待平台回执。",
  },
];
const salesStages: ProjectStage[] = [
  {
    id: "inbound",
    panelKind: "lead",
    label: "客户线索",
    description: "查看已关联到当前项目的询盘、消息和跟进上下文。",
  },
  {
    id: "rfq",
    panelKind: "rfq",
    label: "需求确认",
    description: "补齐产品身份、数量、目的地、证据与产品引用。",
  },
  {
    id: "quotation",
    panelKind: "quotation",
    label: "报价",
    description: "人工录入价格与商业条款，并完成报价确认。",
  },
  {
    id: "follow-up",
    panelKind: "lead",
    label: "跟进",
    description: "人工编辑并发送回复，安排下一次跟进。",
  },
  {
    id: "delivery",
    panelKind: "delivery",
    label: "交期",
    description: "客户询问交期时发起并完成人工确认。",
  },
  {
    id: "opportunity",
    panelKind: "lead",
    label: "商机",
    description: "达到条件后，仍由业务人员显式确认有效商机。",
  },
];

async function ProjectWorkflowFixture({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; kind?: string; panel?: string }>;
}) {
  const { state, kind, panel } = await searchParams;
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
        <RfqPanel
          projectId={syntheticSalesProject.id}
          entries={[syntheticRfq]}
          selectedId={syntheticRfq.id}
          leads={[syntheticLead]}
        >
          {context("rfq", syntheticRfq.id)}
        </RfqPanel>
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
    const active = salesStages.some((stage) => stage.id === panel)
      ? panel!
      : panel === "lead"
        ? "follow-up"
        : "inbound";
    const panelKind = salesStages.find((stage) => stage.id === active)!.panelKind;
    const activePanel =
      active === "opportunity" ? panels.opportunity : panels[panelKind as keyof typeof panels];
    return (
      <ProjectWorkspace
        project={syntheticSalesProject}
        tasks={[]}
        stages={salesStages}
        activeStage={active}
        panel={activePanel}
        basePath="/testing/project-workflow"
      />
    );
  }
  const productDetail = state === "product-review" ? syntheticProductDetail : null;
  const contentDetail = state === "content-revision" ? syntheticContentDetail : null;
  const panels = {
    product: (
      <ProductPanel
        projectId={syntheticMarketingProject.id}
        entries={productDetail ? [productDetail] : []}
        detail={productDetail}
        canReview
        agentModelConfigs={syntheticAgentModels}
        evidenceOptions={
          productDetail
            ? [
                {
                  id: "evidence-product-001",
                  sourceLabel: "Synthetic review evidence",
                  contentType: "text/plain",
                  classification: "internal",
                  createdAt: new Date("2026-09-01T00:00:00Z"),
                },
              ]
            : []
        }
      />
    ),
    content: (
      <ContentPanel
        projectId={syntheticMarketingProject.id}
        products={[syntheticProduct]}
        entries={contentDetail ? [contentDetail] : []}
        copyCandidates={[]}
        detail={contentDetail}
        canReview
      />
    ),
    video: (
      <VideoStageEntry
        projectId={syntheticMarketingProject.id}
        count={1}
        pendingReview={state === "review" ? 1 : 0}
      />
    ),
    publication: (
      <PublicationPanel
        projectId={syntheticMarketingProject.id}
        candidates={[]}
        channels={[]}
        publications={[]}
      />
    ),
  };
  const active = marketingStages.some((stage) => stage.id === panel) ? panel! : "product";
  return (
    <ProjectWorkspace
      project={syntheticMarketingProject}
      tasks={[]}
      stages={marketingStages}
      activeStage={active}
      panel={panels[active as keyof typeof panels]}
      basePath="/testing/project-workflow"
    />
  );
}

/** Test-only fixture: production project access remains permission protected. */
export default function ProjectWorkflowTestingPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; kind?: string; panel?: string }>;
}) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <Suspense fallback={null}>
      <ProjectWorkflowFixture searchParams={searchParams} />
    </Suspense>
  );
}
