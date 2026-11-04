import assert from "node:assert/strict";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "../lib/db/client";
import { inboundRoutingFormSchema } from "../lib/form-schemas";
import { readInboundContext } from "../lib/social/inbound-context-store";
import { routeInboundConversation } from "../lib/social/inbound-routing-store";
import { encryptSocialMessageBody } from "../lib/social/message-crypto";

const dialect = new PgDialect();
const now = new Date();
const identity = { actorId: "synthetic-owner", sessionId: "synthetic-session" };
process.env.SOCIAL_MESSAGE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
type Row = Record<string, unknown>;
class Query implements PromiseLike<Row[]> {
  table = "";
  condition = "";
  params: unknown[] = [];
  count = 0;
  constructor(private db: FakeDatabase) {}
  from(table: Table) {
    this.table = getTableName(table);
    return this;
  }
  innerJoin(..._args: unknown[]) {
    return this;
  }
  where(condition: SQL) {
    const query = dialect.sqlToQuery(condition);
    this.condition = query.sql;
    this.params = query.params;
    return this;
  }
  for(_lock: string) {
    return this;
  }
  orderBy(..._args: unknown[]) {
    return this;
  }
  limit(count: number) {
    this.count = count;
    return this;
  }
  // biome-ignore lint/suspicious/noThenProperty: Models a Drizzle lazy query.
  then<A = Row[], B = never>(
    resolve?: ((rows: Row[]) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.db.read(this).then(resolve, reject);
  }
}
class FakeDatabase {
  owner = identity.actorId;
  authorized = true;
  expired = false;
  routed = false;
  bindings = true;
  empty = false;
  queries: Query[] = [];
  ciphertext = encryptSocialMessageBody(`SYNTHETIC ${"x".repeat(700)}`);
  select(_columns: unknown) {
    return new Query(this);
  }
  async execute(condition: SQL) {
    const query = dialect.sqlToQuery(condition);
    assert.match(query.sql, /FOR SHARE OF n, b/);
    assert.deepEqual(query.params, ["synthetic-channel", "synthetic-account"]);
    return { rows: this.bindings ? [{ owner_id: this.owner }] : [] };
  }
  async transaction<T>(work: (tx: FakeDatabase) => Promise<T>) {
    return work(this);
  }
  async read(query: Query): Promise<Row[]> {
    this.queries.push(query);
    if (query.table === "user")
      return this.authorized
        ? [
            {
              role: "user",
              banned: false,
              expiresAt: new Date(Date.now() + (this.expired ? -1 : 60000)),
            },
          ]
        : [];
    if (query.table === "social_conversation") {
      assert.ok(query.params.includes("synthetic-conversation"));
      return this.routed
        ? []
        : [
            {
              id: "synthetic-conversation",
              channelRef: "synthetic-channel",
              accountRef: "synthetic-account",
              lastMessageAt: now,
              leadId: null,
            },
          ];
    }
    if (query.table === "social_message") {
      assert.match(query.condition, /"deleted_at" is null/);
      assert.match(query.condition, /"expires_at" > /);
      assert.match(query.condition, /"received_at" <= /);
      assert.deepEqual(query.params.slice(0, 2), ["synthetic-conversation", "inbound"]);
      assert.equal(query.count, 3);
      return this.empty
        ? []
        : [
            {
              id: "synthetic-message",
              receivedAt: now,
              bodyCiphertext: this.ciphertext,
              expiresAt: new Date(now.getTime() + 60000),
            },
          ];
    }
    throw new Error(`Unexpected query ${query.table}`);
  }
  asDatabase() {
    return this as unknown as Database;
  }
}
async function main() {
  const db = new FakeDatabase();
  const preview = await readInboundContext(
    { conversationId: "synthetic-conversation" },
    identity,
    db.asDatabase(),
  );
  assert.equal(preview.messages[0].excerpt.length, 600);
  assert.equal(preview.messages[0].truncated, true);
  assert.equal(JSON.stringify(preview).includes("bodyCiphertext"), false);
  assert.equal(preview.reviewedMessageAt, now.toISOString());
  for (const failure of ["authorized", "owner", "routed", "bindings", "expired"] as const) {
    const denied = new FakeDatabase();
    if (failure === "owner") denied.owner = "other-owner";
    else if (failure === "routed") denied.routed = true;
    else if (failure === "expired") denied.expired = true;
    else denied[failure] = false;
    await assert.rejects(
      readInboundContext(
        { conversationId: "synthetic-conversation" },
        identity,
        denied.asDatabase(),
      ),
    );
    assert.equal(
      denied.queries.some((query) => query.table === "social_message"),
      false,
      `${failure} denial happens before ciphertext read`,
    );
  }
  const legacy = new FakeDatabase();
  legacy.bindings = false;
  process.env.SOCIAL_FACEBOOK_OWNER_USER_ID = identity.actorId;
  process.env.SOCIAL_WORKER_CHANNEL_REF = "synthetic-channel";
  process.env.SOCIAL_WORKER_ACCOUNT_REF = "synthetic-account";
  await readInboundContext(
    { conversationId: "synthetic-conversation" },
    identity,
    legacy.asDatabase(),
  );
  process.env.SOCIAL_WORKER_ACCOUNT_REF = "another-account";
  await assert.rejects(
    readInboundContext({ conversationId: "synthetic-conversation" }, identity, legacy.asDatabase()),
  );
  const empty = new FakeDatabase();
  empty.empty = true;
  assert.deepEqual(
    (
      await readInboundContext(
        { conversationId: "synthetic-conversation" },
        identity,
        empty.asDatabase(),
      )
    ).messages,
    [],
  );
  const form = {
    conversationId: "synthetic-conversation",
    mode: "create",
    reviewedMessageAt: now.toISOString(),
    confirmed: "yes",
    reviewedContextDigest: preview.reviewedContextDigest,
  };
  assert.equal(inboundRoutingFormSchema.safeParse(form).success, true);
  assert.equal(
    inboundRoutingFormSchema.safeParse({ ...form, confirmed: undefined }).success,
    false,
  );
  assert.equal(
    inboundRoutingFormSchema.safeParse({ ...form, reviewedMessageAt: undefined }).success,
    false,
  );
  const changed = new FakeDatabase();
  await assert.rejects(
    routeInboundConversation(form, identity, changed.asDatabase()),
    /已有更新/,
    "Same timestamp but changed message content invalidates review",
  );
  changed.queries = [];
  await assert.rejects(
    routeInboundConversation(
      { ...form, reviewedMessageAt: new Date(now.getTime() - 1).toISOString() },
      identity,
      changed.asDatabase(),
    ),
    /已有更新/,
  );
  assert.equal(changed.queries.length, 2, "Stale review rejects before any business write");
  console.log(
    "PASS inbound context: owner scope, denied-before-decrypt, retention predicates, bounded projection, explicit confirmation and stale review",
  );
}
void main();
