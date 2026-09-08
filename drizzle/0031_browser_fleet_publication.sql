-- A job can belong to exactly one durable browser run; retain terminal bindings
-- so a lost response or pruned node history cannot authorize a duplicate effect.
CREATE TABLE "browser_fleet_publication" (
  "job_id" text PRIMARY KEY REFERENCES "social_browser_job"("id") ON DELETE RESTRICT,
  "node_id" text NOT NULL REFERENCES "browser_fleet_node"("id") ON DELETE RESTRICT,
  "run_id" text NOT NULL UNIQUE,
  "payload" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
