-- One short-lived external-attempt authorization per reserved publication.
-- Expiry must never mint a fresh attempt for the same job.
ALTER TABLE "browser_fleet_publication"
  ADD COLUMN "authorization_id" text UNIQUE,
  ADD COLUMN "authorized_lease_id" text,
  ADD COLUMN "authorized_until" bigint;
--> statement-breakpoint
ALTER TABLE "browser_fleet_publication" ADD CONSTRAINT "browser_publication_authorization_complete"
CHECK (("authorization_id" IS NULL AND "authorized_lease_id" IS NULL AND "authorized_until" IS NULL)
  OR ("authorization_id" IS NOT NULL AND "authorized_lease_id" IS NOT NULL AND "authorized_until" IS NOT NULL AND "authorized_until" > 0));
