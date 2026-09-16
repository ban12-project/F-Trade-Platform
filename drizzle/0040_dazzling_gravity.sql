CREATE TABLE "product_catalog_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"import_id" text NOT NULL,
	"candidate_id" text,
	"session_id" text NOT NULL,
	"status" text NOT NULL,
	"failure_code" text,
	"model_config_id" text,
	"model" text,
	"workflow_run_id" text,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_catalog_attempt_status" CHECK ("product_catalog_attempt"."status" IN ('queued','running','completed','failed')),
	CONSTRAINT "product_catalog_attempt_model" CHECK (("product_catalog_attempt"."candidate_id" IS NULL AND "product_catalog_attempt"."model_config_id" IS NULL AND "product_catalog_attempt"."model" IS NULL) OR ("product_catalog_attempt"."candidate_id" IS NOT NULL AND "product_catalog_attempt"."model_config_id" IS NOT NULL AND "product_catalog_attempt"."model" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "product_catalog_candidate" (
	"id" text PRIMARY KEY NOT NULL,
	"import_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"identifier" text NOT NULL,
	"source" jsonb NOT NULL,
	"physical_page" integer,
	"record_line" integer NOT NULL,
	"review_status" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"active_attempt_id" text,
	"failure_code" text,
	"product_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_catalog_candidate_status" CHECK ("product_catalog_candidate"."status" IN ('available','queued','running','completed','failed')),
	CONSTRAINT "product_catalog_candidate_result" CHECK (("product_catalog_candidate"."status" = 'completed') = ("product_catalog_candidate"."product_id" IS NOT NULL)),
	CONSTRAINT "product_catalog_candidate_location" CHECK ("product_catalog_candidate"."ordinal" >= 0 AND "product_catalog_candidate"."record_line" > 0 AND ("product_catalog_candidate"."physical_page" IS NULL OR "product_catalog_candidate"."physical_page" > 0))
);
--> statement-breakpoint
CREATE TABLE "product_catalog_import" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"status" text NOT NULL,
	"active_attempt_id" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_catalog_status" CHECK ("product_catalog_import"."status" IN ('queued','parsing','ready','failed'))
);
--> statement-breakpoint
ALTER TABLE "product_catalog_attempt" ADD CONSTRAINT "product_catalog_attempt_import_id_product_catalog_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."product_catalog_import"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_catalog_attempt" ADD CONSTRAINT "product_catalog_attempt_candidate_id_product_catalog_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."product_catalog_candidate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_catalog_candidate" ADD CONSTRAINT "product_catalog_candidate_import_id_product_catalog_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."product_catalog_import"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_catalog_candidate" ADD CONSTRAINT "product_catalog_candidate_product_id_aggregate_record_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."aggregate_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_catalog_import" ADD CONSTRAINT "product_catalog_import_project_id_workspace_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."workspace_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_catalog_import" ADD CONSTRAINT "product_catalog_import_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_catalog_import" ADD CONSTRAINT "product_catalog_import_receipt_id_product_document_upload_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."product_document_upload_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_catalog_import" ADD CONSTRAINT "product_catalog_import_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_catalog_attempt_import_idx" ON "product_catalog_attempt" USING btree ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_catalog_ordinal_uidx" ON "product_catalog_candidate" USING btree ("import_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "product_catalog_product_uidx" ON "product_catalog_candidate" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_catalog_receipt_uidx" ON "product_catalog_import" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "product_catalog_project_idx" ON "product_catalog_import" USING btree ("project_id","actor_id");