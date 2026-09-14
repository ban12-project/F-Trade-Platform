DROP INDEX "evidence_sha256_uidx";
--> statement-breakpoint
CREATE INDEX "evidence_sha256_idx" ON "evidence" USING btree ("sha256");
