ALTER TABLE "browser_sandbox"
  ADD COLUMN "provider_initialized" boolean NOT NULL DEFAULT false,
  ADD COLUMN "dispatch_operation_id" uuid;
