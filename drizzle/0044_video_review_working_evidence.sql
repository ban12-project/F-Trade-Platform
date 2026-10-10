CREATE TABLE "video_review_working_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"evidence_id" text NOT NULL,
	"video_id" text NOT NULL,
	"declared_by_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_review_working_evidence_actor_nonempty" CHECK (length(btrim("video_review_working_evidence"."declared_by_id")) > 0),
	CONSTRAINT "video_review_working_evidence_policy_nonempty" CHECK (length(btrim("video_review_working_evidence"."policy_version")) > 0)
);
--> statement-breakpoint
ALTER TABLE "video_review_working_evidence" ADD CONSTRAINT "video_review_working_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_review_working_evidence" ADD CONSTRAINT "video_review_working_evidence_video_id_aggregate_record_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."aggregate_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_review_working_evidence_ref_uidx" ON "video_review_working_evidence" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX "video_review_working_evidence_video_idx" ON "video_review_working_evidence" USING btree ("video_id");