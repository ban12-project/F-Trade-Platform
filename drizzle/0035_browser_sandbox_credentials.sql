ALTER TABLE "browser_fleet_node" ALTER COLUMN "gateway_origin" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "browser_sandbox" ADD COLUMN "access_key_ciphertext" text;
