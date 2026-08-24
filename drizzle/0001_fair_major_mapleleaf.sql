CREATE TABLE "social_inbound_delivery" (
	"delivery_key" text PRIMARY KEY NOT NULL,
	"channel_ref" text NOT NULL,
	"account_ref" text NOT NULL,
	"message_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_inbound_delivery_key_nonempty" CHECK (length(btrim("social_inbound_delivery"."delivery_key")) > 0),
	CONSTRAINT "social_inbound_delivery_channel_nonempty" CHECK (length(btrim("social_inbound_delivery"."channel_ref")) > 0),
	CONSTRAINT "social_inbound_delivery_account_nonempty" CHECK (length(btrim("social_inbound_delivery"."account_ref")) > 0),
	CONSTRAINT "social_inbound_delivery_message_nonempty" CHECK (length(btrim("social_inbound_delivery"."message_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "social_inbound_delivery_external_uidx" ON "social_inbound_delivery" USING btree ("channel_ref","account_ref","message_id");--> statement-breakpoint
CREATE INDEX "social_inbound_delivery_received_at_idx" ON "social_inbound_delivery" USING btree ("received_at");