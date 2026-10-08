CREATE TABLE "video_retention_cleanup" (
	"id" text PRIMARY KEY NOT NULL,
	"object_kind" text NOT NULL,
	"object_ref" text NOT NULL,
	"blob_path" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"policy_version" text NOT NULL,
	"original_created_at" timestamp with time zone NOT NULL,
	"content_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_retention_cleanup_kind" CHECK ("video_retention_cleanup"."object_kind" IN ('video', 'asset', 'evidence')),
	CONSTRAINT "video_retention_cleanup_status" CHECK ("video_retention_cleanup"."status" IN ('pending', 'purged')),
	CONSTRAINT "video_retention_cleanup_completed" CHECK (("video_retention_cleanup"."status" = 'pending' AND "video_retention_cleanup"."completed_at" IS NULL) OR ("video_retention_cleanup"."status" = 'purged' AND "video_retention_cleanup"."completed_at" IS NOT NULL AND "video_retention_cleanup"."blob_path" IS NULL)),
	CONSTRAINT "video_retention_cleanup_attempts" CHECK ("video_retention_cleanup"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "video_generated_asset" DROP CONSTRAINT "video_generated_asset_size_positive";--> statement-breakpoint
ALTER TABLE "video_generated_asset" ADD COLUMN "video_project_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "video_retention_cleanup_object_uidx" ON "video_retention_cleanup" USING btree ("object_kind","object_ref");--> statement-breakpoint
CREATE INDEX "video_retention_cleanup_pending_idx" ON "video_retention_cleanup" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "video_generated_asset" ADD CONSTRAINT "video_generated_asset_video_project_id_aggregate_record_id_fk" FOREIGN KEY ("video_project_id") REFERENCES "public"."aggregate_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_generated_asset" ADD CONSTRAINT "video_generated_asset_size_positive" CHECK ("video_generated_asset"."size_bytes" > 0 OR ("video_generated_asset"."size_bytes" = 0 AND "video_generated_asset"."blob_path" = 'retired/' || "video_generated_asset"."asset_ref"));