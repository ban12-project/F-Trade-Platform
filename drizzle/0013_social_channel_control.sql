CREATE TABLE "social_channel_control" (
  "id" text PRIMARY KEY NOT NULL,
  "channel_ref" text NOT NULL,
  "account_ref" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "circuit_status" text DEFAULT 'paused' NOT NULL,
  "pause_reason" text,
  "pause_evidence_ref" text,
  "changed_by" text NOT NULL,
  "changed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "social_channel_control_status_valid" CHECK ("social_channel_control"."circuit_status" IN ('active', 'paused')),
  CONSTRAINT "social_channel_control_pause_consistent" CHECK (("social_channel_control"."circuit_status" = 'active' AND "social_channel_control"."pause_reason" IS NULL) OR ("social_channel_control"."circuit_status" = 'paused' AND "social_channel_control"."pause_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "social_channel_control" ADD CONSTRAINT "social_channel_control_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "social_channel_control_account_uidx" ON "social_channel_control" USING btree ("channel_ref", "account_ref");
