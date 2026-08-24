import { readFile } from "node:fs/promises";
import path from "node:path";

import { compileContract } from "../lib/contracts/validator";
import { decideContent } from "../lib/content/gate";
import { publishThroughOfficialChannel } from "../lib/content/publication-policy";
import { acceptOfficialInboundWebhook, assessInboundDelivery, assessReplyWindow } from "../lib/social/inbound-policy";
import {
  replayTransitions,
  type ApprovalDecision,
  type WorkflowEventInput,
} from "../lib/workflow/transitions";

type JsonObject = Record<string, unknown>;

export interface SyntheticDemoReport {
  classification: "synthetic";
  finalStates: Record<string, string>;
  transitionCount: number;
  approvedGates: string[];
  inboundMessaging: {
    deliveryStatus: "accepted";
    duplicateStatus: "duplicate";
    replyWindowStatus: "within_window";
    outsideWindowAction: "require_human_approved_template";
  };
  publicationTransport: {
    status: "published";
    officialApi: true;
  };
}

async function loadJson(relativePath: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path.join(process.cwd(), relativePath), "utf8")) as JsonObject;
}

function event(
  eventId: string,
  entityType: WorkflowEventInput["entityType"],
  entityId: string,
  fromState: string,
  toState: string,
  actorType: WorkflowEventInput["actorType"],
  actorId: string,
  occurredAt: string,
  gate?: WorkflowEventInput["gate"],
  approvalRef?: string,
): WorkflowEventInput {
  return {
    eventId,
    entityType,
    entityId,
    fromState,
    toState,
    actorType,
    actorId,
    occurredAt,
    evidenceRefs: [`evidence:${eventId}`],
    gate,
    approvalRef,
  };
}

function approval(
  id: string,
  aggregateId: string,
  gate: ApprovalDecision["gate"],
  status: ApprovalDecision["status"],
  actorId: string,
): ApprovalDecision {
  return {
    id,
    aggregateId,
    gate,
    status,
    decidedByType: "human",
    decidedById: actorId,
    evidenceRef: `evidence:${id}`,
  };
}

function assertSyntheticIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.startsWith("synthetic-")) {
    throw new Error(`Synthetic demo rejected: ${label} must use a synthetic identifier`);
  }
}

