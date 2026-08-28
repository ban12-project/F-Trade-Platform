CREATE TABLE "video_generated_asset" (
  "asset_ref" text PRIMARY KEY NOT NULL,
  "blob_path" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "provider" text NOT NULL,
  "model_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "video_generated_asset_ref_nonempty" CHECK (length(btrim("video_generated_asset"."asset_ref")) > 0),
  CONSTRAINT "video_generated_asset_path_nonempty" CHECK (length(btrim("video_generated_asset"."blob_path")) > 0),
  CONSTRAINT "video_generated_asset_content_type_video" CHECK ("video_generated_asset"."content_type" LIKE 'video/%'),
  CONSTRAINT "video_generated_asset_size_positive" CHECK ("video_generated_asset"."size_bytes" > 0),
  CONSTRAINT "video_generated_asset_provider_nonempty" CHECK (length(btrim("video_generated_asset"."provider")) > 0),
  CONSTRAINT "video_generated_asset_model_nonempty" CHECK (length(btrim("video_generated_asset"."model_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "video_generated_asset_blob_path_uidx" ON "video_generated_asset" USING btree ("blob_path");
--> statement-breakpoint
CREATE INDEX "video_generated_asset_provider_created_idx" ON "video_generated_asset" USING btree ("provider","created_at");
