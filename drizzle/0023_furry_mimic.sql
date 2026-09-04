CREATE TYPE "public"."workspace_project_member_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "workspace_project_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"linked_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_project_member" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "workspace_project_member_role" NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_project_evidence" ADD CONSTRAINT "workspace_project_evidence_project_id_workspace_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."workspace_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_project_evidence" ADD CONSTRAINT "workspace_project_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_project_evidence" ADD CONSTRAINT "workspace_project_evidence_linked_by_id_user_id_fk" FOREIGN KEY ("linked_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_project_member" ADD CONSTRAINT "workspace_project_member_project_id_workspace_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."workspace_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_project_member" ADD CONSTRAINT "workspace_project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_project_member" ADD CONSTRAINT "workspace_project_member_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_project_evidence_project_evidence_uidx" ON "workspace_project_evidence" USING btree ("project_id","evidence_id");--> statement-breakpoint
CREATE INDEX "workspace_project_evidence_evidence_idx" ON "workspace_project_evidence" USING btree ("evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_project_member_project_user_uidx" ON "workspace_project_member" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_project_member_user_idx" ON "workspace_project_member" USING btree ("user_id","project_id");--> statement-breakpoint
INSERT INTO "workspace_project_member" ("id", "project_id", "user_id", "role", "created_by_id")
SELECT concat('member-', md5("id" || ':' || "created_by_id")), "id", "created_by_id", 'owner', "created_by_id"
FROM "workspace_project"
ON CONFLICT ("project_id", "user_id") DO NOTHING;
