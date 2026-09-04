ALTER TABLE "social_publication" ADD COLUMN "project_id" text;--> statement-breakpoint
UPDATE "social_publication" AS publication
SET "project_id" = (
  SELECT item."project_id"
  FROM "workspace_project_item" AS item
  INNER JOIN "workspace_project" AS project ON project."id" = item."project_id"
  WHERE item."aggregate_id" = publication."content_ref" AND project."kind" = 'marketing'
  ORDER BY item."created_at" ASC
  LIMIT 1
);--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "social_publication" WHERE "project_id" IS NULL) THEN
    RAISE EXCEPTION 'Cannot associate every existing social publication with a marketing workspace project';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "social_publication" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "social_publication" ADD CONSTRAINT "social_publication_project_id_workspace_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."workspace_project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_publication_project_created_idx" ON "social_publication" USING btree ("project_id","created_at");
