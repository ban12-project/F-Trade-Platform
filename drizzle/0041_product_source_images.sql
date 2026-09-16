CREATE TABLE "product_source_image" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"project_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_document_upload_receipt" DROP CONSTRAINT "product_document_upload_purpose";--> statement-breakpoint
ALTER TABLE "product_source_image" ADD CONSTRAINT "product_source_image_product_id_aggregate_record_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."aggregate_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_source_image" ADD CONSTRAINT "product_source_image_project_id_workspace_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."workspace_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_source_image" ADD CONSTRAINT "product_source_image_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_source_image_product_evidence_uidx" ON "product_source_image" USING btree ("product_id","evidence_id");--> statement-breakpoint
ALTER TABLE "product_document_upload_receipt" ADD CONSTRAINT "product_document_upload_purpose" CHECK ("product_document_upload_receipt"."purpose" IN ('evidence', 'agent', 'agent_image'));