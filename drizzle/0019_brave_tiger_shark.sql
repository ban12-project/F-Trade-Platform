ALTER TABLE "product_agent_model_config" ADD COLUMN IF NOT EXISTS "discovered_models" jsonb DEFAULT '[]'::jsonb NOT NULL;
