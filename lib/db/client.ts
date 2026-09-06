import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { drizzle as postgresDrizzle } from "drizzle-orm/node-postgres";
import { Pool as PostgresPool } from "pg";

import * as facebookRuntimeSchema from "./facebook-runtime-schema";
import * as productMediaSchema from "./product-media-schema";
import * as coreSchema from "./schema";

const schema = { ...coreSchema, ...productMediaSchema, ...facebookRuntimeSchema };

function requireDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value || !/^postgres(ql)?:\/\//.test(value)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  return value;
}

function createNeonDatabase() {
  // neon-http deliberately throws for transaction(). Workflow transitions and
  // inbound delivery claims require BEGIN/COMMIT/ROLLBACK, so use the Pool
  // driver that Drizzle maps to Neon serverless transactions.
  const client = new Pool({ connectionString: requireDatabaseUrl() });
  return drizzle({ client, schema });
}

export type Database = ReturnType<typeof createNeonDatabase>;
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DatabaseExecutor = Database | DatabaseTransaction;

let database: Database | undefined;

function createDatabase(): Database {
  const transport = process.env.DATABASE_TRANSPORT ?? "neon";
  if (transport === "neon") return createNeonDatabase();
  if (transport !== "postgres") throw new Error("Unsupported DATABASE_TRANSPORT");
  const connectionString = requireDatabaseUrl();
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(connectionString).hostname)) {
    throw new Error("Native PostgreSQL transport requires a loopback database");
  }
  const client = new PostgresPool({ connectionString });
  // Both adapters implement the same PostgreSQL query/transaction API used here.
  // Keep driver-specific session types behind this wire-transport boundary.
  return postgresDrizzle({ client, schema }) as unknown as Database;
}

export function getDatabase(): Database {
  database ??= createDatabase();
  return database;
}

export async function closeDatabase() {
  if (!database) return;
  await database.$client.end();
  database = undefined;
}
