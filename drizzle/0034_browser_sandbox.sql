-- Provider operations survive request/workflow crashes. Runtime credentials and
-- browser profiles are deliberately absent from this coordination table.
CREATE TABLE "browser_sandbox" (
  "node_id" text PRIMARY KEY REFERENCES "browser_fleet_node"("id") ON DELETE RESTRICT,
  "sandbox_name" text NOT NULL UNIQUE,
  "phase" text NOT NULL DEFAULT 'stopped' CHECK ("phase" IN ('stopped', 'starting', 'running', 'stopping', 'unknown')),
  "session_id" text,
  "operation_id" uuid,
  "operation_kind" text CHECK ("operation_kind" IN ('start', 'stop')),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CHECK (("operation_id" IS NULL) = ("operation_kind" IS NULL)),
  CHECK (("phase" IN ('starting', 'stopping', 'unknown')) = ("operation_id" IS NOT NULL)),
  CHECK ("phase" <> 'starting' OR "operation_kind" = 'start'),
  CHECK ("phase" <> 'stopping' OR "operation_kind" = 'stop'),
  CHECK ("phase" NOT IN ('running', 'stopping') OR "session_id" IS NOT NULL),
  CHECK ("phase" <> 'stopped' OR "session_id" IS NULL)
);
