-- Custom migration: the fleet broker owns a versioned document, not ORM snapshots.
-- No browser profile, plaintext password or raw access key is stored here.
CREATE TABLE "browser_fleet_node" (
  "id" text PRIMARY KEY,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "gateway_origin" text NOT NULL,
  "key_hash" text NOT NULL UNIQUE,
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'revoked')),
  "document" jsonb NOT NULL CHECK (jsonb_typeof("document") = 'object' AND "document" @> '{"version":1}'::jsonb),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "browser_fleet_node_owner_idx" ON "browser_fleet_node" ("owner_id");
--> statement-breakpoint
CREATE TABLE "browser_fleet_binding" (
  "id" text PRIMARY KEY,
  "node_id" text NOT NULL REFERENCES "browser_fleet_node"("id") ON DELETE RESTRICT,
  "account_ref" text NOT NULL UNIQUE,
  "channel_ref" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "browser_fleet_binding_node_idx" ON "browser_fleet_binding" ("node_id");
