-- Only the new document receipt table. Existing runtime tables, confirmation column,
-- and digest index were already migrated in 0029, 0030, and 0038.
CREATE TABLE "product_document_upload_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"purpose" text NOT NULL,
	"blob_path" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"evidence_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_document_upload_size" CHECK ("product_document_upload_receipt"."size_bytes" > 0 AND "product_document_upload_receipt"."size_bytes" <= 26214400),
	CONSTRAINT "product_document_upload_purpose" CHECK ("product_document_upload_receipt"."purpose" IN ('evidence', 'agent'))
);
--> statement-breakpoint
ALTER TABLE "product_document_upload_receipt" ADD CONSTRAINT "product_document_upload_receipt_project_id_workspace_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."workspace_project"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_document_upload_receipt" ADD CONSTRAINT "product_document_upload_receipt_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_document_upload_receipt" ADD CONSTRAINT "product_document_upload_receipt_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "product_document_upload_path_uidx" ON "product_document_upload_receipt" USING btree ("blob_path");
--> statement-breakpoint
CREATE INDEX "product_document_upload_expiry_idx" ON "product_document_upload_receipt" USING btree ("expires_at");
