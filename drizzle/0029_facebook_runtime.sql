-- Schema-backed runtime tables used by the legacy Facebook UI and HTTP boundaries.
-- Only encrypted credentials and bounded operational metadata, never OTPs/profiles.
CREATE TABLE "facebook_account_runtime" (
  "account_ref" text PRIMARY KEY,
  "channel_ref" text NOT NULL,
  "login_ciphertext" text,
  "proxy_ciphertext" text,
  "auth_state" text NOT NULL DEFAULT 'disconnected',
  "credential_version" integer NOT NULL DEFAULT 1,
  "updated_by" text NOT NULL REFERENCES "user"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "facebook_interactive_session" (
  "id" text PRIMARY KEY,
  "worker_id" text NOT NULL,
  "channel_ref" text NOT NULL,
  "account_ref" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id"),
  "auth_session_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'issued',
  "use_saved_login" boolean NOT NULL,
  "credential_claimed" boolean NOT NULL DEFAULT false,
  "browser_verified" boolean NOT NULL DEFAULT false,
  "connect_before" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "heartbeat_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "facebook_interactive_single_active"
  ON "facebook_interactive_session" ("account_ref") WHERE "status" in ('issued','connected');
--> statement-breakpoint
CREATE INDEX "facebook_interactive_expiry" ON "facebook_interactive_session" ("expires_at");
--> statement-breakpoint
CREATE TABLE "facebook_request_receipt" (
  "request_id" text PRIMARY KEY,
  "expires_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facebook_publication_manifest" (
  "publication_id" text PRIMARY KEY REFERENCES "social_publication"("id"),
  "content_version" integer NOT NULL,
  "format" text NOT NULL,
  "caption" text NOT NULL,
  "media" jsonb NOT NULL,
  "media_id" text NOT NULL,
  "confirmed_by" text NOT NULL REFERENCES "user"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
