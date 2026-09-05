CREATE TABLE "product_agent_stream_run" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"project_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"status" text NOT NULL,
	"model_metadata" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_agent_stream_status" CHECK ("product_agent_stream_run"."status" IN ('running', 'completed', 'failed', 'interrupted'))
);
--> statement-breakpoint
ALTER TABLE "product_agent_stream_run" ADD CONSTRAINT "product_agent_stream_run_product_id_aggregate_record_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."aggregate_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_agent_stream_run" ADD CONSTRAINT "product_agent_stream_run_project_id_workspace_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."workspace_project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_agent_stream_run" ADD CONSTRAINT "product_agent_stream_run_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_agent_stream_product_uidx" ON "product_agent_stream_run" USING btree ("product_id");