CREATE TABLE "video_provider_config" (
  "provider" text PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "credential_ciphertext" text,
  "maximum_concurrent_jobs" integer DEFAULT 1 NOT NULL,
  "maximum_attempts" integer DEFAULT 1 NOT NULL,
  "budget_limit_cents" integer DEFAULT 1 NOT NULL,
  "budget_committed_cents" integer DEFAULT 0 NOT NULL,
  "runtime_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "video_provider_config_name_nonempty" CHECK (length(btrim("video_provider_config"."provider")) > 0),
  CONSTRAINT "video_provider_config_concurrency_positive" CHECK ("video_provider_config"."maximum_concurrent_jobs" > 0),
  CONSTRAINT "video_provider_config_attempts_positive" CHECK ("video_provider_config"."maximum_attempts" > 0),
  CONSTRAINT "video_provider_config_budget_positive" CHECK ("video_provider_config"."budget_limit_cents" > 0),
  CONSTRAINT "video_provider_config_budget_consistent" CHECK ("video_provider_config"."budget_committed_cents" >= 0 AND "video_provider_config"."budget_committed_cents" <= "video_provider_config"."budget_limit_cents"),
  CONSTRAINT "video_provider_config_enabled_has_credential" CHECK (NOT "video_provider_config"."enabled" OR "video_provider_config"."credential_ciphertext" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "video_model_config" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "model_id" text NOT NULL,
  "capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "aspect_ratios" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "duration_minimum_seconds" integer NOT NULL,
  "duration_maximum_seconds" integer NOT NULL,
  "resolutions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "verified_at" timestamp with time zone,
  "verification_ref" text,
  "enabled" boolean DEFAULT false NOT NULL,
  "updated_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "video_model_config_id_nonempty" CHECK (length(btrim("video_model_config"."id")) > 0),
  CONSTRAINT "video_model_config_model_nonempty" CHECK (length(btrim("video_model_config"."model_id")) > 0),
  CONSTRAINT "video_model_config_duration_consistent" CHECK ("video_model_config"."duration_minimum_seconds" > 0 AND "video_model_config"."duration_maximum_seconds" >= "video_model_config"."duration_minimum_seconds"),
  CONSTRAINT "video_model_config_enabled_verified" CHECK (NOT "video_model_config"."enabled" OR ("video_model_config"."verified_at" IS NOT NULL AND "video_model_config"."verification_ref" IS NOT NULL AND length(btrim("video_model_config"."verification_ref")) > 0))
);
--> statement-breakpoint
ALTER TABLE "video_provider_config" ADD CONSTRAINT "video_provider_config_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "video_model_config" ADD CONSTRAINT "video_model_config_provider_video_provider_config_provider_fk" FOREIGN KEY ("provider") REFERENCES "public"."video_provider_config"("provider") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "video_model_config" ADD CONSTRAINT "video_model_config_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "video_model_config_provider_model_uidx" ON "video_model_config" USING btree ("provider","model_id");
--> statement-breakpoint
CREATE INDEX "video_model_config_provider_enabled_idx" ON "video_model_config" USING btree ("provider","enabled");
