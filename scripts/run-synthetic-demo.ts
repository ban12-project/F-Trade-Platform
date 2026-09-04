import contentSchemaJson from "../contracts/content/content.schema.json";
import productSchemaJson from "../contracts/data/product-ready.schema.json";
import quotationSchemaJson from "../contracts/sales/quotation-handoff.schema.json";
import rfqSchemaJson from "../contracts/sales/rfq-ready.schema.json";
import contentFixture from "../data/fixtures/content-draft.synthetic.json";
import productFixture from "../data/fixtures/product-ready.synthetic.json";
import quotationFixture from "../data/fixtures/quotation-handoff.synthetic.json";
import rfqFixture from "../data/fixtures/rfq-ready.synthetic.json";
import { decideContent } from "../lib/content/gate";
import { publishThroughChannel } from "../lib/content/publication-policy";
import { compileContract } from "../lib/contracts/validator";
import {
  decideDeliveryConfirmation,
  requestDeliveryConfirmation,
} from "../lib/delivery/confirmation";
import {
  acceptInboundChannelEvent,
  assessInboundDelivery,
  assessReplyWindow,
} from "../lib/social/inbound-policy";
import { createControlledPublicationCommand } from "../lib/social/publication-command";
import {
  signPublicationWorkerResult,
  verifyPublicationWorkerResult,
} from "../lib/social/publication-result-protocol";
import {
  type ApprovalDecision,
  replayTransitions,
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
    transport: "camofox_controlled_mvp1";
    jobStatus: "succeeded";
    signedResultVerified: true;
  };
  followUp: { actorType: "human"; replyWindowRevalidated: true };
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
  const [
    productSchema,
    contentSchema,
    rfqSchema,
    quotationSchema,
    product,
    content,
    rfq,
    quotation,
  ] = [
    productSchemaJson,
    contentSchemaJson,
    rfqSchemaJson,
    quotationSchemaJson,
    productFixture,
    contentFixture,
    rfqFixture,
    quotationFixture,
  ] as unknown as [
    JsonObject,
    JsonObject,
    JsonObject,
    JsonObject,
    JsonObject,
    JsonObject,
    JsonObject,
    JsonObject,
  ];

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
  const deliveryConfirmationId = "synthetic-delivery-confirmation-001";
  const socialPolicy = {
    channelRef: "synthetic-facebook-channel",
    accountRef: "synthetic-factory-account",
    transport: "camofox_controlled_mvp1" as const,
    inboundOnly: true,
    replyWindowMinutes: 60,
    outsideWindowAction: "require_approved_template" as const,
  };
  const publicationPolicy = {
    channelRef: "synthetic-facebook-channel",
    accountRef: "synthetic-factory-account",
    transport: "camofox_controlled_mvp1" as const,
    publishingEnabled: true,
  };
  const inboundMessage = {
    messageId: "synthetic-platform-message-001",
    direction: "inbound" as const,
    receivedAt: "2026-08-24T08:59:00Z",
  };
  const inboundDelivery = acceptInboundChannelEvent(
    socialPolicy,
    {
      transport: "controlled_browser_observation",
      channelRef: socialPolicy.channelRef,
      accountRef: socialPolicy.accountRef,
      observationRef: "synthetic-observation-001",
      messageIdentityQuality: "derived_fingerprint",
      ...inboundMessage,
    },
    new Set(),
  );
  if (inboundDelivery.status !== "accepted")
    throw new Error("Synthetic inbound message was not accepted");
  const duplicateDelivery = assessInboundDelivery(
    socialPolicy,
    inboundMessage,
    new Set([inboundDelivery.deliveryKey]),
  );
  if (duplicateDelivery.status !== "duplicate")
    throw new Error("Synthetic duplicate message was not rejected");
  const replyWindow = assessReplyWindow(socialPolicy, inboundMessage, "2026-08-24T09:00:00Z");
  const outsideWindow = assessReplyWindow(socialPolicy, inboundMessage, "2026-08-24T10:00:00Z");
  if (
    replyWindow.status !== "within_window" ||
    outsideWindow.nextAction !== "require_human_approved_template"
  ) {
    throw new Error("Synthetic inbound reply-window policy was not enforced");
  }
  const productApproval = approval(
    "synthetic-approval-001",
    productId,
    "gate_01_truth",
    "approved",
    "synthetic-reviewer",
  );
  const contentApproval = approval(
    "synthetic-content-approval-001",
    contentId,
    "gate_01_truth",
    "approved",
    "synthetic-reviewer",
  );
  const quoteApproval = approval(
    "synthetic-quote-approval-001",
    quotationId,
    "gate_02_quote",
    "approved",
    "synthetic-sales-reviewer",
  );
  const deliveryApproval = approval(
    "synthetic-delivery-approval-001",
    deliveryConfirmationId,
    "gate_03_delivery",
    "approved",
    "synthetic-delivery-reviewer",
  );
  const deliveryRequest = requestDeliveryConfirmation({
    confirmationId: deliveryConfirmationId,
    relatedEntityType: "rfq",
    relatedEntityId: rfqId,
    requestedByType: "human",
    requestedById: "synthetic-sales-user",
    requestedAt: "2026-08-24T09:09:30Z",
  });
  decideDeliveryConfirmation(deliveryRequest, {
    actorType: "human",
    actorId: "synthetic-delivery-reviewer",
    status: "confirmed",
    approvalRef: deliveryApproval.id,
    evidenceRef: deliveryApproval.evidenceRef,
    decidedAt: "2026-08-24T09:09:45Z",
    leadTimeDays: 21,
    validUntil: "2026-08-31T09:09:45Z",
  });
  const approvedContent = decideContent(content, {
    actorType: "human",
    approved: true,
    approvalRef: contentApproval.id,
    evidenceRef: contentApproval.evidenceRef,
  });
  const publicationId = "synthetic-publication-001";
  const publicationCommand = createControlledPublicationCommand(
    approvedContent,
    publicationPolicy,
    {
      channelRef: publicationPolicy.channelRef,
      accountRef: publicationPolicy.accountRef,
      status: "active",
      stopReason: null,
      pausedAt: null,
    },
    {
      publicationId,
      contentRef: contentId,
      format: "text",
      humanConfirmationRef: "synthetic-human-confirmation-001",
      confirmedBy: "human",
    },
  );
  if (publicationCommand.jobKind !== "publish")
    throw new Error("Synthetic publication was not submitted to the controlled worker");
  process.env.SOCIAL_WORKER_SIGNING_KEY ??= Buffer.alloc(32, 11).toString("base64");
  const publicationResult = signPublicationWorkerResult({
    workerId: "synthetic-worker-001",
    jobId: "30000000-0000-4000-8000-000000000001",
    outcome: "published",
    externalPublicationRef: publicationId,
    observedAt: "2026-08-24T09:04:00.000Z",
  });
  verifyPublicationWorkerResult(
    publicationResult,
    "synthetic-worker-001",
    new Date("2026-08-24T09:04:00.000Z"),
  );
  const publishedContent = publishThroughChannel(
    approvedContent,
    publicationPolicy,
    "system",
    "synthetic-publication-001",
  );
  if (publishedContent.status !== "published")
    throw new Error("Synthetic publication policy was not enforced");

  const productEvents = [
    {
      event: event(
        "synthetic-product-submit-001",
        "product",
        productId,
        "PRODUCT_IMPORTED",
        "PRODUCT_REVIEW_REQUIRED",
        "agent",
        "synthetic-product-agent",
        "2026-08-24T09:00:00Z",
      ),
    },
    {
      event: event(
        "synthetic-product-approved-001",
        "product",
        productId,
        "PRODUCT_REVIEW_REQUIRED",
        "PRODUCT_READY",
        "human",
        "synthetic-reviewer",
        "2026-08-24T09:01:00Z",
        "gate_01_truth",
        productApproval.id,
      ),
      approval: productApproval,
    },
  ];
  const contentEvents = [
    {
      event: event(
        "synthetic-content-generated-001",
        "content",
        contentId,
        "CONTENT_GENERATING",
        "CONTENT_REVIEW_REQUIRED",
        "agent",
        "synthetic-content-agent",
        "2026-08-24T09:02:00Z",
      ),
    },
    {
      event: event(
        "synthetic-content-approved-001",
        "content",
        contentId,
        "CONTENT_REVIEW_REQUIRED",
        "CONTENT_APPROVED",
        "human",
        "synthetic-reviewer",
        "2026-08-24T09:03:00Z",
        "gate_01_truth",
        contentApproval.id,
      ),
      approval: contentApproval,
    },
    {
      event: event(
        "synthetic-content-published-001",
        "content",
        contentId,
        "CONTENT_APPROVED",
        "CONTENT_PUBLISHED",
        "system",
        "synthetic-publishing-adapter",
        "2026-08-24T09:04:00Z",
      ),
    },
  ];
  const videoId = "synthetic-video-demo-001";
  const videoEvents = [
    {
      event: event(
        "synthetic-video-review-001",
        "video",
        videoId,
        "VIDEO_DRAFT",
        "VIDEO_REVIEW_REQUIRED",
        "human",
        "synthetic-video-editor",
        "2026-08-24T09:02:30Z",
      ),
    },
    {
      event: event(
        "synthetic-video-approved-001",
        "video",
        videoId,
        "VIDEO_REVIEW_REQUIRED",
        "VIDEO_APPROVED",
        "human",
        "synthetic-reviewer",
        "2026-08-24T09:03:30Z",
        "gate_01_truth",
        "synthetic-video-approval-001",
      ),
      approval: approval(
        "synthetic-video-approval-001",
        videoId,
        "gate_01_truth",
        "approved",
        "synthetic-reviewer",
      ),
    },
  ];
  const rfqEvents = [
    {
      event: event(
        "synthetic-rfq-ready-001",
        "rfq",
        rfqId,
        "RFQ_COLLECTING",
        "RFQ_READY",
        "agent",
        "synthetic-sales-agent",
        "2026-08-24T09:05:00Z",
      ),
    },
  ];
  const quotationEvents = [
    {
      event: event(
        "synthetic-quote-review-001",
        "quotation",
        quotationId,
        "QUOTE_DRAFT",
        "QUOTE_REVIEW_REQUIRED",
        "human",
        "synthetic-sales-user",
        "2026-08-24T09:06:00Z",
      ),
    },
    {
      event: event(
        "synthetic-quote-approved-001",
        "quotation",
        quotationId,
        "QUOTE_REVIEW_REQUIRED",
        "QUOTE_APPROVED",
        "human",
        "synthetic-sales-reviewer",
        "2026-08-24T09:07:00Z",
        "gate_02_quote",
        quoteApproval.id,
      ),
      approval: quoteApproval,
    },
    {
      event: event(
        "synthetic-quote-sent-001",
        "quotation",
        quotationId,
        "QUOTE_APPROVED",
        "QUOTE_SENT",
        "human",
        "synthetic-sales-user",
        "2026-08-24T09:08:00Z",
      ),
    },
  ];
  const leadEvents = [
    {
      event: event(
        "synthetic-lead-follow-up-001",
        "lead",
        leadId,
        "LEAD_RECEIVED",
        "FOLLOW_UP",
        "human",
        "synthetic-sales-user",
        "2026-08-24T09:09:00Z",
      ),
    },
    {
      event: event(
        "synthetic-lead-opportunity-001",
        "lead",
        leadId,
        "FOLLOW_UP",
        "OPPORTUNITY",
        "human",
        "synthetic-sales-user",
        "2026-08-24T09:10:00Z",
      ),
    },
  ];
  const deliveryEvents = [
    {
      event: event(
        "synthetic-delivery-confirmed-001",
        "delivery_confirmation",
        deliveryConfirmationId,
        "DELIVERY_CONFIRMATION_PENDING",
        "DELIVERY_CONFIRMATION_CONFIRMED",
        "human",
        "synthetic-delivery-reviewer",
        "2026-08-24T09:09:45Z",
        "gate_03_delivery",
        deliveryApproval.id,
      ),
      approval: deliveryApproval,
    },
  ];

  const finalStates = {
    product: replayTransitions("product", productId, "PRODUCT_IMPORTED", productEvents),
    content: replayTransitions("content", contentId, "CONTENT_GENERATING", contentEvents),
    video: replayTransitions("video", videoId, "VIDEO_DRAFT", videoEvents),
    rfq: replayTransitions("rfq", rfqId, "RFQ_COLLECTING", rfqEvents),
    quotation: replayTransitions("quotation", quotationId, "QUOTE_DRAFT", quotationEvents),
    lead: replayTransitions("lead", leadId, "LEAD_RECEIVED", leadEvents),
    delivery: replayTransitions(
      "delivery_confirmation",
      deliveryConfirmationId,
      "DELIVERY_CONFIRMATION_PENDING",
      deliveryEvents,
    ),
  };
  const transitionCount = [
    productEvents,
    contentEvents,
    videoEvents,
    rfqEvents,
    quotationEvents,
    leadEvents,
    deliveryEvents,
  ].reduce((count, events) => count + events.length, 0);

  return {
    classification: "synthetic",
    finalStates,
    transitionCount,
    approvedGates: ["gate_01_truth", "gate_02_quote", "gate_03_delivery"],
    inboundMessaging: {
      deliveryStatus: inboundDelivery.status,
      duplicateStatus: duplicateDelivery.status,
      replyWindowStatus: replyWindow.status,
      outsideWindowAction: outsideWindow.nextAction,
    },
    publicationTransport: {
      status: publishedContent.status,
      transport: publicationPolicy.transport,
      jobStatus: "succeeded",
      signedResultVerified: true,
    },
    followUp: { actorType: "human", replyWindowRevalidated: true },
  };
}

if (process.argv[1]?.endsWith("run-synthetic-demo.ts")) {
  runSyntheticDemo().then((report) => console.log(JSON.stringify(report, null, 2)));
}
