CREATE TYPE "public"."workspace_item_relation" AS ENUM('owned', 'reference');--> statement-breakpoint
ALTER TABLE "workspace_project_item" DROP CONSTRAINT "workspace_project_item_role_nonempty";--> statement-breakpoint
ALTER TABLE "workspace_project_item" ADD COLUMN "relation" "workspace_item_relation" DEFAULT 'owned' NOT NULL;--> statement-breakpoint
UPDATE "workspace_project_item" SET "relation" = 'reference' WHERE "role" = 'product_reference';--> statement-breakpoint
WITH ranked_product_owners AS (
  SELECT "id", row_number() OVER (PARTITION BY "aggregate_id" ORDER BY "created_at", "id") AS owner_rank
  FROM "workspace_project_item"
  WHERE "role" = 'product_source'
)
UPDATE "workspace_project_item" AS item
SET "role" = 'product_reference', "relation" = 'reference'
FROM ranked_product_owners
WHERE item."id" = ranked_product_owners."id" AND ranked_product_owners.owner_rank > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_project_item_single_owner_uidx" ON "workspace_project_item" USING btree ("aggregate_id") WHERE "workspace_project_item"."relation" = 'owned';--> statement-breakpoint
ALTER TABLE "workspace_project_item" ADD CONSTRAINT "workspace_project_item_role_allowed" CHECK ("workspace_project_item"."role" in ('product_source', 'product_reference', 'marketing_content', 'marketing_video', 'sales_rfq'));--> statement-breakpoint
ALTER TABLE "workspace_project_item" ADD CONSTRAINT "workspace_project_item_relation_matches_role" CHECK (("workspace_project_item"."role" = 'product_reference' and "workspace_project_item"."relation" = 'reference') or ("workspace_project_item"."role" <> 'product_reference' and "workspace_project_item"."relation" = 'owned'));
