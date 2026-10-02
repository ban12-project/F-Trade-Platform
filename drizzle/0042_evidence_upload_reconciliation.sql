CREATE TABLE "evidence_upload_intent" (
	"id" text PRIMARY KEY NOT NULL,
	"blob_key" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_upload_intent_status" CHECK ("evidence_upload_intent"."status" IN ('upload_pending', 'uncertain', 'cleanup_pending', 'attached', 'cleaned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_upload_intent_blob_uidx" ON "evidence_upload_intent" USING btree ("blob_key");--> statement-breakpoint
CREATE INDEX "evidence_upload_intent_pending_idx" ON "evidence_upload_intent" USING btree ("status","updated_at");