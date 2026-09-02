CREATE TYPE "public"."video_processing_job_kind" AS ENUM('ai_draft', 'render');--> statement-breakpoint
CREATE TYPE "public"."video_processing_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."video_upload_receipt_status" AS ENUM('issued', 'uploaded', 'claimed', 'failed');--> statement-breakpoint
CREATE TABLE "video_processing_job" (
	"id" text PRIMARY KEY NOT NULL,
	"video_project_id" text NOT NULL,
	"kind" "video_processing_job_kind" NOT NULL,
	"status" "video_processing_job_status" DEFAULT 'queued' NOT NULL,
	"request_key" text NOT NULL,
	"workflow_run_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"created_by" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_processing_job_attempts_nonnegative" CHECK ("video_processing_job"."attempts" >= 0),
	CONSTRAINT "video_processing_job_request_nonempty" CHECK (length(btrim("video_processing_job"."request_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "video_upload_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"blob_path" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"rights_evidence_ref" text NOT NULL,
	"status" "video_upload_receipt_status" DEFAULT 'issued' NOT NULL,
	"sha256" text,
	"evidence_id" text,
	"failure_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"uploaded_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_upload_receipt_size_positive" CHECK ("video_upload_receipt"."size_bytes" > 0 AND "video_upload_receipt"."size_bytes" <= 20971520),
	CONSTRAINT "video_upload_receipt_rights_nonempty" CHECK (length(btrim("video_upload_receipt"."rights_evidence_ref")) > 0),
	CONSTRAINT "video_upload_receipt_claim_consistent" CHECK (("video_upload_receipt"."status" = 'claimed' AND "video_upload_receipt"."evidence_id" IS NOT NULL AND "video_upload_receipt"."claimed_at" IS NOT NULL) OR "video_upload_receipt"."status" <> 'claimed')
);
--> statement-breakpoint
ALTER TABLE "video_processing_job" ADD CONSTRAINT "video_processing_job_video_project_id_aggregate_record_id_fk" FOREIGN KEY ("video_project_id") REFERENCES "public"."aggregate_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_processing_job" ADD CONSTRAINT "video_processing_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_upload_receipt" ADD CONSTRAINT "video_upload_receipt_project_id_workspace_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."workspace_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_upload_receipt" ADD CONSTRAINT "video_upload_receipt_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_upload_receipt" ADD CONSTRAINT "video_upload_receipt_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_processing_job_request_uidx" ON "video_processing_job" USING btree ("request_key");--> statement-breakpoint
CREATE INDEX "video_processing_job_project_created_idx" ON "video_processing_job" USING btree ("video_project_id","created_at");--> statement-breakpoint
CREATE INDEX "video_processing_job_status_created_idx" ON "video_processing_job" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "video_upload_receipt_blob_path_uidx" ON "video_upload_receipt" USING btree ("blob_path");--> statement-breakpoint
CREATE INDEX "video_upload_receipt_owner_status_idx" ON "video_upload_receipt" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "video_upload_receipt_expiry_idx" ON "video_upload_receipt" USING btree ("expires_at");