export async function runSyntheticDemo(): Promise<SyntheticDemoReport> {
  const [productSchema, contentSchema, rfqSchema, quotationSchema, product, content, rfq, quotation] =
    await Promise.all([
      loadJson("contracts/data/product-ready.schema.json"),
      loadJson("contracts/content/content.schema.json"),
      loadJson("contracts/sales/rfq-ready.schema.json"),
      loadJson("contracts/sales/quotation-handoff.schema.json"),
      loadJson("data/fixtures/product-ready.synthetic.json"),
      loadJson("data/fixtures/content-draft.synthetic.json"),
      loadJson("data/fixtures/rfq-ready.synthetic.json"),
      loadJson("data/fixtures/quotation-handoff.synthetic.json"),
    ]);

  compileContract<JsonObject>(productSchema)(product);
  compileContract<JsonObject>(contentSchema)(content);
  compileContract<JsonObject>(rfqSchema)(rfq);
  compileContract<JsonObject>(quotationSchema)(quotation);

  assertSyntheticIdentifier(product.record_id, "product.record_id");
  assertSyntheticIdentifier(content.content_id, "content.content_id");
  assertSyntheticIdentifier(rfq.rfq_id, "rfq.rfq_id");
  assertSyntheticIdentifier(quotation.handoff_id, "quotation.handoff_id");

  const productId = product.record_id;
  const contentId = content.content_id;
  const rfqId = rfq.rfq_id;
  const quotationId = quotation.handoff_id;
  const leadId = "synthetic-lead-demo-001";
  const socialPolicy = {
    channelRef: "synthetic-instagram-channel",
    accountRef: "synthetic-factory-account",
    officialApi: true as const,
    inboundOnly: true,
    replyWindowMinutes: 60,
    outsideWindowAction: "require_approved_template" as const,
  };
  const publicationPolicy = {
    channelRef: "synthetic-instagram-channel",
    accountRef: "synthetic-factory-account",
    officialApi: true as const,
    publishingEnabled: true,
  };
  const inboundMessage = {
    messageId: "synthetic-platform-message-001",
    direction: "inbound" as const,
    receivedAt: "2026-08-24T08:59:00Z",
  };
  const inboundDelivery = acceptOfficialInboundWebhook(socialPolicy, {
    transport: "official_webhook",
    channelRef: socialPolicy.channelRef,
    accountRef: socialPolicy.accountRef,
    ...inboundMessage,
  }, new Set());
  if (inboundDelivery.status !== "accepted") throw new Error("Synthetic inbound message was not accepted");
  const duplicateDelivery = assessInboundDelivery(
    socialPolicy,
    inboundMessage,
    new Set([inboundDelivery.deliveryKey]),
  );
  if (duplicateDelivery.status !== "duplicate") throw new Error("Synthetic duplicate message was not rejected");
  const replyWindow = assessReplyWindow(socialPolicy, inboundMessage, "2026-08-24T09:00:00Z");
  const outsideWindow = assessReplyWindow(socialPolicy, inboundMessage, "2026-08-24T10:00:00Z");
  if (replyWindow.status !== "within_window" || outsideWindow.nextAction !== "require_human_approved_template") {
    throw new Error("Synthetic inbound reply-window policy was not enforced");
  }
  const productApproval = approval("synthetic-approval-001", productId, "gate_01_truth", "approved", "synthetic-reviewer");
  const contentApproval = approval("synthetic-content-approval-001", contentId, "gate_01_truth", "approved", "synthetic-reviewer");
  const quoteApproval = approval("synthetic-quote-approval-001", quotationId, "gate_02_quote", "approved", "synthetic-sales-reviewer");
  const approvedContent = decideContent(content, {
    actorType: "human",
    approved: true,
    approvalRef: contentApproval.id,
    evidenceRef: contentApproval.evidenceRef,
  });
  const publishedContent = publishThroughOfficialChannel(
    approvedContent,
    publicationPolicy,
    "system",
    "synthetic-publication-001",
  );
  if (publishedContent.status !== "published") throw new Error("Synthetic official publication policy was not enforced");

  const productEvents = [
    { event: event("synthetic-product-submit-001", "product", productId, "PRODUCT_IMPORTED", "PRODUCT_REVIEW_REQUIRED", "agent", "synthetic-product-agent", "2026-08-24T09:00:00Z") },
    { event: event("synthetic-product-approved-001", "product", productId, "PRODUCT_REVIEW_REQUIRED", "PRODUCT_READY", "human", "synthetic-reviewer", "2026-08-24T09:01:00Z", "gate_01_truth", productApproval.id), approval: productApproval },
  ];
  const contentEvents = [
    { event: event("synthetic-content-generated-001", "content", contentId, "CONTENT_GENERATING", "CONTENT_REVIEW_REQUIRED", "agent", "synthetic-content-agent", "2026-08-24T09:02:00Z") },
    { event: event("synthetic-content-approved-001", "content", contentId, "CONTENT_REVIEW_REQUIRED", "CONTENT_APPROVED", "human", "synthetic-reviewer", "2026-08-24T09:03:00Z", "gate_01_truth", contentApproval.id), approval: contentApproval },
    { event: event("synthetic-content-published-001", "content", contentId, "CONTENT_APPROVED", "CONTENT_PUBLISHED", "system", "synthetic-publishing-adapter", "2026-08-24T09:04:00Z") },
  ];
  const rfqEvents = [
    { event: event("synthetic-rfq-ready-001", "rfq", rfqId, "RFQ_COLLECTING", "RFQ_READY", "agent", "synthetic-sales-agent", "2026-08-24T09:05:00Z") },
  ];
  const quotationEvents = [
    { event: event("synthetic-quote-review-001", "quotation", quotationId, "QUOTE_DRAFT", "QUOTE_REVIEW_REQUIRED", "human", "synthetic-sales-user", "2026-08-24T09:06:00Z") },
    { event: event("synthetic-quote-approved-001", "quotation", quotationId, "QUOTE_REVIEW_REQUIRED", "QUOTE_APPROVED", "human", "synthetic-sales-reviewer", "2026-08-24T09:07:00Z", "gate_02_quote", quoteApproval.id), approval: quoteApproval },
    { event: event("synthetic-quote-sent-001", "quotation", quotationId, "QUOTE_APPROVED", "QUOTE_SENT", "system", "synthetic-quotation-adapter", "2026-08-24T09:08:00Z") },
  ];
  const leadEvents = [
    { event: event("synthetic-lead-follow-up-001", "lead", leadId, "LEAD_RECEIVED", "FOLLOW_UP", "agent", "synthetic-follow-up-agent", "2026-08-24T09:09:00Z") },
    { event: event("synthetic-lead-opportunity-001", "lead", leadId, "FOLLOW_UP", "OPPORTUNITY", "agent", "synthetic-follow-up-agent", "2026-08-24T09:10:00Z") },
  ];

  const finalStates = {
    product: replayTransitions("product", productId, "PRODUCT_IMPORTED", productEvents),
    content: replayTransitions("content", contentId, "CONTENT_GENERATING", contentEvents),
    rfq: replayTransitions("rfq", rfqId, "RFQ_COLLECTING", rfqEvents),
    quotation: replayTransitions("quotation", quotationId, "QUOTE_DRAFT", quotationEvents),
    lead: replayTransitions("lead", leadId, "LEAD_RECEIVED", leadEvents),
  };
  const transitionCount = [productEvents, contentEvents, rfqEvents, quotationEvents, leadEvents]
    .reduce((count, events) => count + events.length, 0);

  return {
    classification: "synthetic",
    finalStates,
    transitionCount,
    approvedGates: ["gate_01_truth", "gate_02_quote"],
    inboundMessaging: {
      deliveryStatus: inboundDelivery.status,
      duplicateStatus: duplicateDelivery.status,
      replyWindowStatus: replyWindow.status,
      outsideWindowAction: outsideWindow.nextAction,
    },
    publicationTransport: {
      status: publishedContent.status,
      officialApi: publicationPolicy.officialApi,
    },
  };
}

if (process.argv[1]?.endsWith("run-synthetic-demo.ts")) {
  runSyntheticDemo().then((report) => console.log(JSON.stringify(report, null, 2)));
}
