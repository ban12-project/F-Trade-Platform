ALTER TABLE "browser_fleet_publication"
  ADD COLUMN "receipt" jsonb,
  ADD COLUMN "received_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "browser_fleet_publication" ADD CONSTRAINT "browser_publication_receipt_complete"
CHECK (("receipt" IS NULL AND "received_at" IS NULL)
  OR ("receipt" IS NOT NULL AND "received_at" IS NOT NULL AND "authorization_id" IS NOT NULL));
