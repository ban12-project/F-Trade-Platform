CREATE TABLE "product_agent_model_config" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"base_url" text,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_name" text,
	"organization" text,
	"project" text,
	"api_key_ciphertext" text,
	"auth_token_ciphertext" text,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_agent_model_config_singleton" CHECK ("product_agent_model_config"."id" = 'product_agent'),
	CONSTRAINT "product_agent_model_config_provider_nonempty" CHECK (length(btrim("product_agent_model_config"."provider")) > 0),
	CONSTRAINT "product_agent_model_config_model_nonempty" CHECK (length(btrim("product_agent_model_config"."model")) > 0)
);
--> statement-breakpoint
ALTER TABLE "product_agent_model_config" ADD CONSTRAINT "product_agent_model_config_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;