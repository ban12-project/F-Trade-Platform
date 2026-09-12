-- Historical confirmations are deliberately left unbound. Claim rejects them;
-- never infer human consent from the latest body during migration.
ALTER TABLE "social_publication" ADD COLUMN "text_confirmation" jsonb;
