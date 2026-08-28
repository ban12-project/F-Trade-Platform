ALTER TABLE "video_job" ADD COLUMN "claimed_by" text;
ALTER TABLE "video_job" ADD COLUMN "claimed_at" timestamp with time zone;
ALTER TABLE "video_job" ADD COLUMN "lease_expires_at" timestamp with time zone;
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_lease_consistent" CHECK (("video_job"."status" = 'running' AND "video_job"."claimed_by" IS NOT NULL AND "video_job"."claimed_at" IS NOT NULL AND "video_job"."lease_expires_at" IS NOT NULL) OR ("video_job"."status" <> 'running' AND "video_job"."claimed_by" IS NULL AND "video_job"."claimed_at" IS NULL AND "video_job"."lease_expires_at" IS NULL));
