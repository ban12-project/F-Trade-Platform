import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

export const actorType = pgEnum("actor_type", ["agent", "human", "system"]);
export const aggregateType = pgEnum("aggregate_type", [
  "product",
  "content",
  "video",
  "rfq",
  "quotation",
  "lead",
  "delivery_confirmation",
]);
export const approvalGate = pgEnum("approval_gate", [
  "gate_01_truth",
  "gate_02_quote",
  "gate_03_delivery",
]);
export const approvalStatus = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
]);
export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);
export const evidenceClassification = pgEnum("evidence_classification", [
  "internal",
  "confidential",
  "restricted",
]);
export const videoJobStatus = pgEnum("video_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const videoUploadReceiptStatus = pgEnum("video_upload_receipt_status", [
  "issued",
  "uploaded",
  "claimed",
  "failed",
]);
export const videoProcessingJobKind = pgEnum("video_processing_job_kind", [
  "ai_draft",
  "render",
]);
export const videoProcessingJobStatus = pgEnum("video_processing_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export const videoReviewStage = pgEnum("video_review_stage", ["pre_generation", "post_generation"]);
export const videoReviewOutcome = pgEnum("video_review_outcome", ["accepted", "changes_requested", "skipped"]);
export const workspaceProjectKind = pgEnum("workspace_project_kind", ["marketing", "sales"]);
export const workspaceProjectStatus = pgEnum("workspace_project_status", ["active", "archived"]);
export const workspaceProjectMemberRole = pgEnum("workspace_project_member_role", ["owner", "editor", "viewer"]);
export const workspaceItemRelation = pgEnum("workspace_item_relation", ["owned", "reference"]);

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    role: text("role").default("user").notNull(),
    banned: boolean("banned").default(false).notNull(),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("user_email_uidx").on(table.email)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [
    uniqueIndex("session_token_uidx").on(table.token),
    index("session_user_id_idx").on(table.userId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    uniqueIndex("account_provider_account_uidx").on(table.providerId, table.accountId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const passkey = pgTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: createdAt(),
    aaguid: text("aaguid"),
  },
  (table) => [
    index("passkey_user_id_idx").on(table.userId),
    uniqueIndex("passkey_credential_id_uidx").on(table.credentialID),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    role: text("role").default("user").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: invitationStatus("status").default("pending").notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    acceptedBy: text("accepted_by").references(() => user.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("invitation_token_hash_uidx").on(table.tokenHash),
    index("invitation_email_status_idx").on(table.email, table.status),
    check(
      "invitation_acceptance_consistent",
      sql`(${table.status} = 'accepted' AND ${table.acceptedBy} IS NOT NULL AND ${table.acceptedAt} IS NOT NULL) OR (${table.status} <> 'accepted' AND ${table.acceptedBy} IS NULL AND ${table.acceptedAt} IS NULL)`,
    ),
  ],
);

export const aggregateRecord = pgTable(
  "aggregate_record",
  {
    id: text("id").primaryKey(),
    type: aggregateType("type").notNull(),
    state: text("state").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    version: integer("version").default(1).notNull(),
    createdByType: actorType("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("aggregate_type_state_idx").on(table.type, table.state),
    check("aggregate_version_positive", sql`${table.version} > 0`),
    check("aggregate_creator_nonempty", sql`length(btrim(${table.createdById})) > 0`),
  ],
);

export const approval = pgTable(
  "approval",
  {
    id: text("id").primaryKey(),
    aggregateId: text("aggregate_id")
      .notNull()
      .references(() => aggregateRecord.id, { onDelete: "restrict" }),
    gate: approvalGate("gate").notNull(),
    status: approvalStatus("status").default("pending").notNull(),
    requestedByType: actorType("requested_by_type").notNull(),
    requestedById: text("requested_by_id").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    decidedByType: actorType("decided_by_type"),
    decidedById: text("decided_by_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    evidenceRef: text("evidence_ref"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (table) => [
    index("approval_pending_gate_idx").on(table.status, table.gate),
    index("approval_aggregate_id_idx").on(table.aggregateId),
    check(
      "approval_decision_consistent",
      sql`(${table.status} = 'pending' AND ${table.decidedByType} IS NULL AND ${table.decidedById} IS NULL AND ${table.decidedAt} IS NULL AND ${table.evidenceRef} IS NULL) OR (${table.status} IN ('approved', 'rejected') AND ${table.decidedByType} = 'human' AND length(btrim(${table.decidedById})) > 0 AND ${table.decidedAt} IS NOT NULL AND length(btrim(${table.evidenceRef})) > 0)`,
    ),
    check("approval_requester_nonempty", sql`length(btrim(${table.requestedById})) > 0`),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    classification: evidenceClassification("classification").notNull(),
    blobKey: text("blob_key").notNull(),
    contentType: text("content_type").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sourceLabel: text("source_label").notNull(),
    uploadedByType: actorType("uploaded_by_type").notNull(),
    uploadedById: text("uploaded_by_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("evidence_blob_key_uidx").on(table.blobKey),
    uniqueIndex("evidence_sha256_uidx").on(table.sha256),
    check("evidence_size_nonnegative", sql`${table.sizeBytes} >= 0`),
    check("evidence_uploader_nonempty", sql`length(btrim(${table.uploadedById})) > 0`),
  ],
);

export const workflowEvent = pgTable(
  "workflow_event",
  {
    id: text("id").primaryKey(),
    aggregateId: text("aggregate_id")
      .notNull()
      .references(() => aggregateRecord.id, { onDelete: "restrict" }),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    gate: approvalGate("gate"),
    approvalId: text("approval_id").references(() => approval.id, { onDelete: "restrict" }),
    evidenceRefs: jsonb("evidence_refs").$type<string[]>().default([]).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("workflow_event_aggregate_time_idx").on(table.aggregateId, table.occurredAt),
    check("workflow_state_changes", sql`${table.fromState} <> ${table.toState}`),
    check("workflow_actor_nonempty", sql`length(btrim(${table.actorId})) > 0`),
    check(
      "workflow_gate_reference_consistent",
      sql`(${table.gate} IS NULL AND ${table.approvalId} IS NULL) OR (${table.gate} IS NOT NULL AND ${table.approvalId} IS NOT NULL)`,
    ),
  ],
);

export const auditEvent = pgTable(
  "audit_event",
  {
    id: text("id").primaryKey(),
    action: text("action").notNull(),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    aggregateId: text("aggregate_id").references(() => aggregateRecord.id, {
      onDelete: "restrict",
    }),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_subject_time_idx").on(table.subjectType, table.subjectId, table.occurredAt),
    index("audit_actor_time_idx").on(table.actorType, table.actorId, table.occurredAt),
    check("audit_actor_nonempty", sql`length(btrim(${table.actorId})) > 0`),
  ],
);

/**
 * Durable, metadata-only execution record for a video request. Generated
 * files remain in private object storage and are referenced by opaque IDs.
 */
export const videoJob = pgTable(
  "video_job",
  {
    id: text("id").primaryKey(),
    videoProjectId: text("video_project_id")
      .notNull()
      .references(() => aggregateRecord.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    requiredCapabilities: jsonb("required_capabilities").$type<string[]>().default([]).notNull(),
    aspectRatio: text("aspect_ratio").default("16:9").notNull(),
    durationSeconds: integer("duration_seconds").default(1).notNull(),
    resolution: text("resolution").default("1280x720").notNull(),
    expectedCostCents: integer("expected_cost_cents").default(1).notNull(),
    reservedCostCents: integer("reserved_cost_cents").default(0).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: videoJobStatus("status").default("queued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    providerJobRef: text("provider_job_ref"),
    resultAssetRef: text("result_asset_ref"),
    failureCode: text("failure_code"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    claimedBy: text("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("video_job_idempotency_uidx").on(table.idempotencyKey),
    index("video_job_status_next_attempt_idx").on(table.status, table.nextAttemptAt),
    index("video_job_video_project_idx").on(table.videoProjectId),
    check("video_job_attempts_nonnegative", sql`${table.attempts} >= 0`),
    check("video_job_provider_nonempty", sql`length(btrim(${table.provider})) > 0`),
    check("video_job_model_nonempty", sql`length(btrim(${table.modelId})) > 0`),
    check("video_job_duration_positive", sql`${table.durationSeconds} > 0`),
    check("video_job_expected_cost_positive", sql`${table.expectedCostCents} > 0`),
    check("video_job_reserved_cost_consistent", sql`${table.reservedCostCents} >= 0 AND ${table.reservedCostCents} <= ${table.expectedCostCents}`),
    check(
      "video_job_lease_consistent",
      sql`(${table.status} = 'running' AND ${table.claimedBy} IS NOT NULL AND ${table.claimedAt} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL) OR (${table.status} <> 'running' AND ${table.claimedBy} IS NULL AND ${table.claimedAt} IS NULL AND ${table.leaseExpiresAt} IS NULL)`,
    ),
  ],
);

/** Per-provider execution limits and encrypted credentials. It is disabled by default. */
export const videoProviderConfig = pgTable(
  "video_provider_config",
  {
    provider: text("provider").primaryKey(),
    enabled: boolean("enabled").default(false).notNull(),
    credentialCiphertext: text("credential_ciphertext"),
    maximumConcurrentJobs: integer("maximum_concurrent_jobs").default(1).notNull(),
    maximumAttempts: integer("maximum_attempts").default(1).notNull(),
    budgetLimitCents: integer("budget_limit_cents").default(1).notNull(),
    budgetCommittedCents: integer("budget_committed_cents").default(0).notNull(),
    runtimeSettings: jsonb("runtime_settings").$type<Record<string, string>>().default({}).notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("video_provider_config_name_nonempty", sql`length(btrim(${table.provider})) > 0`),
    check("video_provider_config_concurrency_positive", sql`${table.maximumConcurrentJobs} > 0`),
    check("video_provider_config_attempts_positive", sql`${table.maximumAttempts} > 0`),
    check("video_provider_config_budget_positive", sql`${table.budgetLimitCents} > 0`),
    check("video_provider_config_budget_consistent", sql`${table.budgetCommittedCents} >= 0 AND ${table.budgetCommittedCents} <= ${table.budgetLimitCents}`),
    check("video_provider_config_enabled_has_credential", sql`NOT ${table.enabled} OR ${table.credentialCiphertext} IS NOT NULL`),
  ],
);

/** Human-verified capability record. A package being installed never enables a model. */
export const videoModelConfig = pgTable(
  "video_model_config",
  {
    id: text("id").primaryKey(),
    provider: text("provider")
      .notNull()
      .references(() => videoProviderConfig.provider, { onDelete: "restrict" }),
    modelId: text("model_id").notNull(),
    capabilities: jsonb("capabilities").$type<string[]>().default([]).notNull(),
    aspectRatios: jsonb("aspect_ratios").$type<string[]>().default([]).notNull(),
    durationMinimumSeconds: integer("duration_minimum_seconds").notNull(),
    durationMaximumSeconds: integer("duration_maximum_seconds").notNull(),
    resolutions: jsonb("resolutions").$type<string[]>().default([]).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationRef: text("verification_ref"),
    enabled: boolean("enabled").default(false).notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("video_model_config_provider_model_uidx").on(table.provider, table.modelId),
    index("video_model_config_provider_enabled_idx").on(table.provider, table.enabled),
    check("video_model_config_id_nonempty", sql`length(btrim(${table.id})) > 0`),
    check("video_model_config_model_nonempty", sql`length(btrim(${table.modelId})) > 0`),
    check("video_model_config_duration_consistent", sql`${table.durationMinimumSeconds} > 0 AND ${table.durationMaximumSeconds} >= ${table.durationMinimumSeconds}`),
    check("video_model_config_enabled_verified", sql`NOT ${table.enabled} OR (${table.verifiedAt} IS NOT NULL AND ${table.verificationRef} IS NOT NULL AND length(btrim(${table.verificationRef})) > 0)`),
  ],
);

/** Advisory creative review. It records guidance and never authorizes product facts or publication. */
export const videoAdvisoryReview = pgTable(
  "video_advisory_review",
  {
    id: text("id").primaryKey(),
    videoProjectId: text("video_project_id").notNull().references(() => aggregateRecord.id, { onDelete: "restrict" }),
    stage: videoReviewStage("stage").notNull(),
    outcome: videoReviewOutcome("outcome").notNull(),
    reason: text("reason").notNull(),
    riskSnapshot: jsonb("risk_snapshot").$type<Record<string, unknown>>().default({}).notNull(),
    decidedBy: text("decided_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("video_advisory_review_project_stage_idx").on(table.videoProjectId, table.stage, table.decidedAt),
    check("video_advisory_review_reason_nonempty", sql`length(btrim(${table.reason})) > 0`),
  ],
);

/** Personal, editable canvas layout. It is not a video project and carries no product facts. */
export const videoCanvasDocument = pgTable(
  "video_canvas_document",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("video_canvas_document_owner_uidx").on(table.ownerId),
    check("video_canvas_document_revision_positive", sql`${table.revision} > 0`),
    check("video_canvas_document_owner_nonempty", sql`length(btrim(${table.ownerId})) > 0`),
  ],
);

/** A user-visible workspace project. Domain facts remain in aggregate_record. */
export const workspaceProject = pgTable(
  "workspace_project",
  {
    id: text("id").primaryKey(),
    kind: workspaceProjectKind("kind").notNull(),
    status: workspaceProjectStatus("status").default("active").notNull(),
    title: text("title").notNull(),
    createdById: text("created_by_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("workspace_project_kind_status_idx").on(table.kind, table.status),
    index("workspace_project_creator_idx").on(table.createdById),
    check("workspace_project_title_nonempty", sql`length(btrim(${table.title})) > 0`),
  ],
);

/** Explicit authorization boundary for a user inside one workspace project. */
export const workspaceProjectMember = pgTable(
  "workspace_project_member",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => workspaceProject.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: workspaceProjectMemberRole("role").notNull(),
    createdById: text("created_by_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("workspace_project_member_project_user_uidx").on(table.projectId, table.userId),
    index("workspace_project_member_user_idx").on(table.userId, table.projectId),
  ],
);

/** Makes private evidence discoverable inside a project without exposing the global evidence catalog. */
export const workspaceProjectEvidence = pgTable(
  "workspace_project_evidence",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => workspaceProject.id, { onDelete: "cascade" }),
    evidenceId: text("evidence_id").notNull().references(() => evidence.id, { onDelete: "restrict" }),
    linkedById: text("linked_by_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("workspace_project_evidence_project_evidence_uidx").on(table.projectId, table.evidenceId),
    index("workspace_project_evidence_evidence_idx").on(table.evidenceId),
  ],
);

/** Owns or references a governed aggregate from a project without duplicating facts. */
export const workspaceProjectItem = pgTable(
  "workspace_project_item",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => workspaceProject.id, { onDelete: "cascade" }),
    aggregateId: text("aggregate_id").notNull().references(() => aggregateRecord.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    relation: workspaceItemRelation("relation").default("owned").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("workspace_project_item_project_aggregate_uidx").on(table.projectId, table.aggregateId),
    uniqueIndex("workspace_project_item_single_owner_uidx").on(table.aggregateId).where(sql`${table.relation} = 'owned'`),
    index("workspace_project_item_aggregate_idx").on(table.aggregateId),
    check("workspace_project_item_role_allowed", sql`${table.role} in ('product_source', 'product_reference', 'marketing_content', 'marketing_video', 'sales_rfq', 'sales_quotation', 'sales_lead', 'delivery_confirmation')`),
    check("workspace_project_item_relation_matches_role", sql`(${table.role} = 'product_reference' and ${table.relation} = 'reference') or (${table.role} <> 'product_reference' and ${table.relation} = 'owned')`),
  ],
);

/** Per-project visual composition with optimistic revision control. */
export const workspaceCanvasDocument = pgTable(
  "workspace_canvas_document",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => workspaceProject.id, { onDelete: "cascade" }),
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("workspace_canvas_document_project_uidx").on(table.projectId),
    check("workspace_canvas_document_revision_positive", sql`${table.revision} > 0`),
  ],
);

/**
 * A narrowly scoped receipt for a browser-to-Blob presigned upload. The
 * browser chooses only the receipt ID; ownership and the exact pathname are
 * bound by the authenticated signing route and verified completion callback.
 */
export const videoUploadReceipt = pgTable(
  "video_upload_receipt",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => workspaceProject.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    blobPath: text("blob_path").notNull(),
    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    rightsEvidenceRef: text("rights_evidence_ref").notNull(),
    status: videoUploadReceiptStatus("status").default("issued").notNull(),
    sha256: text("sha256"),
    evidenceId: text("evidence_id").references(() => evidence.id, { onDelete: "restrict" }),
    failureCode: text("failure_code"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("video_upload_receipt_blob_path_uidx").on(table.blobPath),
    index("video_upload_receipt_owner_status_idx").on(table.ownerId, table.status),
    index("video_upload_receipt_expiry_idx").on(table.expiresAt),
    check("video_upload_receipt_size_positive", sql`${table.sizeBytes} > 0 AND ((${table.contentType} LIKE 'image/%' AND ${table.sizeBytes} <= 20971520) OR (${table.contentType} IN ('video/mp4', 'video/quicktime') AND ${table.sizeBytes} < 1073741824))`),
    check("video_upload_receipt_rights_nonempty", sql`length(btrim(${table.rightsEvidenceRef})) > 0`),
    check("video_upload_receipt_claim_consistent", sql`(${table.status} = 'claimed' AND ${table.evidenceId} IS NOT NULL AND ${table.claimedAt} IS NOT NULL) OR ${table.status} <> 'claimed'`),
  ],
);

/** Durable status for MVP1 AI-draft and FFmpeg Workflow runs. */
export const videoProcessingJob = pgTable(
  "video_processing_job",
  {
    id: text("id").primaryKey(),
    videoProjectId: text("video_project_id").notNull().references(() => aggregateRecord.id, { onDelete: "restrict" }),
    kind: videoProcessingJobKind("kind").notNull(),
    status: videoProcessingJobStatus("status").default("queued").notNull(),
    requestKey: text("request_key").notNull(),
    workflowRunId: text("workflow_run_id"),
    attempts: integer("attempts").default(0).notNull(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("video_processing_job_request_uidx").on(table.requestKey),
    index("video_processing_job_project_created_idx").on(table.videoProjectId, table.createdAt),
    index("video_processing_job_status_created_idx").on(table.status, table.createdAt),
    check("video_processing_job_attempts_nonnegative", sql`${table.attempts} >= 0`),
    check("video_processing_job_request_nonempty", sql`length(btrim(${table.requestKey})) > 0`),
  ],
);

/** Opaque reference to a generated video held only in private object storage. */
export const videoGeneratedAsset = pgTable(
  "video_generated_asset",
  {
    assetRef: text("asset_ref").primaryKey(),
    blobPath: text("blob_path").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("video_generated_asset_blob_path_uidx").on(table.blobPath),
    index("video_generated_asset_provider_created_idx").on(table.provider, table.createdAt),
    check("video_generated_asset_ref_nonempty", sql`length(btrim(${table.assetRef})) > 0`),
    check("video_generated_asset_path_nonempty", sql`length(btrim(${table.blobPath})) > 0`),
    check("video_generated_asset_content_type_video", sql`${table.contentType} LIKE 'video/%'`),
    check("video_generated_asset_size_positive", sql`${table.sizeBytes} > 0`),
    check("video_generated_asset_provider_nonempty", sql`length(btrim(${table.provider})) > 0`),
    check("video_generated_asset_model_nonempty", sql`length(btrim(${table.modelId})) > 0`),
  ],
);

/**
 * Metadata-only receipt for an official inbound social message. The composite
 * uniqueness constraint is the durable exactly-once claim boundary; message
 * bodies, browser state, and credentials must never be stored here.
 */
export const socialInboundDelivery = pgTable(
  "social_inbound_delivery",
  {
    deliveryKey: text("delivery_key").primaryKey(),
    channelRef: text("channel_ref").notNull(),
    accountRef: text("account_ref").notNull(),
    messageId: text("message_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    claimedAt: createdAt(),
  },
  (table) => [
    uniqueIndex("social_inbound_delivery_external_uidx").on(
      table.channelRef,
      table.accountRef,
      table.messageId,
    ),
    index("social_inbound_delivery_received_at_idx").on(table.receivedAt),
    check("social_inbound_delivery_key_nonempty", sql`length(btrim(${table.deliveryKey})) > 0`),
    check("social_inbound_delivery_channel_nonempty", sql`length(btrim(${table.channelRef})) > 0`),
    check("social_inbound_delivery_account_nonempty", sql`length(btrim(${table.accountRef})) > 0`),
    check("social_inbound_delivery_message_nonempty", sql`length(btrim(${table.messageId})) > 0`),
  ],
);

/**
 * A command issued to the isolated social worker. It holds only opaque
 * references and lifecycle metadata: browser profiles, cookies, proxy values,
 * screenshots and traces are deliberately excluded.
 */
export const socialBrowserJob = pgTable(
  "social_browser_job",
  {
    id: text("id").primaryKey(),
    channelRef: text("channel_ref").notNull(),
    accountRef: text("account_ref").notNull(),
    kind: text("kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadRef: text("payload_ref").notNull(),
    status: text("status").default("queued").notNull(),
    resultRef: text("result_ref"),
    failureCode: text("failure_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("social_browser_job_idempotency_uidx").on(table.idempotencyKey),
    index("social_browser_job_status_created_idx").on(table.status, table.createdAt),
    check("social_browser_job_kind_nonempty", sql`length(btrim(${table.kind})) > 0`),
    check("social_browser_job_payload_nonempty", sql`length(btrim(${table.payloadRef})) > 0`),
    check("social_browser_job_status_valid", sql`${table.status} IN ('queued', 'claimed', 'succeeded', 'failed', 'paused')`),
  ],
);

/** Durable outcome of a human-confirmed social publication attempt. */
export const socialPublication = pgTable(
  "social_publication",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => workspaceProject.id, { onDelete: "restrict" }),
    channelRef: text("channel_ref").notNull(),
    accountRef: text("account_ref").notNull(),
    contentRef: text("content_ref").notNull(),
    format: text("format").notNull(),
    confirmationRef: text("confirmation_ref").notNull(),
    browserJobId: text("browser_job_id").references(() => socialBrowserJob.id, { onDelete: "restrict" }),
    externalPublicationRef: text("external_publication_ref"),
    status: text("status").default("confirmed").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("social_publication_project_created_idx").on(table.projectId, table.createdAt),
    index("social_publication_account_created_idx").on(table.accountRef, table.createdAt),
    uniqueIndex("social_publication_external_uidx").on(table.channelRef, table.accountRef, table.externalPublicationRef),
    check("social_publication_format_valid", sql`${table.format} IN ('text', 'image', 'video')`),
    check("social_publication_status_valid", sql`${table.status} IN ('confirmed', 'submitted', 'published', 'unknown', 'failed', 'paused')`),
  ],
);

/** A social conversation linked to a lead only after normal lead matching. */
export const socialConversation = pgTable(
  "social_conversation",
  {
    id: text("id").primaryKey(),
    channelRef: text("channel_ref").notNull(),
    accountRef: text("account_ref").notNull(),
    externalConversationRef: text("external_conversation_ref").notNull(),
    leadId: text("lead_id").references(() => aggregateRecord.id, { onDelete: "restrict" }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("social_conversation_external_uidx").on(table.channelRef, table.accountRef, table.externalConversationRef),
    index("social_conversation_lead_updated_idx").on(table.leadId, table.updatedAt),
  ],
);

/**
 * Encrypted social-message body retained for the MVP's fixed 30-day window.
 * Metadata supports routing and deletion; neither plaintext nor browser state
 * is stored in this table.
 */
export const socialMessage = pgTable(
  "social_message",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => socialConversation.id, { onDelete: "cascade" }),
    externalMessageRef: text("external_message_ref").notNull(),
    direction: text("direction").notNull(),
    identityQuality: text("identity_quality").notNull(),
    bodyCiphertext: text("body_ciphertext").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("social_message_external_uidx").on(table.conversationId, table.externalMessageRef),
    index("social_message_expiry_idx").on(table.expiresAt),
    check("social_message_direction_valid", sql`${table.direction} IN ('inbound', 'outbound')`),
    check("social_message_identity_valid", sql`${table.identityQuality} IN ('dom_id', 'derived_fingerprint', 'manual')`),
    check("social_message_expiry_after_received", sql`${table.expiresAt} > ${table.receivedAt}`),
  ],
);

/** Explicit, fail-closed operational control for a single social channel/account. */
export const socialChannelControl = pgTable(
  "social_channel_control",
  {
    id: text("id").primaryKey(),
    channelRef: text("channel_ref").notNull(),
    accountRef: text("account_ref").notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    circuitStatus: text("circuit_status").default("paused").notNull(),
    pauseReason: text("pause_reason"),
    pauseEvidenceRef: text("pause_evidence_ref"),
    changedBy: text("changed_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("social_channel_control_account_uidx").on(table.channelRef, table.accountRef),
    check("social_channel_control_status_valid", sql`${table.circuitStatus} IN ('active', 'paused')`),
    check("social_channel_control_pause_consistent", sql`(${table.circuitStatus} = 'active' AND ${table.pauseReason} IS NULL) OR (${table.circuitStatus} = 'paused' AND ${table.pauseReason} IS NOT NULL)`),
  ],
);

/** Named, encrypted-at-rest model configurations shared by AI-assisted workflows. */
export const productAgentModelConfig = pgTable(
  "product_agent_model_config",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    discoveredModels: jsonb("discovered_models").$type<string[]>().default([]).notNull(),
    baseUrl: text("base_url"),
    headers: jsonb("headers").$type<Record<string, string>>().default({}).notNull(),
    providerName: text("provider_name"),
    organization: text("organization"),
    project: text("project"),
    apiKeyCiphertext: text("api_key_ciphertext"),
    authTokenCiphertext: text("auth_token_ciphertext"),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("product_agent_model_config_name_uidx").on(table.name),
    uniqueIndex("product_agent_model_config_default_uidx").on(table.isDefault).where(sql`${table.isDefault} = true`),
    check("product_agent_model_config_name_nonempty", sql`length(btrim(${table.name})) > 0`),
    check("product_agent_model_config_provider_nonempty", sql`length(btrim(${table.provider})) > 0`),
    check("product_agent_model_config_model_nonempty", sql`length(btrim(${table.model})) > 0`),
  ],
);

export const authSchema = { user, session, account, verification };
