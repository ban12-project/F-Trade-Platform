import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { FacebookMedia } from "../social/facebook-media-contract";
import { socialPublication, user } from "./schema";

export const facebookAccountRuntime = pgTable("facebook_account_runtime", {
  accountRef: text("account_ref").primaryKey(),
  channelRef: text("channel_ref").notNull(),
  loginCiphertext: text("login_ciphertext"),
  proxyCiphertext: text("proxy_ciphertext"),
  authState: text("auth_state").notNull().default("disconnected"),
  credentialVersion: integer("credential_version").notNull().default(1),
  updatedBy: text("updated_by")
    .notNull()
    .references(() => user.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const facebookInteractiveSession = pgTable(
  "facebook_interactive_session",
  {
    id: text("id").primaryKey(),
    workerId: text("worker_id").notNull(),
    channelRef: text("channel_ref").notNull(),
    accountRef: text("account_ref").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    authSessionId: text("auth_session_id").notNull(),
    status: text("status").notNull().default("issued"),
    useSavedLogin: boolean("use_saved_login").notNull(),
    credentialClaimed: boolean("credential_claimed").notNull().default(false),
    browserVerified: boolean("browser_verified").notNull().default(false),
    connectBefore: timestamp("connect_before", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("facebook_interactive_single_active")
      .on(t.accountRef)
      .where(sql`${t.status} in ('issued','connected')`),
    index("facebook_interactive_expiry").on(t.expiresAt),
  ],
);
export const facebookRequestReceipt = pgTable("facebook_request_receipt", {
  requestId: text("request_id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const facebookPublicationManifest = pgTable("facebook_publication_manifest", {
  publicationId: text("publication_id")
    .primaryKey()
    .references(() => socialPublication.id),
  contentVersion: integer("content_version").notNull(),
  format: text("format").notNull(),
  caption: text("caption").notNull(),
  media: jsonb("media").$type<FacebookMedia>().notNull(),
  mediaId: text("media_id").notNull(),
  confirmedBy: text("confirmed_by")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
