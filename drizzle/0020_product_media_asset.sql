CREATE TABLE "product_media_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"origin" text NOT NULL,
	"media_type" text NOT NULL,
	"role" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"duration_ms" integer,
	"fps" real,
	"has_audio" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"product_visible" boolean DEFAULT false NOT NULL,
	"logo_visible" boolean DEFAULT false NOT NULL,
	"text_present" boolean DEFAULT false NOT NULL,
	"rights_evidence_ref" text NOT NULL,
	"editing_allowed" boolean DEFAULT false NOT NULL,
	"public_distribution_allowed" boolean DEFAULT false NOT NULL,
	"paid_advertising_allowed" boolean DEFAULT false NOT NULL,
	"image_to_video_allowed" boolean DEFAULT false NOT NULL,
	"reference_to_video_allowed" boolean DEFAULT false NOT NULL,
	"rights_expires_at" timestamp with time zone,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_evidence_ref" text,
	"review_notes" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_media_origin_allowed" CHECK ("product_media_asset"."origin" in ('factory', 'user_upload', 'licensed')),
	CONSTRAINT "product_media_type_allowed" CHECK ("product_media_asset"."media_type" in ('image', 'video')),
	CONSTRAINT "product_media_role_allowed" CHECK ("product_media_asset"."role" in ('product_hero', 'product_detail', 'packaging', 'factory', 'inspection', 'application', 'other')),
	CONSTRAINT "product_media_review_status_allowed" CHECK ("product_media_asset"."review_status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "product_media_dimensions_positive" CHECK ("product_media_asset"."width" > 0 and "product_media_asset"."height" > 0),
	CONSTRAINT "product_media_version_positive" CHECK ("product_media_asset"."version" > 0),
	CONSTRAINT "product_media_content_type_matches" CHECK (lower("product_media_asset"."content_type") like ("product_media_asset"."media_type" || '/%')),
	CONSTRAINT "product_media_technical_consistent" CHECK (("product_media_asset"."media_type" = 'image' and "product_media_asset"."duration_ms" is null and "product_media_asset"."fps" is null and not "product_media_asset"."has_audio") or ("product_media_asset"."media_type" = 'video' and "product_media_asset"."duration_ms" > 0 and "product_media_asset"."fps" > 0)),
	CONSTRAINT "product_media_generation_requires_editing" CHECK (not ("product_media_asset"."image_to_video_allowed" or "product_media_asset"."reference_to_video_allowed") or "product_media_asset"."editing_allowed"),
	CONSTRAINT "product_media_image_to_video_type" CHECK (not "product_media_asset"."image_to_video_allowed" or "product_media_asset"."media_type" = 'image'),
	CONSTRAINT "product_media_review_consistent" CHECK (("product_media_asset"."review_status" = 'pending' and "product_media_asset"."reviewed_by" is null and "product_media_asset"."reviewed_at" is null and "product_media_asset"."review_evidence_ref" is null) or ("product_media_asset"."review_status" in ('approved', 'rejected') and "product_media_asset"."reviewed_by" is not null and "product_media_asset"."reviewed_at" is not null and length(btrim("product_media_asset"."review_evidence_ref")) > 0)),
	CONSTRAINT "product_media_rights_evidence_nonempty" CHECK (length(btrim("product_media_asset"."rights_evidence_ref")) > 0),
	CONSTRAINT "product_media_creator_nonempty" CHECK (length(btrim("product_media_asset"."created_by")) > 0)
);
--> statement-breakpoint
ALTER TABLE "product_media_asset" ADD CONSTRAINT "product_media_asset_product_id_aggregate_record_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."aggregate_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media_asset" ADD CONSTRAINT "product_media_asset_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media_asset" ADD CONSTRAINT "product_media_asset_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media_asset" ADD CONSTRAINT "product_media_asset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_media_product_evidence_uidx" ON "product_media_asset" USING btree ("product_id","evidence_id");--> statement-breakpoint
CREATE INDEX "product_media_product_review_idx" ON "product_media_asset" USING btree ("product_id","review_status");--> statement-breakpoint
CREATE INDEX "product_media_evidence_idx" ON "product_media_asset" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX "product_media_rights_expiry_idx" ON "product_media_asset" USING btree ("rights_expires_at");