ALTER TABLE "video_job" ADD COLUMN "required_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "video_job" ADD COLUMN "aspect_ratio" text DEFAULT '16:9' NOT NULL;
ALTER TABLE "video_job" ADD COLUMN "duration_seconds" integer DEFAULT 1 NOT NULL;
ALTER TABLE "video_job" ADD COLUMN "resolution" text DEFAULT '1280x720' NOT NULL;
ALTER TABLE "video_job" ADD COLUMN "expected_cost_cents" integer DEFAULT 1 NOT NULL;
ALTER TABLE "video_job" ADD COLUMN "reserved_cost_cents" integer DEFAULT 0 NOT NULL;
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_duration_positive" CHECK ("video_job"."duration_seconds" > 0);
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_expected_cost_positive" CHECK ("video_job"."expected_cost_cents" > 0);
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_reserved_cost_consistent" CHECK ("video_job"."reserved_cost_cents" >= 0 AND "video_job"."reserved_cost_cents" <= "video_job"."expected_cost_cents");
