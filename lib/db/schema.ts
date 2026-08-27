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

/** Singleton, encrypted-at-rest configuration for the Product Agent's model provider. */
export const productAgentModelConfig = pgTable(
  "product_agent_model_config",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
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
    check("product_agent_model_config_singleton", sql`${table.id} = 'product_agent'`),
    check("product_agent_model_config_provider_nonempty", sql`length(btrim(${table.provider})) > 0`),
    check("product_agent_model_config_model_nonempty", sql`length(btrim(${table.model})) > 0`),
  ],
);

export const authSchema = { user, session, account, verification };
