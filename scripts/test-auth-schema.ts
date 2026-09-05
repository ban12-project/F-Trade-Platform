import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { passkey as passkeyPlugin } from "@better-auth/passkey";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { account, authSchema, passkey, session, user, verification } from "../lib/db/schema";

async function main() {
  const expected = { user, session, account, verification, passkey };
  for (const [model, table] of Object.entries(expected)) {
    assert.equal(
      Reflect.get(authSchema, model),
      table,
      `authSchema must expose the actual Drizzle table for ${model}`,
    );
  }
  assert.equal(getTableName(passkey), "passkey");
  const columns = getTableColumns(passkey);
  for (const field of ["id", ...Object.keys(passkeyPlugin().schema.passkey.fields)]) {
    assert.ok(Reflect.get(columns, field), `Missing Passkey plugin field: ${field}`);
  }

  // Use real Drizzle SQL generation and Better Auth model resolution, but no network or database.
  const queries: { sql: string; params: unknown[] }[] = [];
  const database = drizzle(
    async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
    { schema: expected },
  );
  const options: BetterAuthOptions = {
    plugins: [passkeyPlugin()],
    logger: { disabled: true },
  };
  const adapter = drizzleAdapter(database, { provider: "pg", schema: authSchema })(options);

  assert.deepEqual(
    await adapter.findMany({
      model: "passkey",
      where: [{ field: "userId", value: "synthetic-passkey-owner" }],
    }),
    [],
  );
  assert.match(queries[0]!.sql, /from "passkey"/);
  assert.match(queries[0]!.sql, /"user_id"/);
  assert.ok(queries[0]!.params.includes("synthetic-passkey-owner"));

  assert.equal(
    await adapter.findOne({
      model: "passkey",
      where: [{ field: "credentialID", value: "synthetic-credential-id" }],
    }),
    null,
  );
  assert.match(queries[1]!.sql, /"credential_id"/);
  assert.ok(queries[1]!.params.includes("synthetic-credential-id"));

  for (const model of ["user", "session", "account", "verification"]) {
    assert.deepEqual(await adapter.findMany({ model }), []);
  }

  // Reproduce the reported regression even though database._.fullSchema has the table:
  // an explicit, incomplete adapter schema takes precedence over the full Drizzle schema.
  const incomplete = { user, session, account, verification };
  const broken = drizzleAdapter(database, { provider: "pg", schema: incomplete })(options);
  const countBeforeFailure = queries.length;
  await assert.rejects(
    () => broken.findMany({ model: "passkey" }),
    /The model "passkey" was not found in the schema object/,
  );
  assert.equal(queries.length, countBeforeFailure, "Missing models must fail before SQL execution");

  const authSource = readFileSync(new URL("../lib/auth.ts", import.meta.url), "utf8");
  assert.match(authSource, /schema:\s*authSchema/);
  console.log("PASS authSchema exposes all core models and all Passkey plugin fields");
  console.log(
    "PASS real adapter resolves passkey owner and credential queries without network access",
  );
  console.log("PASS missing passkey mapping reproduces the reported error before SQL execution");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
