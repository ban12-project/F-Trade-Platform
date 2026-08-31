CREATE TYPE "workspace_project_kind" AS ENUM ('marketing', 'sales');--> statement-breakpoint
CREATE TYPE "workspace_project_status" AS ENUM ('active', 'archived');--> statement-breakpoint
CREATE TABLE "workspace_project" (
  "id" text PRIMARY KEY NOT NULL,
  "kind" "workspace_project_kind" NOT NULL,
  "status" "workspace_project_status" DEFAULT 'active' NOT NULL,
  "title" text NOT NULL,
  "created_by_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_project_title_nonempty" CHECK (length(btrim("title")) > 0)
);--> statement-breakpoint
CREATE TABLE "workspace_project_item" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "aggregate_id" text NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_project_item_role_nonempty" CHECK (length(btrim("role")) > 0)
);--> statement-breakpoint
CREATE TABLE "workspace_canvas_document" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "document" jsonb NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_canvas_document_revision_positive" CHECK ("revision" > 0)
);--> statement-breakpoint
ALTER TABLE "workspace_project" ADD CONSTRAINT "workspace_project_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "workspace_project_item" ADD CONSTRAINT "workspace_project_item_project_id_workspace_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "workspace_project"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace_project_item" ADD CONSTRAINT "workspace_project_item_aggregate_id_aggregate_record_id_fk" FOREIGN KEY ("aggregate_id") REFERENCES "aggregate_record"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "workspace_canvas_document" ADD CONSTRAINT "workspace_canvas_document_project_id_workspace_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "workspace_project"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "workspace_project_kind_status_idx" ON "workspace_project" USING btree ("kind", "status");--> statement-breakpoint
CREATE INDEX "workspace_project_creator_idx" ON "workspace_project" USING btree ("created_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_project_item_project_aggregate_uidx" ON "workspace_project_item" USING btree ("project_id", "aggregate_id");--> statement-breakpoint
CREATE INDEX "workspace_project_item_aggregate_idx" ON "workspace_project_item" USING btree ("aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_canvas_document_project_uidx" ON "workspace_canvas_document" USING btree ("project_id");
