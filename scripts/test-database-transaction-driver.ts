import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";

async function main() {
  const source = await readFile(path.join(process.cwd(), "lib/db/client.ts"), "utf8");
  assert.match(source, /drizzle-orm\/neon-serverless/);
  assert.match(source, /new Pool\(/);
  assert.match(source, /closeDatabase/);
  assert.doesNotMatch(source, /drizzle-orm\/neon-http/);
  const pool = new Pool({ connectionString: "postgresql://schema-only:unused@localhost/f_trade" });
  const database = drizzle({ client: pool, schema });
  assert.equal(typeof database.transaction, "function");
  await pool.end();
  const previousUrl = process.env.DATABASE_URL;
  const previousTransport = process.env.DATABASE_TRANSPORT;
  try {
    process.env.DATABASE_URL = "postgresql://synthetic:synthetic@127.0.0.1/f_trade_driver_test";
    delete process.env.DATABASE_TRANSPORT;
    assert.ok(getDatabase().$client instanceof Pool, "Neon remains the default");
    await closeDatabase();
    process.env.DATABASE_TRANSPORT = "postgres";
    assert.equal(typeof getDatabase().transaction, "function");
    assert.equal(getDatabase().$client instanceof Pool, false);
    await closeDatabase();
    process.env.DATABASE_URL =
      "postgresql://synthetic:synthetic@example.invalid/f_trade_driver_test";
    assert.throws(() => getDatabase(), /loopback/);
    process.env.DATABASE_TRANSPORT = "unknown";
    assert.throws(() => getDatabase(), /Unsupported DATABASE_TRANSPORT/);
  } finally {
    await closeDatabase();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousTransport === undefined) delete process.env.DATABASE_TRANSPORT;
    else process.env.DATABASE_TRANSPORT = previousTransport;
  }
  console.log("PASS transaction-capable Neon database driver");
}

void main();
