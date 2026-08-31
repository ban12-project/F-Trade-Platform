-- Advisory reviews are additive. Existing video records remain intact.
CREATE TYPE "video_review_stage" AS ENUM ('pre_generation', 'post_generation');
--> statement-breakpoint
CREATE TYPE "video_review_outcome" AS ENUM ('accepted', 'changes_requested', 'skipped');
--> statement-breakpoint
CREATE TABLE "video_advisory_review" (
  "id" text PRIMARY KEY NOT NULL,
  "video_project_id" text NOT NULL REFERENCES "aggregate_record"("id") ON DELETE RESTRICT,
  "stage" "video_review_stage" NOT NULL,
  "outcome" "video_review_outcome" NOT NULL,
  "reason" text NOT NULL,
  "risk_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "decided_by" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "decided_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "video_advisory_review_reason_nonempty" CHECK (length(btrim("reason")) > 0)
);
--> statement-breakpoint
CREATE INDEX "video_advisory_review_project_stage_idx" ON "video_advisory_review" USING btree ("video_project_id", "stage", "decided_at");
