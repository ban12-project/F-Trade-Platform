CREATE TYPE "video_job_status" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

CREATE TABLE "video_job" (
  "id" text PRIMARY KEY NOT NULL,
  "video_project_id" text NOT NULL REFERENCES "aggregate_record"("id") ON DELETE RESTRICT,
  "provider" text NOT NULL,
  "model_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" "video_job_status" DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "provider_job_ref" text,
  "result_asset_ref" text,
  "failure_code" text,
  "next_attempt_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "video_job_attempts_nonnegative" CHECK ("video_job"."attempts" >= 0),
  CONSTRAINT "video_job_provider_nonempty" CHECK (length(btrim("video_job"."provider")) > 0),
  CONSTRAINT "video_job_model_nonempty" CHECK (length(btrim("video_job"."model_id")) > 0)
);

CREATE UNIQUE INDEX "video_job_idempotency_uidx" ON "video_job" USING btree ("idempotency_key");
CREATE INDEX "video_job_status_next_attempt_idx" ON "video_job" USING btree ("status", "next_attempt_at");
CREATE INDEX "video_job_video_project_idx" ON "video_job" USING btree ("video_project_id");
