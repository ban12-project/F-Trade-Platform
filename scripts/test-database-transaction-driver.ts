import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

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
  console.log("PASS transaction-capable Neon database driver");
}

void main();
