CREATE TABLE "video_canvas_document" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "document" jsonb NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "video_canvas_document_revision_positive" CHECK ("video_canvas_document"."revision" > 0),
  CONSTRAINT "video_canvas_document_owner_nonempty" CHECK (length(btrim("video_canvas_document"."owner_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "video_canvas_document_owner_uidx" ON "video_canvas_document" USING btree ("owner_id");
