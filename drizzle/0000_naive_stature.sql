CREATE TYPE "public"."actor_type" AS ENUM('agent', 'human', 'system');--> statement-breakpoint
CREATE TYPE "public"."aggregate_type" AS ENUM('product', 'content', 'rfq', 'quotation', 'lead', 'delivery_confirmation');--> statement-breakpoint
CREATE TYPE "public"."approval_gate" AS ENUM('gate_01_truth', 'gate_02_quote', 'gate_03_delivery');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."evidence_classification" AS ENUM('internal', 'confidential', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aggregate_record" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "aggregate_type" NOT NULL,
	"state" text NOT NULL,
	"payload" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aggregate_version_positive" CHECK ("aggregate_record"."version" > 0),
	CONSTRAINT "aggregate_creator_nonempty" CHECK (length(btrim("aggregate_record"."created_by_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" text PRIMARY KEY NOT NULL,
	"aggregate_id" text NOT NULL,
	"gate" "approval_gate" NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"requested_by_type" "actor_type" NOT NULL,
	"requested_by_id" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_by_type" "actor_type",
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"evidence_ref" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_decision_consistent" CHECK (("approval"."status" = 'pending' AND "approval"."decided_by_type" IS NULL AND "approval"."decided_by_id" IS NULL AND "approval"."decided_at" IS NULL AND "approval"."evidence_ref" IS NULL) OR ("approval"."status" IN ('approved', 'rejected') AND "approval"."decided_by_type" = 'human' AND length(btrim("approval"."decided_by_id")) > 0 AND "approval"."decided_at" IS NOT NULL AND length(btrim("approval"."evidence_ref")) > 0)),
	CONSTRAINT "approval_requester_nonempty" CHECK (length(btrim("approval"."requested_by_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"aggregate_id" text,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_actor_nonempty" CHECK (length(btrim("audit_event"."actor_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"classification" "evidence_classification" NOT NULL,
	"blob_key" text NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"source_label" text NOT NULL,
	"uploaded_by_type" "actor_type" NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_size_nonnegative" CHECK ("evidence"."size_bytes" >= 0),
	CONSTRAINT "evidence_uploader_nonempty" CHECK (length(btrim("evidence"."uploaded_by_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by" text NOT NULL,
	"accepted_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_acceptance_consistent" CHECK (("invitation"."status" = 'accepted' AND "invitation"."accepted_by" IS NOT NULL AND "invitation"."accepted_at" IS NOT NULL) OR ("invitation"."status" <> 'accepted' AND "invitation"."accepted_by" IS NULL AND "invitation"."accepted_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_event" (
	"id" text PRIMARY KEY NOT NULL,
	"aggregate_id" text NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"gate" "approval_gate",
	"approval_id" text,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_state_changes" CHECK ("workflow_event"."from_state" <> "workflow_event"."to_state"),
	CONSTRAINT "workflow_actor_nonempty" CHECK (length(btrim("workflow_event"."actor_id")) > 0),
	CONSTRAINT "workflow_gate_reference_consistent" CHECK (("workflow_event"."gate" IS NULL AND "workflow_event"."approval_id" IS NULL) OR ("workflow_event"."gate" IS NOT NULL AND "workflow_event"."approval_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_aggregate_id_aggregate_record_id_fk" FOREIGN KEY ("aggregate_id") REFERENCES "public"."aggregate_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_aggregate_id_aggregate_record_id_fk" FOREIGN KEY ("aggregate_id") REFERENCES "public"."aggregate_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_aggregate_id_aggregate_record_id_fk" FOREIGN KEY ("aggregate_id") REFERENCES "public"."aggregate_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_uidx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "aggregate_type_state_idx" ON "aggregate_record" USING btree ("type","state");--> statement-breakpoint
CREATE INDEX "approval_pending_gate_idx" ON "approval" USING btree ("status","gate");--> statement-breakpoint
CREATE INDEX "approval_aggregate_id_idx" ON "approval" USING btree ("aggregate_id");--> statement-breakpoint
CREATE INDEX "audit_subject_time_idx" ON "audit_event" USING btree ("subject_type","subject_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_actor_time_idx" ON "audit_event" USING btree ("actor_type","actor_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_blob_key_uidx" ON "evidence" USING btree ("blob_key");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_sha256_uidx" ON "evidence" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_token_hash_uidx" ON "invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitation_email_status_idx" ON "invitation" USING btree ("email","status");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_uidx" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_uidx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "workflow_event_aggregate_time_idx" ON "workflow_event" USING btree ("aggregate_id","occurred_at");--> statement-breakpoint
CREATE FUNCTION "prevent_append_only_mutation"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "audit_event_append_only"
	BEFORE UPDATE OR DELETE ON "audit_event"
	FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "workflow_event_append_only"
	BEFORE UPDATE OR DELETE ON "workflow_event"
	FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
