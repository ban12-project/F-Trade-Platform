ALTER TABLE "product_agent_model_config" DROP CONSTRAINT IF EXISTS "product_agent_model_config_singleton";--> statement-breakpoint
ALTER TABLE "product_agent_model_config" ADD COLUMN IF NOT EXISTS "name" text;--> statement-breakpoint
ALTER TABLE "product_agent_model_config" ADD COLUMN IF NOT EXISTS "discovered_models" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "product_agent_model_config" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "product_agent_model_config"
SET "name" = COALESCE(NULLIF(btrim("name"), ''), NULLIF(btrim("provider_name"), ''), "provider" || ' / ' || NULLIF(btrim("model"), ''), "provider")
WHERE "name" IS NULL OR btrim("name") = '';--> statement-breakpoint
UPDATE "product_agent_model_config" AS "config"
SET "model" = (
	SELECT btrim("candidate"."value")
	FROM jsonb_array_elements_text("config"."discovered_models") AS "candidate"("value")
	WHERE btrim("candidate"."value") <> ''
	LIMIT 1
)
WHERE btrim("config"."model") = ''
	AND jsonb_typeof("config"."discovered_models") = 'array'
	AND jsonb_array_length("config"."discovered_models") > 0;--> statement-breakpoint
UPDATE "product_agent_model_config" SET "is_default" = false;--> statement-breakpoint
WITH "default_config" AS (
	SELECT "id"
	FROM "product_agent_model_config"
	WHERE btrim("model") <> ''
	ORDER BY "created_at", "id"
	LIMIT 1
)
UPDATE "product_agent_model_config" AS "config"
SET "is_default" = true
FROM "default_config"
WHERE "config"."id" = "default_config"."id";--> statement-breakpoint
ALTER TABLE "product_agent_model_config" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_agent_model_config_name_uidx" ON "product_agent_model_config" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_agent_model_config_default_uidx" ON "product_agent_model_config" USING btree ("is_default") WHERE "product_agent_model_config"."is_default" = true;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_agent_model_config_name_nonempty') THEN
		ALTER TABLE "product_agent_model_config" ADD CONSTRAINT "product_agent_model_config_name_nonempty" CHECK (length(btrim("name")) > 0);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_agent_model_config_model_nonempty') THEN
		ALTER TABLE "product_agent_model_config" ADD CONSTRAINT "product_agent_model_config_model_nonempty" CHECK (length(btrim("model")) > 0) NOT VALID;
	END IF;
END $$;
