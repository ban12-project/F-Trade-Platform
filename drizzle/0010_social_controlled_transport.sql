CREATE TABLE "social_browser_job" (
  "id" text PRIMARY KEY NOT NULL,
  "channel_ref" text NOT NULL,
  "account_ref" text NOT NULL,
  "kind" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "payload_ref" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "result_ref" text,
  "failure_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "social_browser_job_kind_nonempty" CHECK (length(btrim("social_browser_job"."kind")) > 0),
  CONSTRAINT "social_browser_job_payload_nonempty" CHECK (length(btrim("social_browser_job"."payload_ref")) > 0),
  CONSTRAINT "social_browser_job_status_valid" CHECK ("social_browser_job"."status" IN ('queued', 'claimed', 'succeeded', 'failed', 'paused'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "social_browser_job_idempotency_uidx" ON "social_browser_job" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "social_browser_job_status_created_idx" ON "social_browser_job" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE TABLE "social_publication" (
  "id" text PRIMARY KEY NOT NULL,
  "channel_ref" text NOT NULL,
  "account_ref" text NOT NULL,
  "content_ref" text NOT NULL,
  "format" text NOT NULL,
  "confirmation_ref" text NOT NULL,
  "browser_job_id" text,
  "external_publication_ref" text,
  "status" text DEFAULT 'confirmed' NOT NULL,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "social_publication_format_valid" CHECK ("social_publication"."format" IN ('text', 'image', 'video')),
  CONSTRAINT "social_publication_status_valid" CHECK ("social_publication"."status" IN ('confirmed', 'submitted', 'published', 'unknown', 'failed', 'paused'))
);
--> statement-breakpoint
ALTER TABLE "social_publication" ADD CONSTRAINT "social_publication_browser_job_id_social_browser_job_id_fk" FOREIGN KEY ("browser_job_id") REFERENCES "public"."social_browser_job"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "social_publication_account_created_idx" ON "social_publication" USING btree ("account_ref", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "social_publication_external_uidx" ON "social_publication" USING btree ("channel_ref", "account_ref", "external_publication_ref");
--> statement-breakpoint
CREATE TABLE "social_conversation" (
  "id" text PRIMARY KEY NOT NULL,
  "channel_ref" text NOT NULL,
  "account_ref" text NOT NULL,
  "external_conversation_ref" text NOT NULL,
  "lead_id" text,
  "last_message_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_conversation" ADD CONSTRAINT "social_conversation_lead_id_aggregate_record_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."aggregate_record"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "social_conversation_external_uidx" ON "social_conversation" USING btree ("channel_ref", "account_ref", "external_conversation_ref");
--> statement-breakpoint
CREATE INDEX "social_conversation_lead_updated_idx" ON "social_conversation" USING btree ("lead_id", "updated_at");
--> statement-breakpoint
CREATE TABLE "social_message" (
  "id" text PRIMARY KEY NOT NULL,
  "conversation_id" text NOT NULL,
  "external_message_ref" text NOT NULL,
  "direction" text NOT NULL,
  "identity_quality" text NOT NULL,
  "body_ciphertext" text NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "social_message_direction_valid" CHECK ("social_message"."direction" IN ('inbound', 'outbound')),
  CONSTRAINT "social_message_identity_valid" CHECK ("social_message"."identity_quality" IN ('dom_id', 'derived_fingerprint', 'manual')),
  CONSTRAINT "social_message_expiry_after_received" CHECK ("social_message"."expires_at" > "social_message"."received_at")
);
--> statement-breakpoint
ALTER TABLE "social_message" ADD CONSTRAINT "social_message_conversation_id_social_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."social_conversation"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "social_message_external_uidx" ON "social_message" USING btree ("conversation_id", "external_message_ref");
--> statement-breakpoint
CREATE INDEX "social_message_expiry_idx" ON "social_message" USING btree ("expires_at");
