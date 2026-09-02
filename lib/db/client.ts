import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as productMediaSchema from "./product-media-schema";
import * as coreSchema from "./schema";

const schema = { ...coreSchema, ...productMediaSchema };

function requireDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value || !/^postgres(ql)?:\/\//.test(value)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  return value;
}

function createDatabase() {
  // neon-http deliberately throws for transaction(). Workflow transitions and
  // inbound delivery claims require BEGIN/COMMIT/ROLLBACK, so use the Pool
  // driver that Drizzle maps to Neon serverless transactions.
  const client = new Pool({ connectionString: requireDatabaseUrl() });
  return drizzle({ client, schema });
}

export type Database = ReturnType<typeof createDatabase>;

let database: Database | undefined;

export function getDatabase(): Database {
  database ??= createDatabase();
  return database;
}

export async function closeDatabase() {
  if (!database) return;
  await database.$client.end();
  database = undefined;
}
