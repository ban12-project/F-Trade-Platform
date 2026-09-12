-- Durable Workflow delivery. No credentials or browser payloads belong here.
CREATE TABLE "browser_sandbox_outbox" (
  "operation_id" uuid PRIMARY KEY,
  "node_id" text NOT NULL REFERENCES "browser_sandbox"("node_id") ON DELETE RESTRICT,
  "claim_id" uuid,
  "claim_until" timestamptz,
  "workflow_run_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CHECK (("claim_id" IS NULL) = ("claim_until" IS NULL))
);
CREATE INDEX "browser_sandbox_outbox_pending" ON "browser_sandbox_outbox" ("created_at")
  WHERE "workflow_run_id" IS NULL;
